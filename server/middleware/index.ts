import type { NextFunction, Request, RequestHandler, Response } from "express";
import mongoose from "mongoose";
import { ZodError, type ZodType } from "zod";
import type { Role } from "../../shared/constants";
import { resolveLocale } from "../../shared/i18n";
import { getTranslator } from "../../shared/i18n/catalog";
import { config } from "../config";
import { randomToken } from "../lib/crypto";
import { ApiError } from "../lib/errors";
import { errorFields, logger } from "../lib/logger";
import { UserModel } from "../models";
import { verifyAccessToken } from "../services/tokens";

// ── Request context, logging, security headers, CORS ─────────────────────────

export const requestContext: RequestHandler = (req, res, next) => {
  req.requestId = randomToken(8);
  req.valid = {};
  req.locale = resolveLocale((req.headers["x-fika-locale"] as string | undefined) ?? req.headers["accept-language"]);
  res.setHeader("X-Request-Id", req.requestId);
  next();
};

export const requestLogger: RequestHandler = (req, res, next) => {
  const started = process.hrtime.bigint();
  res.on("finish", () => {
    if (req.path === "/api/v1/health") return;
    const ms = Number(process.hrtime.bigint() - started) / 1e6;
    const fields = { status: res.statusCode, ms: Math.round(ms), user: req.user?._id?.toString(), id: req.requestId };
    if (res.statusCode >= 500) logger.error(`${req.method} ${req.originalUrl}`, fields);
    else logger.debug(`${req.method} ${req.originalUrl}`, fields);
  });
  next();
};

export const securityHeaders: RequestHandler = (_req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Cross-Origin-Resource-Policy", "same-site");
  if (config.isProd) res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  next();
};

export const cors: RequestHandler = (req, res, next) => {
  const origin = req.headers.origin;
  if (origin && config.corsOrigins.includes(origin.replace(/\/$/, ""))) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Credentials", "true");
    res.setHeader("Vary", "Origin");
    if (req.method === "OPTIONS") {
      res.setHeader("Access-Control-Allow-Methods", "GET,POST,PATCH,PUT,DELETE,OPTIONS");
      res.setHeader(
        "Access-Control-Allow-Headers",
        "Authorization,Content-Type,X-Fika-Locale,X-Fika-Client,X-Webhook-Secret",
      );
      res.setHeader("Access-Control-Max-Age", "600");
      res.status(204).end();
      return;
    }
  }
  next();
};

// ── Authentication & role-based access control (enforced on the API, not just the UI) ──

export const authenticate: RequestHandler = async (req, _res, next) => {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) return next();
  const claims = await verifyAccessToken(header.slice(7));
  if (!claims || !mongoose.isValidObjectId(claims.sub)) return next(new ApiError(401, "UNAUTHORIZED"));
  const user = await UserModel.findById(claims.sub);
  if (!user) return next(new ApiError(401, "UNAUTHORIZED"));
  if (user.status === "suspended") return next(new ApiError(403, "ACCOUNT_SUSPENDED"));
  req.user = user;
  if (!req.headers["x-fika-locale"]) req.locale = user.language as Request["locale"];
  next();
};

export const requireAuth: RequestHandler = (req, _res, next) => {
  if (!req.user) return next(new ApiError(401, "UNAUTHORIZED"));
  next();
};

export function requireRole(...roles: Role[]): RequestHandler {
  return (req, _res, next) => {
    if (!req.user) return next(new ApiError(401, "UNAUTHORIZED"));
    if (!roles.includes(req.user.role as Role)) return next(new ApiError(403, "FORBIDDEN"));
    if (req.user.role === "operator" && !req.user.operatorId) return next(new ApiError(403, "FORBIDDEN"));
    next();
  };
}

// ── Validation ───────────────────────────────────────────────────────────────

export function validate(schemas: { body?: ZodType; query?: ZodType; params?: ZodType }): RequestHandler {
  return (req, _res, next) => {
    try {
      if (schemas.body) req.valid.body = schemas.body.parse(req.body ?? {});
      if (schemas.query) req.valid.query = schemas.query.parse(req.query ?? {});
      if (schemas.params) req.valid.params = schemas.params.parse(req.params ?? {});
      next();
    } catch (err) {
      next(err);
    }
  };
}

export function body<T>(req: Request): T {
  return req.valid.body as T;
}
export function query<T>(req: Request): T {
  return req.valid.query as T;
}

// ── Rate limiting (in-memory sliding window; use a shared store when scaling out) ──

interface Bucket {
  hits: number[];
}
const buckets = new Map<string, Bucket>();
setInterval(() => {
  const cutoff = Date.now() - 60 * 60_000;
  for (const [key, bucket] of buckets) {
    bucket.hits = bucket.hits.filter((t) => t > cutoff);
    if (bucket.hits.length === 0) buckets.delete(key);
  }
}, 5 * 60_000).unref();

export function rateLimit(options: { name: string; windowMs: number; max: number; key?: (req: Request) => string }): RequestHandler {
  return (req, res, next) => {
    if (config.isTest) return next();
    const id = options.key ? options.key(req) : req.ip ?? "unknown";
    const key = `${options.name}:${id}`;
    const now = Date.now();
    const bucket = buckets.get(key) ?? { hits: [] };
    bucket.hits = bucket.hits.filter((t) => t > now - options.windowMs);
    if (bucket.hits.length >= options.max) {
      const retryAfter = Math.ceil((bucket.hits[0] + options.windowMs - now) / 1000);
      res.setHeader("Retry-After", String(retryAfter));
      return next(new ApiError(429, "RATE_LIMITED", { retryAfter }));
    }
    bucket.hits.push(now);
    buckets.set(key, bucket);
    next();
  };
}

// ── Errors ───────────────────────────────────────────────────────────────────

export function notFoundHandler(_req: Request, _res: Response, next: NextFunction): void {
  next(new ApiError(404, "NOT_FOUND"));
}

export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction): void {
  const t = getTranslator(req.locale ?? "en");
  if (err instanceof ZodError) {
    res.status(400).json({
      error: {
        code: "VALIDATION_ERROR",
        message: t("errors.VALIDATION_ERROR"),
        details: err.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
      },
    });
    return;
  }
  if (err instanceof ApiError) {
    res.status(err.status).json({ error: { code: err.code, message: t(`errors.${err.code}`), details: err.details } });
    return;
  }
  if ((err as { code?: number }).code === 11000) {
    res.status(409).json({ error: { code: "DUPLICATE", message: t("errors.DUPLICATE"), details: (err as { keyValue?: unknown }).keyValue } });
    return;
  }
  if ((err as { type?: string }).type === "entity.too.large") {
    res.status(413).json({ error: { code: "FILE_TOO_LARGE", message: t("errors.FILE_TOO_LARGE") } });
    return;
  }
  if (err instanceof mongoose.Error.CastError) {
    res.status(404).json({ error: { code: "NOT_FOUND", message: t("errors.NOT_FOUND") } });
    return;
  }
  logger.error("Unhandled API error", { id: req.requestId, path: req.originalUrl, ...errorFields(err) });
  res.status(500).json({ error: { code: "INTERNAL", message: t("errors.INTERNAL"), details: { requestId: req.requestId } } });
}
