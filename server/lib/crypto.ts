import crypto from "node:crypto";
import { config } from "../config";

// Codes, references and signatures. Everything security-sensitive uses crypto-grade randomness
// and constant-time comparisons.

/** Crockford base32 without I, L, O, U to avoid misreading references aloud or on paper. */
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

export function randomCode(length: number, alphabet = ALPHABET): string {
  const bytes = crypto.randomBytes(length);
  let out = "";
  for (let i = 0; i < length; i++) out += alphabet[bytes[i] % alphabet.length];
  return out;
}

/** 6-digit numeric one-time code. */
export function randomDigits(length = 6): string {
  let out = "";
  while (out.length < length) out += crypto.randomInt(0, 10).toString();
  return out;
}

/** Booking reference like FK-2026-8A3X7. */
export function bookingReference(now = new Date()): string {
  return `FK-${now.getUTCFullYear()}-${randomCode(5)}`;
}

/** Parcel tracking code like FP-7K2M9Q4X. */
export function parcelCode(): string {
  return `FP-${randomCode(8)}`;
}

export function sha256(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

export function hmac(secret: string, value: string): string {
  return crypto.createHmac("sha256", secret).update(value).digest("base64url");
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

export function randomToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString("base64url");
}

/** Hash for short secrets (OTP, pickup codes) bound to their target so codes can't be replayed elsewhere. */
export function hashSecret(code: string, scope: string): string {
  return hmac(config.jwtSecret, `${scope}:${code}`);
}

// ── Ticket QR tokens ─────────────────────────────────────────────────────────
// Format: FKT1.<bookingId>.<signature>. The signature proves the ticket was issued by FIKA, so
// station staff can't be fooled by a hand-made QR code, and the booking id makes lookups instant.

export function signTicket(bookingId: string): string {
  return `FKT1.${bookingId}.${hmac(config.ticketSecret, `ticket:${bookingId}`)}`;
}

export function verifyTicket(token: string): string | null {
  const parts = token.trim().split(".");
  if (parts.length !== 3 || parts[0] !== "FKT1") return null;
  const [, bookingId, signature] = parts;
  if (!/^[a-f0-9]{24}$/i.test(bookingId)) return null;
  const expected = hmac(config.ticketSecret, `ticket:${bookingId}`);
  return safeEqual(signature, expected) ? bookingId : null;
}

// ── Reversible encryption for short secrets the owner must be able to read back (pickup codes) ──

const encKey = crypto.createHash("sha256").update(`enc:${config.jwtSecret}`).digest();

export function encrypt(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", encKey, iv);
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), data].map((b) => b.toString("base64url")).join(".");
}

export function decrypt(payload: string | null | undefined): string | null {
  if (!payload) return null;
  try {
    const [iv, tag, data] = payload.split(".").map((p) => Buffer.from(p, "base64url"));
    const decipher = crypto.createDecipheriv("aes-256-gcm", encKey, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}

export function maskAccount(accountNumber: string | null | undefined): string | null {
  if (!accountNumber) return null;
  const digits = accountNumber.replace(/\s/g, "");
  return `•••• ${digits.slice(-4)}`;
}

export function slugify(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}
