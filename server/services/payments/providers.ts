import crypto from "node:crypto";
import { config } from "../../config";
import { randomCode } from "../../lib/crypto";
import { logger } from "../../lib/logger";

// Mobile money provider abstraction. The booking flow and the frontend only talk to this interface,
// so switching from the mock provider to live MTN MoMo / Airtel Money needs configuration only.

export type ProviderMethod = "mtn" | "airtel";

export interface InitiateInput {
  paymentId: string;
  amount: number;
  /** E.164, e.g. +250788123456 */
  phone: string;
  description: string;
}

export interface InitiateResult {
  providerRef: string;
  status: "pending" | "failed";
  reason?: string;
}

export interface StatusResult {
  status: "pending" | "success" | "failed";
  reason?: string;
}

export interface RefundResult {
  status: "success" | "pending" | "failed";
  reason?: string;
}

export interface PaymentProvider {
  method: ProviderMethod;
  mode: "mock" | "live";
  initiate(input: InitiateInput): Promise<InitiateResult>;
  checkStatus(providerRef: string): Promise<StatusResult>;
  refund(input: { providerRef: string; amount: number; phone: string; paymentId: string }): Promise<RefundResult>;
}

// ── Mock provider (development & tests) ──────────────────────────────────────
// Simulates initiation → pending → confirmation/failure. Numbers ending in 0000 fail
// ("insufficient funds"); every other number succeeds after MOCK_PAYMENT_DELAY_MS.

export function mockOutcome(phone: string): StatusResult {
  return phone.endsWith("0000") ? { status: "failed", reason: "Insufficient funds (test number)" } : { status: "success" };
}

function mockProvider(method: ProviderMethod): PaymentProvider {
  return {
    method,
    mode: "mock",
    async initiate() {
      return { providerRef: `MOCK-${method.toUpperCase()}-${randomCode(10)}`, status: "pending" };
    },
    async checkStatus() {
      return { status: "pending" };
    },
    async refund() {
      return { status: "success" };
    },
  };
}

// ── MTN MoMo Collections API ─────────────────────────────────────────────────
// https://momodeveloper.mtn.com — request-to-pay with status polling (callbacks optional).

let mtnToken: { value: string; expiresAt: number } | null = null;

async function mtnAccessToken(): Promise<string> {
  const c = config.payments.mtn;
  if (mtnToken && mtnToken.expiresAt > Date.now() + 30_000) return mtnToken.value;
  const res = await fetch(`${c.baseUrl}/collection/token/`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${c.apiUser}:${c.apiKey}`).toString("base64")}`,
      "Ocp-Apim-Subscription-Key": c.subscriptionKey ?? "",
    },
  });
  if (!res.ok) throw new Error(`MTN token request failed: ${res.status}`);
  const json = (await res.json()) as { access_token: string; expires_in: number };
  mtnToken = { value: json.access_token, expiresAt: Date.now() + json.expires_in * 1000 };
  return json.access_token;
}

const mtnLive: PaymentProvider = {
  method: "mtn",
  mode: "live",
  async initiate({ paymentId, amount, phone, description }) {
    const c = config.payments.mtn;
    const referenceId = crypto.randomUUID();
    const headers: Record<string, string> = {
      Authorization: `Bearer ${await mtnAccessToken()}`,
      "X-Reference-Id": referenceId,
      "X-Target-Environment": c.targetEnvironment,
      "Ocp-Apim-Subscription-Key": c.subscriptionKey ?? "",
      "Content-Type": "application/json",
    };
    if (c.callbackUrl) headers["X-Callback-Url"] = c.callbackUrl;
    const res = await fetch(`${c.baseUrl}/collection/v1_0/requesttopay`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        amount: String(Math.round(amount)),
        // The MTN sandbox only accepts EUR.
        currency: c.targetEnvironment === "sandbox" ? "EUR" : "RWF",
        externalId: paymentId,
        payer: { partyIdType: "MSISDN", partyId: phone.replace("+", "") },
        payerMessage: description.slice(0, 160),
        payeeNote: description.slice(0, 160),
      }),
    });
    if (res.status !== 202) {
      return { providerRef: referenceId, status: "failed", reason: `MTN rejected the request (${res.status})` };
    }
    return { providerRef: referenceId, status: "pending" };
  },
  async checkStatus(providerRef) {
    const c = config.payments.mtn;
    const res = await fetch(`${c.baseUrl}/collection/v1_0/requesttopay/${providerRef}`, {
      headers: {
        Authorization: `Bearer ${await mtnAccessToken()}`,
        "X-Target-Environment": c.targetEnvironment,
        "Ocp-Apim-Subscription-Key": c.subscriptionKey ?? "",
      },
    });
    if (!res.ok) return { status: "pending" };
    const json = (await res.json()) as { status?: string; reason?: string | { message?: string } };
    if (json.status === "SUCCESSFUL") return { status: "success" };
    if (json.status === "FAILED" || json.status === "REJECTED" || json.status === "TIMEOUT") {
      const reason = typeof json.reason === "string" ? json.reason : json.reason?.message;
      return { status: "failed", reason: reason ?? json.status };
    }
    return { status: "pending" };
  },
  async refund() {
    // Refunds go through the separate MoMo Disbursement product; queued for the finance team.
    logger.warn("MTN refund requires a Disbursement account; refund queued for manual processing");
    return { status: "pending", reason: "Queued for manual disbursement" };
  },
};

// ── Airtel Money (Africa) API ────────────────────────────────────────────────

let airtelToken: { value: string; expiresAt: number } | null = null;

async function airtelAccessToken(): Promise<string> {
  const c = config.payments.airtel;
  if (airtelToken && airtelToken.expiresAt > Date.now() + 30_000) return airtelToken.value;
  const res = await fetch(`${c.baseUrl}/auth/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "*/*" },
    body: JSON.stringify({ client_id: c.clientId, client_secret: c.clientSecret, grant_type: "client_credentials" }),
  });
  if (!res.ok) throw new Error(`Airtel token request failed: ${res.status}`);
  const json = (await res.json()) as { access_token: string; expires_in: number | string };
  airtelToken = { value: json.access_token, expiresAt: Date.now() + Number(json.expires_in) * 1000 };
  return json.access_token;
}

function airtelHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    "X-Country": "RW",
    "X-Currency": "RWF",
    "Content-Type": "application/json",
    Accept: "*/*",
  };
}

const airtelLive: PaymentProvider = {
  method: "airtel",
  mode: "live",
  async initiate({ paymentId, amount, phone, description }) {
    const c = config.payments.airtel;
    const res = await fetch(`${c.baseUrl}/merchant/v1/payments/`, {
      method: "POST",
      headers: airtelHeaders(await airtelAccessToken()),
      body: JSON.stringify({
        reference: description.slice(0, 64),
        subscriber: { country: "RW", currency: "RWF", msisdn: phone.replace("+250", "") },
        transaction: { amount: Math.round(amount), country: "RW", currency: "RWF", id: paymentId },
      }),
    });
    const json = (await res.json().catch(() => ({}))) as { status?: { success?: boolean; message?: string } };
    if (!res.ok || json.status?.success === false) {
      return { providerRef: paymentId, status: "failed", reason: json.status?.message ?? `Airtel error ${res.status}` };
    }
    return { providerRef: paymentId, status: "pending" };
  },
  async checkStatus(providerRef) {
    const c = config.payments.airtel;
    const res = await fetch(`${c.baseUrl}/standard/v1/payments/${providerRef}`, {
      headers: airtelHeaders(await airtelAccessToken()),
    });
    if (!res.ok) return { status: "pending" };
    const json = (await res.json()) as { data?: { transaction?: { status?: string; message?: string } } };
    const status = json.data?.transaction?.status;
    if (status === "TS") return { status: "success" };
    if (status === "TF" || status === "TE") return { status: "failed", reason: json.data?.transaction?.message ?? status };
    return { status: "pending" };
  },
  async refund() {
    logger.warn("Airtel refund queued for manual processing");
    return { status: "pending", reason: "Queued for manual refund" };
  },
};

const mocks = { mtn: mockProvider("mtn"), airtel: mockProvider("airtel") };

export function getProvider(method: ProviderMethod): PaymentProvider {
  if (method === "mtn") return config.payments.mtn.mode === "live" ? mtnLive : mocks.mtn;
  return config.payments.airtel.mode === "live" ? airtelLive : mocks.airtel;
}
