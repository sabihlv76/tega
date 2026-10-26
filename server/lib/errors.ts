import type { en } from "../../shared/i18n/messages/en";

export type ErrorCode = keyof (typeof en)["errors"];

/** An error that is safe to show to API clients. The message is translated at response time. */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: ErrorCode,
    public readonly details?: unknown,
    message?: string,
  ) {
    super(message ?? code);
    this.name = "ApiError";
  }
}

export const badRequest = (code: ErrorCode = "VALIDATION_ERROR", details?: unknown) =>
  new ApiError(400, code, details);
export const unauthorized = (code: ErrorCode = "UNAUTHORIZED") => new ApiError(401, code);
export const forbidden = (code: ErrorCode = "FORBIDDEN") => new ApiError(403, code);
export const notFound = (details?: unknown) => new ApiError(404, "NOT_FOUND", details);
export const conflict = (code: ErrorCode, details?: unknown) => new ApiError(409, code, details);
