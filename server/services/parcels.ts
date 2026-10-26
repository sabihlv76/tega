import { Types } from "mongoose";
import { type Locale, PARCEL_SIZE_MAX_KG, type ParcelSize, type ParcelStatus } from "../../shared/constants";
import { formatRwf, normalizeRwPhone, parcelPrice } from "../../shared/money";
import { getTranslator } from "../../shared/i18n/catalog";
import { formatClock } from "../../shared/time";
import type { ParcelDTO, ParcelQuoteDTO, StationParcelDTO } from "../../shared/types";
import { config } from "../config";
import { encrypt, hashSecret, parcelCode, randomDigits, safeEqual } from "../lib/crypto";
import { ApiError, badRequest, conflict, notFound } from "../lib/errors";
import {
  OperatorModel,
  type ParcelDoc,
  ParcelModel,
  PaymentModel,
  RouteModel,
  type TripDoc,
  TripModel,
  type UserDoc,
} from "../models";
import { emit, rooms } from "../realtime";
import { audit } from "./audit";
import { ensureLookups, findLocation, loc, op } from "./lookup";
import { notify } from "./notify";
import { recordCashPayment } from "./payments/service";
import { parcelDTO, stationParcelDTO } from "./serializers";
import { getSettings } from "./settings";

type Oid = Types.ObjectId | string;

export async function toParcelDTO(parcel: ParcelDoc | Parameters<typeof parcelDTO>[0], forSender: boolean): Promise<ParcelDTO> {
  await ensureLookups();
  const plain = "toObject" in parcel ? (parcel as ParcelDoc).toObject() : parcel;
  const trip = plain.tripId ? await TripModel.findById(plain.tripId).lean() : null;
  return parcelDTO(plain, trip, forSender);
}

async function emitParcel(parcel: ParcelDoc): Promise<void> {
  const dto = await toParcelDTO(parcel, false);
  emit(
    [
      rooms.parcel(parcel.code),
      rooms.operator(parcel.operatorId.toString()),
      rooms.station(parcel.originId.toString()),
      rooms.station(parcel.destinationId.toString()),
    ],
    "parcel.updated",
    dto,
  );
  emit(rooms.user(parcel.senderId.toString()), "parcel.updated", await toParcelDTO(parcel, true));
}

function pushEvent(parcel: ParcelDoc, status: ParcelStatus, extra: { stationId?: Oid | null; byUserId?: Oid | null; note?: string | null } = {}) {
  parcel.status = status;
  parcel.events.push({
    status,
    at: new Date(),
    stationId: extra.stationId ? new Types.ObjectId(extra.stationId.toString()) : null,
    byUserId: extra.byUserId ? new Types.ObjectId(extra.byUserId.toString()) : null,
    note: extra.note ?? null,
  });
}

async function notifySenderStatus(parcel: ParcelDoc): Promise<void> {
  const t = getTranslator(parcel.locale as Locale);
  await notify({
    userId: parcel.senderId,
    locale: parcel.locale as Locale,
    type: "parcel.status",
    inApp: { title: "notifications.parcelStatusTitle", body: "notifications.parcelStatusBody" },
    vars: { code: parcel.code, status: t(`parcels.status.${parcel.status}`) },
    data: { code: parcel.code },
  });
}

// ── Quotes & creation ────────────────────────────────────────────────────────

export async function quoteParcel(from: string, to: string, weightKg: number): Promise<ParcelQuoteDTO[]> {
  await ensureLookups();
  const [origin, destination] = await Promise.all([findLocation(from), findLocation(to)]);
  if (!origin || !destination || origin.id === destination.id) return [];
  const routes = await RouteModel.find({ originId: origin.id, destinationId: destination.id, status: "active" }).lean();
  const operatorIds = [...new Set(routes.map((r) => r.operatorId.toString()))];
  const operators = await OperatorModel.find({ _id: { $in: operatorIds }, status: "approved", "parcelPricing.enabled": true }).lean();
  const quotes: ParcelQuoteDTO[] = [];
  for (const operator of operators) {
    const next = await TripModel.findOne({
      operatorId: operator._id,
      originId: origin.id,
      destinationId: destination.id,
      status: { $in: ["scheduled", "boarding"] },
      departureAt: { $gt: new Date() },
    })
      .sort({ departureAt: 1 })
      .lean();
    const perKg = operator.parcelPricing?.perKg ?? 1000;
    const minimum = operator.parcelPricing?.minimum ?? 1000;
    quotes.push({
      operator: op(operator._id),
      perKg,
      minimum,
      priceRwf: parcelPrice(Math.max(weightKg, 0.1), perKg, minimum),
      nextDeparture: next ? next.departureAt.toISOString() : null,
    });
  }
  return quotes.sort((a, b) => a.priceRwf - b.priceRwf);
}

export async function createParcel(
  user: UserDoc,
  input: {
    from: string;
    to: string;
    operatorId: string;
    description: string;
    weightKg: number;
    size: ParcelSize;
    receiver: { name: string; phone: string };
    sender?: { name?: string | null; phone?: string | null };
  },
  locale: Locale,
): Promise<ParcelDTO> {
  await ensureLookups();
  const [origin, destination] = await Promise.all([findLocation(input.from), findLocation(input.to)]);
  if (!origin || !destination || origin.id === destination.id) throw badRequest("VALIDATION_ERROR", { field: "to" });
  if (input.weightKg > PARCEL_SIZE_MAX_KG[input.size]) throw badRequest("PARCEL_TOO_HEAVY", { field: "weightKg" });
  const receiverPhone = normalizeRwPhone(input.receiver.phone);
  if (!receiverPhone) throw badRequest("PHONE_INVALID", { field: "receiver.phone" });
  const senderPhone = normalizeRwPhone(input.sender?.phone ?? user.phone ?? "");
  if (!senderPhone) throw badRequest("PHONE_INVALID", { field: "sender.phone" });

  if (!Types.ObjectId.isValid(input.operatorId)) throw notFound();
  const operator = await OperatorModel.findOne({ _id: input.operatorId, status: "approved" }).lean();
  if (!operator) throw notFound();
  if (!operator.parcelPricing?.enabled) throw conflict("PARCELS_DISABLED");
  const servesRoute = await RouteModel.exists({ operatorId: operator._id, originId: origin.id, destinationId: destination.id, status: "active" });
  if (!servesRoute) throw conflict("PARCELS_DISABLED");

  const settings = await getSettings();
  const price = parcelPrice(input.weightKg, operator.parcelPricing.perKg ?? 1000, operator.parcelPricing.minimum ?? 1000);
  let parcel: ParcelDoc | null = null;
  for (let attempt = 0; attempt < 5 && !parcel; attempt++) {
    try {
      parcel = await ParcelModel.create({
        code: parcelCode(),
        senderId: user._id,
        sender: { name: (input.sender?.name || user.name || "FIKA customer").trim(), phone: senderPhone },
        receiver: { name: input.receiver.name.trim(), phone: receiverPhone },
        originId: origin.id,
        destinationId: destination.id,
        operatorId: operator._id,
        description: input.description.trim(),
        weightKg: input.weightKg,
        size: input.size,
        priceRwf: price,
        holdExpiresAt: new Date(Date.now() + settings.parcelHoldMinutes * 60_000),
        locale,
        events: [{ status: "pending_payment", at: new Date() }],
      });
    } catch (err) {
      if ((err as { code?: number }).code !== 11000) throw err;
    }
  }
  if (!parcel) throw new Error("Could not allocate a parcel code");
  return toParcelDTO(parcel, true);
}

export async function findParcelByCode(code: string): Promise<ParcelDoc> {
  const parcel = await ParcelModel.findOne({ code: code.trim().toUpperCase() });
  if (!parcel) throw notFound();
  return parcel;
}

export async function listUserParcels(userId: Oid): Promise<ParcelDTO[]> {
  await ensureLookups();
  const parcels = await ParcelModel.find({ senderId: userId }).sort({ createdAt: -1 }).limit(100).lean();
  const trips = await TripModel.find({ _id: { $in: parcels.map((p) => p.tripId).filter(Boolean) } }).lean();
  const tripMap = new Map(trips.map((t) => [t._id.toString(), t]));
  return parcels.map((p) => parcelDTO(p, p.tripId ? (tripMap.get(p.tripId.toString()) ?? null) : null, true));
}

// ── Payment outcomes ─────────────────────────────────────────────────────────

async function confirmParcel(parcel: ParcelDoc, paymentState: "paid" | "cash_due"): Promise<void> {
  const pickupCode = randomDigits(6);
  parcel.pickupCodeHash = hashSecret(pickupCode, parcel.code);
  parcel.pickupCodeEnc = encrypt(pickupCode);
  parcel.paymentStatus = paymentState;
  parcel.holdExpiresAt = null;
  pushEvent(parcel, "awaiting_dropoff", { stationId: parcel.originId });
  await parcel.save();
  await ensureLookups();
  const vars = {
    code: parcel.code,
    sender: parcel.sender.name,
    to: loc(parcel.destinationId).name,
    station: loc(parcel.originId).name,
    pickupCode,
    link: `${config.webUrl}/parcels/track?code=${parcel.code}`,
  };
  await notify({
    phone: parcel.receiver.phone,
    locale: parcel.locale as Locale,
    type: "parcel.receiver",
    sms: "notifications.parcelReceiverSms",
    vars,
    transactional: true,
  });
  await notify({
    userId: parcel.senderId,
    phone: parcel.sender.phone,
    locale: parcel.locale as Locale,
    type: "parcel.created",
    sms: "notifications.parcelSenderSms",
    inApp: { title: "notifications.parcelStatusTitle", body: "notifications.parcelSenderSms" },
    vars,
    data: { code: parcel.code },
    transactional: true,
  });
  await emitParcel(parcel);
}

export async function onParcelPaid(payment: { _id: Types.ObjectId; parcelId?: Types.ObjectId | null; method: string }): Promise<void> {
  const parcel = await ParcelModel.findById(payment.parcelId);
  if (!parcel) return;
  if (parcel.status !== "pending_payment" && parcel.status !== "expired") return;
  parcel.paymentMethod = payment.method as never;
  await confirmParcel(parcel, "paid");
}

export async function onParcelPaymentFailed(payment: { parcelId?: Types.ObjectId | null }): Promise<void> {
  const parcel = await ParcelModel.findById(payment.parcelId);
  if (!parcel || parcel.status !== "pending_payment") return;
  parcel.paymentStatus = "failed";
  await parcel.save();
  await emitParcel(parcel);
}

export async function reserveParcelForCash(parcel: ParcelDoc): Promise<void> {
  parcel.paymentMethod = "cash";
  await confirmParcel(parcel, "cash_due");
}

export async function expireParcelHolds(): Promise<number> {
  const now = new Date();
  const stale = await ParcelModel.find({ status: "pending_payment", holdExpiresAt: { $lt: now } }).limit(500);
  let count = 0;
  for (const parcel of stale) {
    const inFlight = await PaymentModel.exists({
      parcelId: parcel._id,
      status: { $in: ["initiated", "pending"] },
      createdAt: { $gt: new Date(now.getTime() - 3 * 60_000) },
    });
    if (inFlight) continue;
    pushEvent(parcel, "expired");
    parcel.holdExpiresAt = null;
    await parcel.save();
    count++;
  }
  return count;
}

// ── Station operations ───────────────────────────────────────────────────────

function requireStation(staff: UserDoc): Types.ObjectId {
  if (!staff.stationId) throw new ApiError(403, "FORBIDDEN");
  return staff.stationId;
}

export async function stationParcels(staff: UserDoc): Promise<{
  toReceive: StationParcelDTO[];
  toLoad: StationParcelDTO[];
  toRelease: StationParcelDTO[];
}> {
  const stationId = requireStation(staff);
  await ensureLookups();
  const [toReceive, toLoad, toRelease] = await Promise.all([
    ParcelModel.find({ originId: stationId, status: "awaiting_dropoff" }).sort({ createdAt: 1 }).lean(),
    ParcelModel.find({ originId: stationId, status: { $in: ["received", "loaded"] } }).sort({ createdAt: 1 }).lean(),
    ParcelModel.find({ destinationId: stationId, status: "arrived" }).sort({ updatedAt: 1 }).lean(),
  ]);
  return {
    toReceive: toReceive.map(stationParcelDTO),
    toLoad: toLoad.map(stationParcelDTO),
    toRelease: toRelease.map(stationParcelDTO),
  };
}

export async function receiveParcel(staff: UserDoc, code: string, collectCash: boolean): Promise<ParcelDTO> {
  const stationId = requireStation(staff);
  const parcel = await findParcelByCode(code);
  if (parcel.originId.toString() !== stationId.toString()) throw new ApiError(409, "INVALID_STATE", { reason: "wrong_station" });
  if (parcel.status !== "awaiting_dropoff") throw conflict("INVALID_STATE", { status: parcel.status });
  if (parcel.paymentStatus === "cash_due") {
    if (!collectCash) throw conflict("INVALID_STATE", { reason: "cash_due", amount: parcel.priceRwf });
    await recordCashPayment({ kind: "parcel", target: parcel, operatorId: parcel.operatorId, staffId: staff._id });
    parcel.paymentStatus = "paid";
  }
  pushEvent(parcel, "received", { stationId, byUserId: staff._id });
  await parcel.save();
  await audit({ id: staff._id, role: staff.role }, "parcel.receive", "parcel", parcel._id, parcel.code, { operatorId: parcel.operatorId });
  await notifySenderStatus(parcel);
  await emitParcel(parcel);
  return toParcelDTO(parcel, false);
}

export async function loadParcel(staff: UserDoc, code: string, tripId: string): Promise<ParcelDTO> {
  const stationId = requireStation(staff);
  const parcel = await findParcelByCode(code);
  if (parcel.originId.toString() !== stationId.toString()) throw new ApiError(409, "INVALID_STATE", { reason: "wrong_station" });
  if (parcel.status !== "received" && parcel.status !== "loaded") throw conflict("INVALID_STATE", { status: parcel.status });
  if (!Types.ObjectId.isValid(tripId)) throw notFound();
  const trip = await TripModel.findById(tripId).lean();
  if (
    !trip ||
    trip.originId.toString() !== parcel.originId.toString() ||
    trip.destinationId.toString() !== parcel.destinationId.toString() ||
    trip.operatorId.toString() !== parcel.operatorId.toString() ||
    (trip.status !== "scheduled" && trip.status !== "boarding")
  ) {
    throw conflict("INVALID_STATE", { reason: "trip_mismatch" });
  }
  parcel.tripId = trip._id;
  pushEvent(parcel, "loaded", { stationId, byUserId: staff._id, note: trip.plateNumber });
  await parcel.save();
  await notifySenderStatus(parcel);
  await emitParcel(parcel);
  return toParcelDTO(parcel, false);
}

export async function releaseParcel(staff: UserDoc, code: string, pickupCode: string): Promise<ParcelDTO> {
  const stationId = requireStation(staff);
  const parcel = await findParcelByCode(code);
  if (parcel.destinationId.toString() !== stationId.toString()) throw new ApiError(409, "INVALID_STATE", { reason: "wrong_station" });
  if (parcel.status !== "arrived") throw conflict("INVALID_STATE", { status: parcel.status });
  const ok = parcel.pickupCodeHash && /^\d{6}$/.test(pickupCode) && safeEqual(hashSecret(pickupCode, parcel.code), parcel.pickupCodeHash);
  if (!ok) throw badRequest("PICKUP_CODE_INVALID");
  pushEvent(parcel, "collected", { stationId, byUserId: staff._id });
  await parcel.save();
  await audit({ id: staff._id, role: staff.role }, "parcel.release", "parcel", parcel._id, parcel.code, { operatorId: parcel.operatorId });
  await notifySenderStatus(parcel);
  await emitParcel(parcel);
  return toParcelDTO(parcel, false);
}

// ── Trip lifecycle hooks ─────────────────────────────────────────────────────

export async function onTripDeparted(trip: TripDoc): Promise<void> {
  const parcels = await ParcelModel.find({ tripId: trip._id, status: "loaded" });
  const now = new Date();
  for (const parcel of parcels) {
    pushEvent(parcel, "in_transit", { note: trip.plateNumber });
    await parcel.save();
    await PaymentModel.updateMany(
      { parcelId: parcel._id, status: "success", eligibleForPayoutAt: null },
      { $set: { eligibleForPayoutAt: now } },
    );
    await notifySenderStatus(parcel);
    await emitParcel(parcel);
  }
}

export async function onTripArrived(trip: TripDoc): Promise<void> {
  const parcels = await ParcelModel.find({ tripId: trip._id, status: "in_transit" });
  await ensureLookups();
  for (const parcel of parcels) {
    pushEvent(parcel, "arrived", { stationId: parcel.destinationId });
    await parcel.save();
    await notify({
      phone: parcel.receiver.phone,
      locale: parcel.locale as Locale,
      type: "parcel.arrived",
      sms: "notifications.parcelArrivedSms",
      vars: { code: parcel.code, station: loc(parcel.destinationId).name },
      transactional: true,
    });
    await notifySenderStatus(parcel);
    await emitParcel(parcel);
  }
}

export async function onTripCancelled(trip: TripDoc): Promise<void> {
  const parcels = await ParcelModel.find({ tripId: trip._id, status: "loaded" });
  for (const parcel of parcels) {
    parcel.tripId = null;
    pushEvent(parcel, "received", { stationId: parcel.originId, note: "Bus cancelled, waiting for the next departure" });
    await parcel.save();
    await emitParcel(parcel);
  }
}

export function parcelSummary(parcel: { code: string; priceRwf: number; departureAt?: Date | null }): string {
  return `${parcel.code} · ${formatRwf(parcel.priceRwf)}${parcel.departureAt ? ` · ${formatClock(parcel.departureAt)}` : ""}`;
}
