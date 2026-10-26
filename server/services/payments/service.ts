import { Types } from "mongoose";
import type { PaymentMethod } from "../../../shared/constants";
import { commissionOf, normalizeRwPhone, phoneMatchesMethod } from "../../../shared/money";
import type { PaymentDTO } from "../../../shared/types";
import { config } from "../../config";
import { enqueue } from "../../jobs/queue";
import { safeEqual } from "../../lib/crypto";
import { ApiError, badRequest, conflict, notFound } from "../../lib/errors";
import { logger } from "../../lib/logger";
import {
  type BookingDoc,
  BookingModel,
  OperatorModel,
  PaymentCallbackModel,
  type PaymentDoc,
  PaymentModel,
  type ParcelDoc,
  ParcelModel,
} from "../../models";
import { emit, rooms } from "../../realtime";
import { onBookingPaid, onBookingPaymentFailed, reserveForCash } from "../bookings";
import { onParcelPaid, onParcelPaymentFailed, reserveParcelForCash } from "../parcels";
import { paymentDTO } from "../serializers";
import { getSettings } from "../settings";
import { getProvider, mockOutcome, type ProviderMethod } from "./providers";

const IN_PROGRESS_WINDOW_MS = 2 * 60_000;
const POLL_INTERVAL_MS = 5_000;
const POLL_GIVE_UP_MS = 10 * 60_000;

type Target = { kind: "booking"; doc: BookingDoc } | { kind: "parcel"; doc: ParcelDoc };

async function loadTarget(kind: "booking" | "parcel", id: string, userId: Types.ObjectId): Promise<Target> {
  if (!Types.ObjectId.isValid(id)) throw notFound();
  if (kind === "booking") {
    const doc = await BookingModel.findOne({ _id: id, userId });
    if (!doc) throw notFound();
    return { kind, doc };
  }
  const doc = await ParcelModel.findOne({ _id: id, senderId: userId });
  if (!doc) throw notFound();
  return { kind, doc };
}

async function commissionRateFor(operatorId: Types.ObjectId): Promise<number> {
  const operator = await OperatorModel.findById(operatorId, { commissionRate: 1 }).lean();
  return operator?.commissionRate ?? (await getSettings()).commissionRate;
}

export async function initiatePayment(
  userId: Types.ObjectId,
  input: { kind: "booking" | "parcel"; id: string; method: PaymentMethod; phone?: string | null },
): Promise<PaymentDTO> {
  const target = await loadTarget(input.kind, input.id, userId);
  const doc = target.doc;
  if (doc.status !== "pending_payment") throw conflict("BOOKING_NOT_PAYABLE");
  if (doc.holdExpiresAt && doc.holdExpiresAt.getTime() < Date.now()) throw conflict("BOOKING_EXPIRED");

  const filter = input.kind === "booking" ? { bookingId: doc._id } : { parcelId: doc._id };
  const inFlight = await PaymentModel.findOne({
    ...filter,
    status: { $in: ["initiated", "pending"] },
    createdAt: { $gt: new Date(Date.now() - IN_PROGRESS_WINDOW_MS) },
  }).lean();
  if (inFlight) throw conflict("PAYMENT_IN_PROGRESS", { paymentId: inFlight._id.toString() });

  const amount = target.kind === "booking" ? target.doc.totalAmount : target.doc.priceRwf;

  if (input.method === "cash") {
    const payment = await PaymentModel.create({
      ...filter,
      kind: input.kind,
      operatorId: doc.operatorId,
      userId,
      method: "cash",
      mode: "live",
      amount,
      status: "pending",
      events: [{ status: "pending", note: "Pay at the station" }],
    });
    if (target.kind === "booking") await reserveForCash(target.doc);
    else await reserveParcelForCash(target.doc);
    return paymentDTO(payment.toObject());
  }

  const phone = normalizeRwPhone(input.phone ?? "");
  if (!phone) throw badRequest("PHONE_INVALID", { field: "phone" });
  if (!phoneMatchesMethod(phone, input.method)) throw badRequest("PAYMENT_METHOD_MISMATCH", { field: "phone" });

  const provider = getProvider(input.method as ProviderMethod);
  const payment = await PaymentModel.create({
    ...filter,
    kind: input.kind,
    operatorId: doc.operatorId,
    userId,
    method: input.method,
    mode: provider.mode,
    phone,
    amount,
    status: "initiated",
    events: [{ status: "initiated" }],
  });

  const description = target.kind === "booking" ? `FIKA ticket ${target.doc.reference}` : `FIKA parcel ${target.doc.code}`;
  let result: Awaited<ReturnType<typeof provider.initiate>>;
  try {
    result = await provider.initiate({ paymentId: payment._id.toString(), amount, phone, description });
  } catch (err) {
    logger.error("Payment initiation failed", { paymentId: payment._id.toString(), error: String(err) });
    result = { providerRef: "", status: "failed", reason: "Provider unavailable" };
  }

  payment.providerRef = result.providerRef || null;
  doc.paymentMethod = input.method;
  if (result.status === "pending") {
    payment.status = "pending";
    payment.events.push({ status: "pending", at: new Date(), note: null });
    doc.paymentStatus = "pending";
    // Give the customer time to approve on their phone before the hold can lapse.
    const minHold = new Date(Date.now() + 5 * 60_000);
    if (!doc.holdExpiresAt || doc.holdExpiresAt < minHold) doc.holdExpiresAt = minHold;
    await Promise.all([payment.save(), doc.save()]);
    if (provider.mode === "mock") {
      await enqueue("payment.mock.settle", { paymentId: payment._id.toString() }, { delayMs: config.payments.mockDelayMs });
    } else {
      await enqueue("payment.poll", { paymentId: payment._id.toString() }, { delayMs: POLL_INTERVAL_MS });
    }
  } else {
    await payment.save();
    await doc.save();
    await handlePaymentResult(payment._id, { status: "failed", reason: result.reason });
  }
  const fresh = await PaymentModel.findById(payment._id).lean();
  return paymentDTO(fresh ?? payment.toObject());
}

/** Applies a final provider outcome exactly once (webhooks, polling and mocks may all report it). */
export async function handlePaymentResult(
  paymentId: Types.ObjectId | string,
  outcome: { status: "success" | "failed"; reason?: string },
): Promise<void> {
  const payment = await PaymentModel.findOneAndUpdate(
    { _id: paymentId, status: { $in: ["initiated", "pending"] } },
    outcome.status === "success"
      ? { $set: { status: "success", paidAt: new Date() }, $push: { events: { status: "success", at: new Date() } } }
      : {
          $set: { status: "failed", failureReason: outcome.reason ?? "Declined" },
          $push: { events: { status: "failed", at: new Date(), note: outcome.reason ?? null } },
        },
    { returnDocument: "after" },
  );
  if (!payment) return; // already final

  if (outcome.status === "success") {
    const rate = await commissionRateFor(payment.operatorId);
    payment.commissionRate = rate;
    payment.commissionAmount = commissionOf(payment.amount, rate);
    payment.operatorAmount = payment.amount - payment.commissionAmount;
    await payment.save();
    if (payment.kind === "booking") await onBookingPaid(payment);
    else await onParcelPaid(payment);
  } else if (payment.kind === "booking") {
    await onBookingPaymentFailed(payment);
  } else {
    await onParcelPaymentFailed(payment);
  }
  if (payment.userId) emit(rooms.user(payment.userId.toString()), "payment.updated", paymentDTO(payment.toObject()));
}

export async function getPaymentForUser(paymentId: string, userId: Types.ObjectId): Promise<PaymentDTO> {
  if (!Types.ObjectId.isValid(paymentId)) throw notFound();
  const payment = await PaymentModel.findOne({ _id: paymentId, userId }).lean();
  if (!payment) throw notFound();
  return paymentDTO(payment);
}

export async function latestPaymentFor(kind: "booking" | "parcel", id: Types.ObjectId): Promise<PaymentDTO | null> {
  const payment = await PaymentModel.findOne(kind === "booking" ? { bookingId: id } : { parcelId: id })
    .sort({ createdAt: -1 })
    .lean();
  return payment ? paymentDTO(payment) : null;
}

// ── Jobs ─────────────────────────────────────────────────────────────────────

export async function settleMockPayment(paymentId: string): Promise<void> {
  const payment = await PaymentModel.findById(paymentId).lean();
  if (!payment || (payment.status !== "pending" && payment.status !== "initiated")) return;
  const outcome = mockOutcome(payment.phone ?? "");
  await handlePaymentResult(payment._id, outcome.status === "success" ? { status: "success" } : { status: "failed", reason: outcome.reason });
}

export async function pollPayment(paymentId: string): Promise<void> {
  const payment = await PaymentModel.findById(paymentId).lean();
  if (!payment || payment.status !== "pending" || !payment.providerRef) return;
  const provider = getProvider(payment.method as ProviderMethod);
  const status = await provider.checkStatus(payment.providerRef);
  if (status.status === "success") return handlePaymentResult(payment._id, { status: "success" });
  if (status.status === "failed") return handlePaymentResult(payment._id, { status: "failed", reason: status.reason });
  if (Date.now() - payment.createdAt.getTime() > POLL_GIVE_UP_MS) {
    return handlePaymentResult(payment._id, { status: "failed", reason: "No confirmation from the customer" });
  }
  await enqueue("payment.poll", { paymentId }, { delayMs: POLL_INTERVAL_MS });
}

// ── Webhooks ─────────────────────────────────────────────────────────────────

export async function processWebhook(provider: string, rawBody: string, secretHeader: string | undefined): Promise<void> {
  const expected = config.payments.webhookSecret;
  if (expected && !(secretHeader && safeEqual(secretHeader, expected))) throw new ApiError(401, "UNAUTHORIZED");
  if (!expected && config.isProd) throw new ApiError(401, "UNAUTHORIZED");

  const log = await PaymentCallbackModel.create({ provider, payload: rawBody.slice(0, 20_000) });
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(rawBody) as Record<string, unknown>;
  } catch {
    log.error = "Invalid JSON";
    await log.save();
    throw badRequest();
  }

  let paymentId: string | null = null;
  let providerRef: string | null = null;
  let status: "success" | "failed" | null = null;
  let reason: string | undefined;

  if (provider === "mtn") {
    paymentId = typeof body.externalId === "string" ? body.externalId : null;
    providerRef = typeof body.referenceId === "string" ? body.referenceId : null;
    if (body.status === "SUCCESSFUL") status = "success";
    else if (body.status === "FAILED" || body.status === "REJECTED") {
      status = "failed";
      reason = typeof body.reason === "string" ? body.reason : "Declined";
    }
  } else if (provider === "airtel") {
    const tx = (body.transaction ?? {}) as Record<string, unknown>;
    paymentId = typeof tx.id === "string" ? tx.id : null;
    if (tx.status_code === "TS") status = "success";
    else if (tx.status_code === "TF") {
      status = "failed";
      reason = typeof tx.message === "string" ? tx.message : "Declined";
    }
  } else {
    paymentId = typeof body.paymentId === "string" ? body.paymentId : null;
    providerRef = typeof body.providerRef === "string" ? body.providerRef : null;
    if (body.status === "success" || body.status === "failed") status = body.status;
    reason = typeof body.reason === "string" ? body.reason : undefined;
  }

  const payment =
    paymentId && Types.ObjectId.isValid(paymentId)
      ? await PaymentModel.findById(paymentId).lean()
      : providerRef
        ? await PaymentModel.findOne({ providerRef }).lean()
        : null;
  log.paymentId = payment?._id ?? null;
  log.providerRef = payment?.providerRef ?? providerRef;
  if (payment && status) {
    await handlePaymentResult(payment._id, status === "success" ? { status } : { status, reason });
    log.processed = true;
  } else {
    log.error = payment ? "Unknown status" : "Payment not found";
  }
  await log.save();
}

// ── Refunds and cash ─────────────────────────────────────────────────────────

export async function refundPayment(payment: PaymentDoc, reason: string): Promise<void> {
  if (payment.status !== "success") return;
  let note = reason;
  if (payment.method !== "cash") {
    const provider = getProvider(payment.method as ProviderMethod);
    try {
      const result = await provider.refund({
        providerRef: payment.providerRef ?? "",
        amount: payment.amount,
        phone: payment.phone ?? "",
        paymentId: payment._id.toString(),
      });
      if (result.status !== "success") note = `${reason} (${result.reason ?? result.status})`;
    } catch (err) {
      note = `${reason} (refund pending: ${err instanceof Error ? err.message : "provider error"})`;
    }
  } else {
    note = `${reason} (refund cash at the station)`;
  }
  payment.status = "refunded";
  payment.refundedAt = new Date();
  payment.refundAmount = payment.amount;
  payment.events.push({ status: "refunded", at: new Date(), note });
  await payment.save();
}

/** Records cash collected by station staff (booking at check-in, parcel at drop-off). */
export async function recordCashPayment(input: {
  kind: "booking" | "parcel";
  target: BookingDoc | ParcelDoc;
  operatorId: Types.ObjectId;
  staffId: Types.ObjectId;
}): Promise<void> {
  const filter = input.kind === "booking" ? { bookingId: input.target._id } : { parcelId: input.target._id };
  const amount = "totalAmount" in input.target ? input.target.totalAmount : (input.target as ParcelDoc).priceRwf;
  const rate = await commissionRateFor(input.operatorId);
  const commissionAmount = commissionOf(amount, rate);
  const existing = await PaymentModel.findOne({ ...filter, method: "cash", status: "pending" });
  const fields = {
    status: "success" as const,
    paidAt: new Date(),
    commissionRate: rate,
    commissionAmount,
    operatorAmount: amount - commissionAmount,
  };
  if (existing) {
    Object.assign(existing, fields);
    existing.events.push({ status: "success", at: new Date(), note: `Cash collected by ${input.staffId.toString()}` });
    await existing.save();
  } else {
    await PaymentModel.create({
      ...filter,
      ...fields,
      kind: input.kind,
      operatorId: input.operatorId,
      userId: "userId" in input.target ? input.target.userId : (input.target as ParcelDoc).senderId,
      method: "cash",
      mode: "live",
      amount,
      events: [{ status: "success", note: "Cash collected at station" }],
    });
  }
}
