// Minimal structured logger: JSON lines in production, readable lines in development.

type Level = "debug" | "info" | "warn" | "error";
const ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

const isProd = process.env.NODE_ENV === "production";
const isTest = process.env.NODE_ENV === "test";
const minLevel: Level = (process.env.LOG_LEVEL as Level) ?? (isTest ? "warn" : isProd ? "info" : "debug");

function write(level: Level, message: string, fields?: Record<string, unknown>): void {
  if (ORDER[level] < ORDER[minLevel]) return;
  const stream = level === "error" || level === "warn" ? process.stderr : process.stdout;
  if (isProd) {
    stream.write(`${JSON.stringify({ t: new Date().toISOString(), level, msg: message, ...fields })}\n`);
    return;
  }
  const time = new Date().toISOString().slice(11, 19);
  const extra = fields && Object.keys(fields).length ? ` ${JSON.stringify(fields)}` : "";
  stream.write(`${time} ${level.toUpperCase().padEnd(5)} ${message}${extra}\n`);
}

export const logger = {
  debug: (msg: string, fields?: Record<string, unknown>) => write("debug", msg, fields),
  info: (msg: string, fields?: Record<string, unknown>) => write("info", msg, fields),
  warn: (msg: string, fields?: Record<string, unknown>) => write("warn", msg, fields),
  error: (msg: string, fields?: Record<string, unknown>) => write("error", msg, fields),
};

export function errorFields(err: unknown): Record<string, unknown> {
  if (err instanceof Error) return { error: err.message, stack: isProd ? undefined : err.stack };
  return { error: String(err) };
}
