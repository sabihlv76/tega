import { Router } from "express";
import { z } from "zod";
import { config } from "../config";
import { hmac, randomToken, safeEqual } from "../lib/crypto";
import { ApiError, badRequest } from "../lib/errors";
import { errorFields, logger } from "../lib/logger";
import { body, rateLimit, validate } from "../middleware";
import { UserModel } from "../models";
import { completeSignIn, googleAuthUrl, requestOtp, signInWithGoogleCode, verifyOtp } from "../services/auth";
import { REFRESH_COOKIE, revokeRefreshToken, rotateRefreshToken, signAccessToken } from "../services/tokens";
import { clearRefreshCookie, isMobileClient, issueSession, parseCookies, safeNext, setRefreshCookie, toUserDTO } from "./helpers";

export const authRouter = Router();

const contactSchema = z.object({
  channel: z.enum(["sms", "email"]).default("sms"),
  phone: z.string().max(30).optional(),
  email: z.string().max(200).optional(),
});

function targetOf(input: z.infer<typeof contactSchema>): string {
  const target = input.channel === "sms" ? input.phone : input.email;
  if (!target) throw badRequest(input.channel === "sms" ? "PHONE_INVALID" : "EMAIL_INVALID");
  return target;
}

authRouter.post(
  "/otp/request",
  rateLimit({ name: "otp-request", windowMs: 15 * 60_000, max: 20 }),
  validate({ body: contactSchema }),
  async (req, res) => {
    const input = body<z.infer<typeof contactSchema>>(req);
    res.json(await requestOtp(input.channel, targetOf(input), req.locale));
  },
);

const verifySchema = contactSchema.extend({ code: z.string().trim().min(4).max(8) });

authRouter.post(
  "/otp/verify",
  rateLimit({ name: "otp-verify", windowMs: 15 * 60_000, max: 40 }),
  validate({ body: verifySchema }),
  async (req, res) => {
    const input = body<z.infer<typeof verifySchema>>(req);
    const { user, isNewUser } = await verifyOtp(input.channel, targetOf(input), input.code, req.locale);
    res.json(await issueSession(req, res, user, isNewUser));
  },
);

authRouter.post("/refresh", rateLimit({ name: "refresh", windowMs: 60_000, max: 60 }), async (req, res) => {
  const mobile = isMobileClient(req);
  const token = mobile ? (req.body?.refreshToken as string | undefined) : parseCookies(req)[REFRESH_COOKIE];
  if (!token) throw new ApiError(401, "UNAUTHORIZED");
  const rotated = await rotateRefreshToken(token, { client: mobile ? "mobile" : "web", userAgent: req.headers["user-agent"], ip: req.ip });
  if (!rotated) {
    if (!mobile) clearRefreshCookie(res);
    throw new ApiError(401, "UNAUTHORIZED");
  }
  const user = await UserModel.findById(rotated.userId);
  if (!user || user.status === "suspended") {
    if (!mobile) clearRefreshCookie(res);
    throw new ApiError(401, user ? "ACCOUNT_SUSPENDED" : "UNAUTHORIZED");
  }
  if (!mobile) setRefreshCookie(res, rotated.refreshToken);
  res.json({
    accessToken: await signAccessToken(user),
    expiresIn: config.accessTokenTtl,
    user: await toUserDTO(user),
    ...(mobile ? { refreshToken: rotated.refreshToken } : {}),
  });
});

authRouter.post("/logout", async (req, res) => {
  const token = isMobileClient(req) ? (req.body?.refreshToken as string | undefined) : parseCookies(req)[REFRESH_COOKIE];
  if (token) await revokeRefreshToken(token);
  clearRefreshCookie(res);
  res.json({ ok: true });
});

// ── Google OAuth ─────────────────────────────────────────────────────────────

const OAUTH_COOKIE = "fika_oauth";
const OAUTH_PATH = "/api/v1/auth/google";

authRouter.get("/google/start", (req, res) => {
  if (!config.google.enabled) {
    res.redirect(`${config.webUrl}/auth/login?error=GOOGLE_NOT_CONFIGURED`);
    return;
  }
  const state = randomToken(16);
  const next = safeNext(req.query.next);
  const value = `${state}|${encodeURIComponent(next)}|${req.locale}`;
  res.cookie(OAUTH_COOKIE, `${value}|${hmac(config.jwtSecret, value)}`, {
    httpOnly: true,
    secure: config.isProd,
    sameSite: "lax",
    path: OAUTH_PATH,
    maxAge: 10 * 60_000,
  });
  res.redirect(googleAuthUrl(state));
});

authRouter.get("/google/callback", async (req, res) => {
  const fail = (code: string) => res.redirect(`${config.webUrl}/auth/login?error=${code}`);
  const raw = parseCookies(req)[OAUTH_COOKIE];
  res.clearCookie(OAUTH_COOKIE, { path: OAUTH_PATH });
  if (!raw || typeof req.query.code !== "string" || typeof req.query.state !== "string") return fail("GOOGLE_FAILED");
  const parts = raw.split("|");
  if (parts.length !== 4) return fail("GOOGLE_FAILED");
  const [state, nextEncoded, locale, signature] = parts;
  const value = `${state}|${nextEncoded}|${locale}`;
  if (!safeEqual(signature, hmac(config.jwtSecret, value)) || !safeEqual(state, req.query.state)) return fail("GOOGLE_FAILED");
  try {
    const user = await signInWithGoogleCode(req.query.code, (["en", "rw", "fr", "sw"].includes(locale) ? locale : "en") as never);
    await completeSignIn(user);
    await issueSession(req, res, user);
    res.redirect(`${config.webUrl}/auth/complete?next=${nextEncoded}`);
  } catch (err) {
    logger.warn("Google sign-in failed", errorFields(err));
    fail(err instanceof ApiError ? err.code : "GOOGLE_FAILED");
  }
});
