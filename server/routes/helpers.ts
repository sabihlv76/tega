import type { Request, Response } from "express";
import type { Types } from "mongoose";
import type { AuthResponse, UserDTO } from "../../shared/types";
import { config } from "../config";
import { ApiError } from "../lib/errors";
import { OperatorModel, type UserDoc } from "../models";
import type { Actor } from "../services/audit";
import { ensureLookups } from "../services/lookup";
import { userDTO } from "../services/serializers";
import { createRefreshToken, REFRESH_COOKIE, REFRESH_COOKIE_PATH, signAccessToken } from "../services/tokens";

export function parseCookies(req: Request): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (req.headers.cookie ?? "").split(";")) {
    const eq = part.indexOf("=");
    if (eq <= 0) continue;
    const key = part.slice(0, eq).trim();
    try {
      out[key] = decodeURIComponent(part.slice(eq + 1).trim());
    } catch {
      out[key] = part.slice(eq + 1).trim();
    }
  }
  return out;
}

export function isMobileClient(req: Request): boolean {
  return req.headers["x-fika-client"] === "mobile";
}

export function setRefreshCookie(res: Response, token: string): void {
  res.cookie(REFRESH_COOKIE, token, {
    httpOnly: true,
    secure: config.isProd,
    sameSite: "lax",
    path: REFRESH_COOKIE_PATH,
    maxAge: config.refreshTokenTtlDays * 24 * 60 * 60_000,
  });
}

export function clearRefreshCookie(res: Response): void {
  res.clearCookie(REFRESH_COOKIE, { path: REFRESH_COOKIE_PATH, httpOnly: true, secure: config.isProd, sameSite: "lax" });
}

export async function toUserDTO(user: UserDoc | (Parameters<typeof userDTO>[0] & { operatorId?: Types.ObjectId | null })): Promise<UserDTO> {
  await ensureLookups();
  const plain = "toObject" in user ? (user as UserDoc).toObject() : user;
  const operator = plain.operatorId ? await OperatorModel.findById(plain.operatorId, { name: 1, status: 1 }).lean() : null;
  return userDTO(plain, { operator });
}

export async function issueSession(req: Request, res: Response, user: UserDoc, isNewUser = false): Promise<AuthResponse> {
  const mobile = isMobileClient(req);
  const [accessToken, refreshToken] = await Promise.all([
    signAccessToken(user),
    createRefreshToken(user._id, { client: mobile ? "mobile" : "web", userAgent: req.headers["user-agent"], ip: req.ip }),
  ]);
  if (!mobile) setRefreshCookie(res, refreshToken);
  return {
    accessToken,
    expiresIn: config.accessTokenTtl,
    user: await toUserDTO(user),
    isNewUser,
    ...(mobile ? { refreshToken } : {}),
  };
}

export function actorOf(req: Request): Actor {
  if (!req.user) throw new ApiError(401, "UNAUTHORIZED");
  return { id: req.user._id, role: req.user.role, ip: req.ip ?? null };
}

export function requireUser(req: Request): UserDoc {
  if (!req.user) throw new ApiError(401, "UNAUTHORIZED");
  return req.user;
}

/** Only allow relative in-app redirects (prevents open redirects after sign-in). */
export function safeNext(value: unknown): string {
  return typeof value === "string" && /^\/(?!\/)[\w\-/?=&.%]*$/.test(value) ? value : "/";
}

export function sendCsv(res: Response, filename: string, csv: string): void {
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.send(`﻿${csv}`);
}
