import { jwtVerify, SignJWT } from "jose";
import type { Types } from "mongoose";
import type { Role } from "../../shared/constants";
import { config } from "../config";
import { randomToken, sha256 } from "../lib/crypto";
import { SessionModel } from "../models";

// Access tokens: short-lived HS256 JWTs (default 15 min).
// Refresh tokens: random opaque strings, stored hashed, rotated on every use. A rotated token that
// is presented again (after a short grace period for parallel tabs) revokes the whole sign-in family.

const key = new TextEncoder().encode(config.jwtSecret);
const ISSUER = "fika-api";
const AUDIENCE = "fika";
const ROTATION_GRACE_MS = 20_000;

export interface AccessClaims {
  sub: string;
  role: Role;
  op?: string;
  st?: string;
}

export interface TokenSubject {
  _id: Types.ObjectId;
  role: string;
  operatorId?: Types.ObjectId | null;
  stationId?: Types.ObjectId | null;
}

export async function signAccessToken(user: TokenSubject): Promise<string> {
  const claims: Record<string, string> = { role: user.role };
  if (user.operatorId) claims.op = user.operatorId.toString();
  if (user.stationId) claims.st = user.stationId.toString();
  return new SignJWT(claims)
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(user._id.toString())
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(`${config.accessTokenTtl}s`)
    .sign(key);
}

export async function verifyAccessToken(token: string): Promise<AccessClaims | null> {
  try {
    const { payload } = await jwtVerify(token, key, { issuer: ISSUER, audience: AUDIENCE, algorithms: ["HS256"] });
    if (typeof payload.sub !== "string" || typeof payload.role !== "string") return null;
    return {
      sub: payload.sub,
      role: payload.role as Role,
      op: typeof payload.op === "string" ? payload.op : undefined,
      st: typeof payload.st === "string" ? payload.st : undefined,
    };
  } catch {
    return null;
  }
}

export interface SessionMeta {
  client: "web" | "mobile";
  userAgent?: string | null;
  ip?: string | null;
}

export async function createRefreshToken(
  userId: Types.ObjectId,
  meta: SessionMeta,
  familyId = randomToken(16),
): Promise<string> {
  const token = randomToken(48);
  await SessionModel.create({
    userId,
    tokenHash: sha256(token),
    familyId,
    client: meta.client,
    userAgent: meta.userAgent?.slice(0, 300) ?? null,
    ip: meta.ip ?? null,
    expiresAt: new Date(Date.now() + config.refreshTokenTtlDays * 24 * 60 * 60_000),
  });
  return token;
}

export type RotationResult = { userId: Types.ObjectId; refreshToken: string } | null;

export async function rotateRefreshToken(token: string, meta: SessionMeta): Promise<RotationResult> {
  const session = await SessionModel.findOne({ tokenHash: sha256(token) });
  if (!session) return null;
  const now = Date.now();
  if (session.revokedAt || session.expiresAt.getTime() < now) return null;
  if (session.rotatedAt) {
    if (now - session.rotatedAt.getTime() > ROTATION_GRACE_MS) {
      // Token reuse: someone replayed an old refresh token. Revoke the whole family.
      await SessionModel.updateMany({ familyId: session.familyId }, { $set: { revokedAt: new Date() } });
      return null;
    }
  } else {
    session.rotatedAt = new Date();
    await session.save();
  }
  const refreshToken = await createRefreshToken(session.userId, meta, session.familyId);
  return { userId: session.userId, refreshToken };
}

export async function revokeRefreshToken(token: string): Promise<void> {
  const session = await SessionModel.findOne({ tokenHash: sha256(token) });
  if (session) await SessionModel.updateMany({ familyId: session.familyId }, { $set: { revokedAt: new Date() } });
}

export async function revokeAllSessions(userId: Types.ObjectId): Promise<void> {
  await SessionModel.updateMany({ userId, revokedAt: null }, { $set: { revokedAt: new Date() } });
}

export const REFRESH_COOKIE = "fika_rt";
export const REFRESH_COOKIE_PATH = "/api/v1/auth";
