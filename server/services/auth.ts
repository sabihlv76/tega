import { createRemoteJWKSet, jwtVerify } from "jose";
import type { Locale } from "../../shared/constants";
import { getTranslator } from "../../shared/i18n/catalog";
import { normalizeRwPhone } from "../../shared/money";
import { config } from "../config";
import { ApiError, badRequest } from "../lib/errors";
import { hashSecret, randomDigits, safeEqual } from "../lib/crypto";
import { OtpModel, type UserDoc, UserModel } from "../models";
import { isConsoleDelivery, sendEmail, sendSms } from "./messaging";

// Passwordless sign-in: one-time codes by SMS (primary) or email (fallback), plus Google OAuth.

const OTP_TTL_SECONDS = 300;
const OTP_MAX_ATTEMPTS = 5;
const OTP_MIN_INTERVAL_MS = 30_000;
const OTP_MAX_PER_15_MIN = 5;

export type OtpChannel = "sms" | "email";

export function normalizeTarget(channel: OtpChannel, raw: string): string {
  if (channel === "sms") {
    const phone = normalizeRwPhone(raw);
    if (!phone) throw badRequest("PHONE_INVALID");
    return phone;
  }
  const email = raw.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) throw badRequest("EMAIL_INVALID");
  return email;
}

export function maskDestination(channel: OtpChannel, target: string): string {
  if (channel === "sms") return `${target.slice(0, 7)} ••• ${target.slice(-3)}`;
  const [name, domain] = target.split("@");
  return `${name.slice(0, 1)}•••@${domain}`;
}

export async function requestOtp(channel: OtpChannel, rawTarget: string, locale: Locale) {
  const target = normalizeTarget(channel, rawTarget);
  const now = Date.now();
  const latest = await OtpModel.findOne({ target }).sort({ createdAt: -1 }).lean();
  if (latest && now - latest.createdAt.getTime() < OTP_MIN_INTERVAL_MS) {
    throw new ApiError(429, "RATE_LIMITED", { retryAfter: Math.ceil((OTP_MIN_INTERVAL_MS - (now - latest.createdAt.getTime())) / 1000) });
  }
  const recent = await OtpModel.countDocuments({ target, createdAt: { $gt: new Date(now - 15 * 60_000) } });
  if (recent >= OTP_MAX_PER_15_MIN) throw new ApiError(429, "RATE_LIMITED", { retryAfter: 900 });

  const code = randomDigits(6);
  await OtpModel.create({
    channel,
    target,
    codeHash: hashSecret(code, target),
    expiresAt: new Date(now + OTP_TTL_SECONDS * 1000),
  });

  const t = getTranslator(locale);
  const vars = { code, minutes: OTP_TTL_SECONDS / 60 };
  if (channel === "sms") await sendSms(target, t("notifications.otpSms", vars));
  else await sendEmail(target, t("notifications.otpEmailSubject"), t("notifications.otpEmailBody", vars));

  return {
    ok: true as const,
    channel,
    destination: maskDestination(channel, target),
    expiresIn: OTP_TTL_SECONDS,
    // Only exposed when nothing is really sent (console provider) and never in production.
    devCode: !config.isProd && isConsoleDelivery(channel) ? code : undefined,
  };
}

export async function verifyOtp(
  channel: OtpChannel,
  rawTarget: string,
  code: string,
  locale: Locale,
): Promise<{ user: UserDoc; isNewUser: boolean }> {
  const target = normalizeTarget(channel, rawTarget);
  const otp = await OtpModel.findOne({ target, consumedAt: null }).sort({ createdAt: -1 });
  if (!otp || otp.expiresAt.getTime() < Date.now()) throw badRequest("OTP_EXPIRED");
  if (otp.attempts >= OTP_MAX_ATTEMPTS) throw new ApiError(429, "OTP_TOO_MANY_ATTEMPTS");
  if (!/^\d{6}$/.test(code) || !safeEqual(hashSecret(code, target), otp.codeHash)) {
    otp.attempts += 1;
    await otp.save();
    throw otp.attempts >= OTP_MAX_ATTEMPTS ? new ApiError(429, "OTP_TOO_MANY_ATTEMPTS") : badRequest("OTP_INVALID");
  }
  otp.consumedAt = new Date();
  await otp.save();

  const query = channel === "sms" ? { phone: target } : { email: target };
  let user = await UserModel.findOne(query);
  let isNewUser = false;
  if (!user) {
    user = await UserModel.create({ ...query, role: "passenger", language: locale });
    isNewUser = true;
  }
  return { user: await completeSignIn(user), isNewUser };
}

export async function completeSignIn(user: UserDoc): Promise<UserDoc> {
  if (user.status === "suspended") throw new ApiError(403, "ACCOUNT_SUSPENDED");
  if (user.status === "invited") user.status = "active";
  user.lastLoginAt = new Date();
  await user.save();
  return user;
}

// ── Google OAuth 2.0 (authorization code flow) ───────────────────────────────

const googleJwks = createRemoteJWKSet(new URL("https://www.googleapis.com/oauth2/v3/certs"));

export function googleRedirectUri(): string {
  return `${config.webUrl}/api/v1/auth/google/callback`;
}

export function googleAuthUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: config.google.clientId ?? "",
    redirect_uri: googleRedirectUri(),
    response_type: "code",
    scope: "openid email profile",
    state,
    prompt: "select_account",
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

export async function signInWithGoogleCode(code: string, locale: Locale): Promise<UserDoc> {
  if (!config.google.enabled) throw new ApiError(501, "GOOGLE_NOT_CONFIGURED");
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: config.google.clientId ?? "",
      client_secret: config.google.clientSecret ?? "",
      redirect_uri: googleRedirectUri(),
      grant_type: "authorization_code",
    }),
  });
  if (!res.ok) throw new ApiError(400, "GOOGLE_FAILED");
  const { id_token: idToken } = (await res.json()) as { id_token?: string };
  if (!idToken) throw new ApiError(400, "GOOGLE_FAILED");
  const { payload } = await jwtVerify(idToken, googleJwks, {
    issuer: ["https://accounts.google.com", "accounts.google.com"],
    audience: config.google.clientId,
  });
  const googleId = String(payload.sub);
  const email = typeof payload.email === "string" && payload.email_verified ? payload.email.toLowerCase() : null;
  const name = typeof payload.name === "string" ? payload.name : null;

  let user = await UserModel.findOne({ googleId });
  if (!user && email) {
    user = await UserModel.findOne({ email });
    if (user) user.googleId = googleId;
  }
  if (!user) {
    user = await UserModel.create({ googleId, email, name, role: "passenger", language: locale });
  } else if (!user.name && name) {
    user.name = name;
  }
  return completeSignIn(user);
}
