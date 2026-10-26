import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { config } from "../config";
import { randomToken } from "../lib/crypto";

// File storage for operator and vehicle documents. "local" writes to disk (development, single
// server); "s3" works with any S3-compatible service using AWS Signature V4 (no SDK needed).

export interface StoredObject {
  driver: "local" | "s3";
  key: string;
}

export function objectKey(purpose: string, filename: string): string {
  const now = new Date();
  const safe = filename
    .normalize("NFKD")
    .replace(/[^\w.-]+/g, "_")
    .slice(-80);
  return `${purpose}/${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, "0")}/${randomToken(12)}-${safe}`;
}

// ── AWS Signature V4 ─────────────────────────────────────────────────────────

const sha256Hex = (data: string | Buffer) => crypto.createHash("sha256").update(data).digest("hex");
const hmac = (key: Buffer | string, data: string) => crypto.createHmac("sha256", key).update(data).digest();

function encodeRfc3986(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

export interface S3Target {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle: boolean;
}

function s3Location(t: S3Target, key: string): { host: string; origin: string; canonicalUri: string } {
  const endpoint = new URL(t.endpoint);
  const encodedKey = key.split("/").map(encodeRfc3986).join("/");
  if (t.forcePathStyle) {
    return { host: endpoint.host, origin: `${endpoint.protocol}//${endpoint.host}`, canonicalUri: `/${t.bucket}/${encodedKey}` };
  }
  const host = `${t.bucket}.${endpoint.host}`;
  return { host, origin: `${endpoint.protocol}//${host}`, canonicalUri: `/${encodedKey}` };
}

function signingKey(secret: string, dateStamp: string, region: string): Buffer {
  return hmac(hmac(hmac(hmac(`AWS4${secret}`, dateStamp), region), "s3"), "aws4_request");
}

function amzDates(now: Date) {
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  return { amzDate, dateStamp: amzDate.slice(0, 8) };
}

/** Pre-signed GET URL (query-string auth). */
export function presignGetUrl(t: S3Target, key: string, expiresSeconds: number, now = new Date()): string {
  const { host, origin, canonicalUri } = s3Location(t, key);
  const { amzDate, dateStamp } = amzDates(now);
  const scope = `${dateStamp}/${t.region}/s3/aws4_request`;
  const params: [string, string][] = [
    ["X-Amz-Algorithm", "AWS4-HMAC-SHA256"],
    ["X-Amz-Credential", `${t.accessKeyId}/${scope}`],
    ["X-Amz-Date", amzDate],
    ["X-Amz-Expires", String(expiresSeconds)],
    ["X-Amz-SignedHeaders", "host"],
  ];
  const canonicalQuery = params
    .map(([k, v]) => [encodeRfc3986(k), encodeRfc3986(v)])
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([k, v]) => `${k}=${v}`)
    .join("&");
  const canonicalRequest = ["GET", canonicalUri, canonicalQuery, `host:${host}\n`, "host", "UNSIGNED-PAYLOAD"].join("\n");
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256Hex(canonicalRequest)].join("\n");
  const signature = hmac(signingKey(t.secretAccessKey, dateStamp, t.region), stringToSign).toString("hex");
  return `${origin}${canonicalUri}?${canonicalQuery}&X-Amz-Signature=${signature}`;
}

function signedHeadersFor(t: S3Target, method: string, key: string, body: Buffer, now = new Date()) {
  const { host, origin, canonicalUri } = s3Location(t, key);
  const { amzDate, dateStamp } = amzDates(now);
  const payloadHash = sha256Hex(body);
  const scope = `${dateStamp}/${t.region}/s3/aws4_request`;
  const canonicalHeaders = `host:${host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amzDate}\n`;
  const signedHeaders = "host;x-amz-content-sha256;x-amz-date";
  const canonicalRequest = [method, canonicalUri, "", canonicalHeaders, signedHeaders, payloadHash].join("\n");
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256Hex(canonicalRequest)].join("\n");
  const signature = hmac(signingKey(t.secretAccessKey, dateStamp, t.region), stringToSign).toString("hex");
  return {
    url: `${origin}${canonicalUri}`,
    headers: {
      "x-amz-content-sha256": payloadHash,
      "x-amz-date": amzDate,
      Authorization: `AWS4-HMAC-SHA256 Credential=${t.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    },
  };
}

function s3Config(): S3Target {
  const s3 = config.storage.s3;
  if (!s3.endpoint || !s3.bucket || !s3.accessKeyId || !s3.secretAccessKey) {
    throw new Error("S3 storage is selected but S3_ENDPOINT, S3_BUCKET or credentials are missing");
  }
  return {
    endpoint: s3.endpoint,
    region: s3.region,
    bucket: s3.bucket,
    accessKeyId: s3.accessKeyId,
    secretAccessKey: s3.secretAccessKey,
    forcePathStyle: s3.forcePathStyle,
  };
}

// ── Public API ───────────────────────────────────────────────────────────────

export async function putObject(key: string, body: Buffer, contentType: string): Promise<StoredObject> {
  if (config.storage.driver === "s3") {
    const t = s3Config();
    const { url, headers } = signedHeadersFor(t, "PUT", key, body);
    const res = await fetch(url, { method: "PUT", headers: { ...headers, "Content-Type": contentType }, body: new Uint8Array(body) });
    if (!res.ok) throw new Error(`S3 upload failed: ${res.status} ${await res.text()}`);
    return { driver: "s3", key };
  }
  const full = path.join(config.storage.localDir, key);
  await fs.promises.mkdir(path.dirname(full), { recursive: true });
  await fs.promises.writeFile(full, body);
  return { driver: "local", key };
}

/** Local files are streamed by the API; S3 files are served through a short-lived signed URL. */
export function readLocalObject(key: string): fs.ReadStream {
  const full = path.resolve(config.storage.localDir, key);
  if (!full.startsWith(path.resolve(config.storage.localDir))) throw new Error("Invalid key");
  return fs.createReadStream(full);
}

export function signedObjectUrl(key: string, expiresSeconds = 300): string {
  return presignGetUrl(s3Config(), key, expiresSeconds);
}
