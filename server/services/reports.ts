import type { Types } from "mongoose";
import { kigaliDayRange } from "../../shared/time";
import {
  BookingModel,
  FareCapModel,
  OperatorModel,
  ParcelModel,
  PaymentModel,
  PayoutModel,
  TripModel,
} from "../models";
import { ensureLookups, loc, op } from "./lookup";

// CSV exports for admins (whole platform) and operators (their own data).

export const REPORT_TYPES = ["bookings", "payments", "parcels", "operators", "payouts", "fareCaps"] as const;
export type ReportType = (typeof REPORT_TYPES)[number];

function cell(value: unknown): string {
  if (value === null || value === undefined) return "";
  const s = value instanceof Date ? value.toISOString() : String(value);
  // Neutralise spreadsheet formula injection and quote when needed.
  const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;
  return /[",\n\r;]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function toCsv(header: string[], rows: unknown[][]): string {
  return [header.join(","), ...rows.map((r) => r.map(cell).join(","))].join("\r\n");
}

export interface ReportRange {
  from?: string;
  to?: string;
  operatorId?: Types.ObjectId | string;
}

function createdFilter(range: ReportRange, field = "createdAt"): Record<string, unknown> {
  const filter: Record<string, unknown> = {};
  const span: Record<string, Date> = {};
  if (range.from) span.$gte = kigaliDayRange(range.from).start;
  if (range.to) span.$lt = kigaliDayRange(range.to).end;
  if (Object.keys(span).length) filter[field] = span;
  if (range.operatorId) filter.operatorId = range.operatorId;
  return filter;
}

export async function buildReport(type: ReportType, range: ReportRange): Promise<string> {
  await ensureLookups();
  switch (type) {
    case "bookings": {
      const rows = await BookingModel.find(createdFilter(range)).sort({ createdAt: -1 }).limit(50_000).lean();
      const trips = await TripModel.find({ _id: { $in: rows.map((r) => r.tripId) } }, { plateNumber: 1 }).lean();
      const plates = new Map(trips.map((t) => [t._id.toString(), t.plateNumber]));
      return toCsv(
        ["reference", "created_at", "operator", "origin", "destination", "departure", "bus", "places", "unit_price", "total_rwf", "status", "payment_status", "payment_method", "traveler_name", "traveler_phone", "checked_in_at"],
        rows.map((b) => [
          b.reference,
          b.createdAt,
          op(b.operatorId).name,
          loc(b.originId).name,
          loc(b.destinationId).name,
          b.departureAt,
          plates.get(b.tripId.toString()) ?? "",
          b.places,
          b.unitPrice,
          b.totalAmount,
          b.status,
          b.paymentStatus,
          b.paymentMethod ?? "",
          b.traveler.name,
          b.traveler.phone,
          b.checkedInAt,
        ]),
      );
    }
    case "payments": {
      const rows = await PaymentModel.find(createdFilter(range)).sort({ createdAt: -1 }).limit(50_000).lean();
      return toCsv(
        ["payment_id", "created_at", "paid_at", "kind", "operator", "method", "mode", "amount_rwf", "commission_rwf", "operator_amount_rwf", "status", "provider_ref", "payout_id", "refunded_at"],
        rows.map((p) => [
          p._id.toString(),
          p.createdAt,
          p.paidAt,
          p.kind,
          op(p.operatorId).name,
          p.method,
          p.mode,
          p.amount,
          p.commissionAmount,
          p.operatorAmount,
          p.status,
          p.providerRef ?? "",
          p.payoutId?.toString() ?? "",
          p.refundedAt,
        ]),
      );
    }
    case "parcels": {
      const rows = await ParcelModel.find(createdFilter(range)).sort({ createdAt: -1 }).limit(50_000).lean();
      return toCsv(
        ["code", "created_at", "operator", "origin", "destination", "description", "weight_kg", "size", "price_rwf", "status", "payment_status", "receiver_name", "receiver_phone"],
        rows.map((p) => [
          p.code,
          p.createdAt,
          op(p.operatorId).name,
          loc(p.originId).name,
          loc(p.destinationId).name,
          p.description,
          p.weightKg,
          p.size,
          p.priceRwf,
          p.status,
          p.paymentStatus,
          p.receiver.name,
          p.receiver.phone,
        ]),
      );
    }
    case "operators": {
      const rows = await OperatorModel.find(range.operatorId ? { _id: range.operatorId } : {}).sort({ createdAt: -1 }).lean();
      return toCsv(
        ["name", "rura_licence", "status", "contact_phone", "contact_email", "headquarters", "commission_rate", "created_at", "approved_at"],
        rows.map((o) => [
          o.name,
          o.registrationNumber,
          o.status,
          o.contactPhone,
          o.contactEmail ?? "",
          loc(o.headquartersId).name,
          o.commissionRate ?? "",
          o.createdAt,
          o.approvedAt,
        ]),
      );
    }
    case "payouts": {
      const rows = await PayoutModel.find(createdFilter(range)).sort({ createdAt: -1 }).lean();
      return toCsv(
        ["operator", "period_start", "period_end", "payments", "gross_rwf", "mobile_money_rwf", "cash_rwf", "commission_rwf", "net_rwf", "status", "due_date", "processed_at", "reference", "account", "failure_reason"],
        rows.map((p) => [
          op(p.operatorId).name,
          p.periodStart,
          p.periodEnd,
          p.paymentsCount,
          p.gross,
          p.onlineGross,
          p.cashGross,
          p.commission,
          p.net,
          p.status,
          p.dueDate,
          p.processedAt,
          p.reference ?? "",
          p.bankAccountMasked ?? "",
          p.failureReason ?? "",
        ]),
      );
    }
    case "fareCaps": {
      const rows = await FareCapModel.find({}).lean();
      return toCsv(
        ["origin", "destination", "via", "cap_rwf", "distance_km", "effective_from", "source", "corridor"],
        rows.map((c) => [
          loc(c.originId).name,
          loc(c.destinationId).name,
          c.viaId ? loc(c.viaId).name : "",
          c.capRwf,
          c.distanceKm ?? "",
          c.effectiveFrom,
          c.source,
          c.corridor ?? "",
        ]),
      );
    }
  }
}
