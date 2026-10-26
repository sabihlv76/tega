import fs from "node:fs";
import path from "node:path";
import { z } from "zod";

// Loads .env / .env.local without overriding variables already set in the environment,
// validates them and exposes a typed, frozen configuration object.

function loadEnvFiles(): void {
  for (const file of [".env.local", ".env"]) {
    const full = path.resolve(process.cwd(), file);
    if (!fs.existsSync(full)) continue;
    for (const rawLine of fs.readFileSync(full, "utf8").split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) continue;
      const eq = line.indexOf("=");
      if (eq <= 0) continue;
      const key = line.slice(0, eq).trim();
      let value = line.slice(eq + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      if (process.env[key] === undefined) process.env[key] = value;
    }
  }
}

const bool = z
  .string()
  .optional()
  .transform((v) => v === "1" || v?.toLowerCase() === "true");

const optionalString = z
  .string()
  .optional()
  .transform((v) => (v && v.trim() !== "" ? v.trim() : undefined));

const DEV_SECRET = "dev-only-insecure-secret-change-me-0123456789";

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  API_PORT: z.coerce.number().int().positive().default(4000),
  WEB_URL: z.string().default("http://localhost:4544"),
  CORS_ORIGINS: z.string().default("http://localhost:4544,http://127.0.0.1:4544"),
  TRUST_PROXY: bool,
  MONGODB_URI: optionalString,
  MONGODB_DB_NAME: optionalString,
  SEED_ON_EMPTY: z
    .string()
    .optional()
    .transform((v) => v === undefined || v === "" || v === "1" || v.toLowerCase() === "true"),
  JWT_SECRET: optionalString,
  TICKET_SECRET: optionalString,
  ACCESS_TOKEN_TTL: z.coerce.number().int().positive().default(900),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(30),
  SMS_PROVIDER: z.enum(["console", "africastalking"]).default("console"),
  AT_USERNAME: optionalString,
  AT_API_KEY: optionalString,
  AT_SENDER_ID: optionalString,
  AT_SANDBOX: z
    .string()
    .optional()
    .transform((v) => v === undefined || v === "" || v === "1" || v.toLowerCase() === "true"),
  EMAIL_PROVIDER: z.enum(["console", "smtp"]).default("console"),
  EMAIL_FROM: z.string().default("FIKA <no-reply@fika.rw>"),
  SMTP_HOST: optionalString,
  SMTP_PORT: z.coerce.number().int().positive().default(587),
  SMTP_SECURE: bool,
  SMTP_USER: optionalString,
  SMTP_PASS: optionalString,
  GOOGLE_CLIENT_ID: optionalString,
  GOOGLE_CLIENT_SECRET: optionalString,
  PAYMENTS_MTN_MODE: z.enum(["mock", "live"]).default("mock"),
  MTN_MOMO_BASE_URL: z.string().default("https://sandbox.momodeveloper.mtn.com"),
  MTN_MOMO_TARGET_ENV: z.string().default("sandbox"),
  MTN_MOMO_SUBSCRIPTION_KEY: optionalString,
  MTN_MOMO_API_USER: optionalString,
  MTN_MOMO_API_KEY: optionalString,
  MTN_MOMO_CALLBACK_URL: optionalString,
  PAYMENTS_AIRTEL_MODE: z.enum(["mock", "live"]).default("mock"),
  AIRTEL_BASE_URL: z.string().default("https://openapiuat.airtel.africa"),
  AIRTEL_CLIENT_ID: optionalString,
  AIRTEL_CLIENT_SECRET: optionalString,
  PAYMENT_WEBHOOK_SECRET: optionalString,
  MOCK_PAYMENT_DELAY_MS: z.coerce.number().int().nonnegative().default(4000),
  STORAGE_DRIVER: z.enum(["local", "s3"]).default("local"),
  STORAGE_LOCAL_DIR: z.string().default("uploads"),
  S3_ENDPOINT: optionalString,
  S3_REGION: z.string().default("auto"),
  S3_BUCKET: optionalString,
  S3_ACCESS_KEY_ID: optionalString,
  S3_SECRET_ACCESS_KEY: optionalString,
  S3_FORCE_PATH_STYLE: z
    .string()
    .optional()
    .transform((v) => v === undefined || v === "" || v === "1" || v.toLowerCase() === "true"),
  JOBS_ENABLED: z
    .string()
    .optional()
    .transform((v) => v === undefined || v === "" || v === "1" || v.toLowerCase() === "true"),
});

export type AppConfig = ReturnType<typeof buildConfig>;

function buildConfig(env: NodeJS.ProcessEnv) {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Invalid configuration: ${issues}`);
  }
  const e = parsed.data;
  const isProd = e.NODE_ENV === "production";
  if (isProd) {
    for (const key of ["MONGODB_URI", "JWT_SECRET", "TICKET_SECRET"] as const) {
      if (!e[key]) throw new Error(`${key} is required in production`);
    }
    for (const key of ["JWT_SECRET", "TICKET_SECRET"] as const) {
      if ((e[key] ?? "").length < 32) throw new Error(`${key} must be at least 32 characters in production`);
    }
  }
  const mtnLive = e.PAYMENTS_MTN_MODE === "live" && !!(e.MTN_MOMO_SUBSCRIPTION_KEY && e.MTN_MOMO_API_USER && e.MTN_MOMO_API_KEY);
  const airtelLive = e.PAYMENTS_AIRTEL_MODE === "live" && !!(e.AIRTEL_CLIENT_ID && e.AIRTEL_CLIENT_SECRET);

  return Object.freeze({
    env: e.NODE_ENV,
    isProd,
    isDev: e.NODE_ENV === "development",
    isTest: e.NODE_ENV === "test",
    port: e.API_PORT,
    webUrl: e.WEB_URL.replace(/\/$/, ""),
    corsOrigins: e.CORS_ORIGINS.split(",")
      .map((o) => o.trim().replace(/\/$/, ""))
      .filter(Boolean),
    trustProxy: e.TRUST_PROXY,
    mongoUri: e.MONGODB_URI,
    mongoDbName: e.MONGODB_DB_NAME,
    seedOnEmpty: e.SEED_ON_EMPTY,
    jwtSecret: e.JWT_SECRET ?? DEV_SECRET,
    ticketSecret: e.TICKET_SECRET ?? `${DEV_SECRET}-tickets`,
    usingDevSecrets: !e.JWT_SECRET || !e.TICKET_SECRET,
    accessTokenTtl: e.ACCESS_TOKEN_TTL,
    refreshTokenTtlDays: e.REFRESH_TOKEN_TTL_DAYS,
    sms: {
      provider: e.SMS_PROVIDER,
      africastalking: {
        username: e.AT_USERNAME ?? "sandbox",
        apiKey: e.AT_API_KEY,
        senderId: e.AT_SENDER_ID,
        sandbox: e.AT_SANDBOX,
      },
    },
    email: {
      provider: e.EMAIL_PROVIDER,
      from: e.EMAIL_FROM,
      smtp: { host: e.SMTP_HOST, port: e.SMTP_PORT, secure: e.SMTP_SECURE, user: e.SMTP_USER, pass: e.SMTP_PASS },
    },
    google: {
      clientId: e.GOOGLE_CLIENT_ID,
      clientSecret: e.GOOGLE_CLIENT_SECRET,
      enabled: !!(e.GOOGLE_CLIENT_ID && e.GOOGLE_CLIENT_SECRET),
    },
    payments: {
      mtn: {
        mode: (mtnLive ? "live" : "mock") as "live" | "mock",
        baseUrl: e.MTN_MOMO_BASE_URL.replace(/\/$/, ""),
        targetEnvironment: e.MTN_MOMO_TARGET_ENV,
        subscriptionKey: e.MTN_MOMO_SUBSCRIPTION_KEY,
        apiUser: e.MTN_MOMO_API_USER,
        apiKey: e.MTN_MOMO_API_KEY,
        callbackUrl: e.MTN_MOMO_CALLBACK_URL,
      },
      airtel: {
        mode: (airtelLive ? "live" : "mock") as "live" | "mock",
        baseUrl: e.AIRTEL_BASE_URL.replace(/\/$/, ""),
        clientId: e.AIRTEL_CLIENT_ID,
        clientSecret: e.AIRTEL_CLIENT_SECRET,
      },
      webhookSecret: e.PAYMENT_WEBHOOK_SECRET,
      mockDelayMs: e.MOCK_PAYMENT_DELAY_MS,
    },
    storage: {
      driver: e.STORAGE_DRIVER,
      localDir: path.resolve(process.cwd(), e.STORAGE_LOCAL_DIR),
      s3: {
        endpoint: e.S3_ENDPOINT,
        region: e.S3_REGION,
        bucket: e.S3_BUCKET,
        accessKeyId: e.S3_ACCESS_KEY_ID,
        secretAccessKey: e.S3_SECRET_ACCESS_KEY,
        forcePathStyle: e.S3_FORCE_PATH_STYLE,
      },
    },
    jobsEnabled: e.JOBS_ENABLED,
  });
}

loadEnvFiles();
export const config = buildConfig(process.env);
