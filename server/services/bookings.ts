import { Types } from "mongoose";
import { type Locale, MAX_PLACES_PER_BOOKING } from "../../shared/constants";
import { bookingTotal, formatRwf, formatPhone, normalizeRwPhone } from "../../shared/money";
import { formatClock, kigaliDate } from "../../shared/time";
import type { BookingDTO, CheckInResultDTO } from "../../shared/types";
import { config } from "../config";
import { bookingReference, verifyTicket } from "../lib/crypto";
import { ApiError, badRequest, conflict, notFound } from "../lib/errors";
import { qf } from "../lib/mongo";
import {
  type BookingDoc,
  BookingModel,
  OperatorModel,
  PaymentModel,
  TicketScanModel,
  type TripDoc,
  TripModel,
  type UserDoc,
} from "../models";
import { emit, rooms } from "../realtime";
import type { Actor } from "./audit";
import { audit } from "./audit";
import { ensureLookups, loc, op } from "./lookup";
import { notify } from "./notify";
import { recordCashPayment, refundPayment } from "./payments/service";
import { bookingDTO, canCancelBooking, effectiveDeparture, manifestBookingDTO } from "./serializers";
import { getSettings } from "./settings";
import { emitTripUpdate, holdPlaces, releasePlaces } from "./trips";

type Oid = Types.ObjectId | string;

async function cancellationHoursFor(operatorId: Oid): Promise<number> {
  const operator = await OperatorModel.findById(operatorId, { cancellationHours: 1 }).lean();
  const settings = await getSettings();
  return operator?.cancellationHours ?? settings.defaultCancellationHours;
}

export async function toBookingDTO(booking: BookingDoc | Parameters<typeof bookingDTO>[0]): Promise<BookingDTO> {
  await ensureLookups();
  const plain = "toObject" in booking ? (booking as BookingDoc).toObject() : booking;
  const trip = await TripModel.findById(plain.tripId).lean();
  if (!trip) throw notFound();
  return bookingDTO(plain, trip, await cancellationHoursFor(plain.operatorId));
}

export async function createBooking(
  user: UserDoc,
  input: { tripId: string; places: number; traveler: { name: string; phone: string; email?: string | null } },
  locale: Locale,
): Promise<BookingDTO> {
  if (!Types.ObjectId.isValid(input.tripId)) throw notFound();
  if (!Number.isInteger(input.places) || input.places < 1 || input.places > MAX_PLACES_PER_BOOKING) {
    throw badRequest("VALIDATION_ERROR", { field: "places" });
  }
  const phone = normalizeRwPhone(input.traveler.phone);
  if (!phone) throw badRequest("PHONE_INVALID", { field: "traveler.phone" });

  const existing = await TripModel.findById(input.tripId).lean();
  if (!existing) throw notFound();
  const operator = await OperatorModel.findById(existing.operatorId, { status: 1 }).lean();
  if (operator?.status !== "approved") throw conflict("TRIP_NOT_BOOKABLE");
  if (existing.status !== "scheduled" && existing.status !== "boarding") throw conflict("TRIP_NOT_BOOKABLE");
  if (effectiveDeparture(existing).getTime() <= Date.now()) throw conflict("TRIP_DEPARTED");

  const trip = await holdPlaces(existing._id, input.places);
  if (!trip) throw conflict("TRIP_FULL", { placesLeft: Math.max(0, existing.seatsTotal - existing.seatsBooked) });

  const settings = await getSettings();
  try {
    let booking: BookingDoc | null = null;
    for (let attempt = 0; attempt < 5 && !booking; attempt++) {
      try {
        booking = await BookingModel.create({
          reference: bookingReference(),
          userId: user._id,
          tripId: trip._id,
          operatorId: trip.operatorId,
          originId: trip.originId,
          destinationId: trip.destinationId,
          departureAt: trip.departureAt,
          places: input.places,
          unitPrice: trip.priceRwf,
          totalAmount: bookingTotal(trip.priceRwf, input.places),
          traveler: { name: input.traveler.name.trim(), phone, email: input.traveler.email?.trim().toLowerCase() || null },
          holdExpiresAt: new Date(Date.now() + settings.holdMinutes * 60_000),
          locale,
        });
      } catch (err) {
        if ((err as { code?: number }).code !== 11000) throw err; // retry only on reference collisions
      }
    }
    if (!booking) throw new Error("Could not allocate a booking reference");
    await emitTripUpdate(trip);
    return toBookingDTO(booking);
  } catch (err) {
    await releasePlaces(trip._id, input.places);
    throw err;
  }
}

export async function findUserBooking(userId: Oid, idOrReference: string): Promise<BookingDoc> {
  const query = Types.ObjectId.isValid(idOrReference)
    ? { _id: idOrReference, userId }
    : { reference: idOrReference.toUpperCase(), userId };
  const booking = await BookingModel.findOne(query);
  if (!booking) throw notFound();
  return booking;
}

export async function listUserBookings(userId: Oid, scope: "upcoming" | "past" | "cancelled"): Promise<BookingDTO[]> {
  await ensureLookups();
  const now = new Date();
  const filter =
    scope === "cancelled"
      ? { userId, status: { $in: ["cancelled", "expired"] } }
      : scope === "upcoming"
        ? { userId, status: { $in: ["pending_payment", "confirmed"] }, departureAt: { $gte: new Date(now.getTime() - 6 * 3600_000) } }
        : {
            userId,
            $or: [{ status: "completed" }, { status: "confirmed", departureAt: { $lt: new Date(now.getTime() - 6 * 3600_000) } }],
          };
  const bookings = await BookingModel.find(qf(filter))
    .sort({ departureAt: scope === "upcoming" ? 1 : -1 })
    .limit(100)
    .lean();
  const trips = await TripModel.find({ _id: { $in: bookings.map((b) => b.tripId) } }).lean();
  const tripMap = new Map(trips.map((t) => [t._id.toString(), t]));
  const out: BookingDTO[] = [];
  for (const b of bookings) {
    const trip = tripMap.get(b.tripId.toString());
    if (trip) out.push(bookingDTO(b, trip, await cancellationHoursFor(b.operatorId)));
  }
  return out;
}

// ── Payment outcomes ─────────────────────────────────────────────────────────

function ticketLink(reference: string): string {
  return `${config.webUrl}/tickets/${reference}`;
}

async function bookingVars(booking: {
  reference: string;
  tripId: Types.ObjectId;
  originId: Oid;
  destinationId: Oid;
  departureAt: Date;
  places: number;
  operatorId: Oid;
  totalAmount: number;
}) {
  await ensureLookups();
  const trip = await TripModel.findById(booking.tripId, { plateNumber: 1 }).lean();
  return {
    reference: booking.reference,
    from: loc(booking.originId).name,
    to: loc(booking.destinationId).name,
    date: kigaliDate(booking.departureAt),
    time: formatClock(booking.departureAt),
    places: booking.places,
    operator: op(booking.operatorId).name,
    amount: formatRwf(booking.totalAmount),
    link: ticketLink(booking.reference),
    plate: trip?.plateNumber ?? "",
  };
}

async function announceConfirmed(booking: BookingDoc, cash: boolean): Promise<void> {
  const vars = await bookingVars(booking);
  await notify({
    userId: booking.userId,
    phone: booking.traveler.phone,
    email: booking.traveler.email,
    locale: booking.locale as Locale,
    type: cash ? "booking.reserved" : "booking.confirmed",
    inApp: {
      title: cash ? "notifications.bookingReservedTitle" : "notifications.bookingConfirmedTitle",
      body: "notifications.bookingConfirmedBody",
    },
    sms: cash ? "notifications.bookingReservedSms" : "notifications.bookingConfirmedSms",
    emailMsg: { subject: "notifications.receiptSubject", body: "notifications.receiptBody" },
    vars,
    data: { bookingId: booking._id.toString(), reference: booking.reference },
    transactional: true,
  });
  const dto = await toBookingDTO(booking);
  emit(rooms.user(booking.userId.toString()), "booking.updated", dto);
  emit(rooms.operator(booking.operatorId.toString()), "booking.created", dto);
}

/** Called by the payment service when a mobile money payment for a booking succeeds. */
export async function onBookingPaid(payment: { _id: Types.ObjectId; bookingId?: Types.ObjectId | null; method: string; amount: number }): Promise<void> {
  const booking = await BookingModel.findById(payment.bookingId);
  if (!booking) return;
  if (booking.paymentStatus === "paid") {
    // Second successful payment for the same booking (e.g. retried on two phones): give it back.
    const duplicate = await PaymentModel.findById(payment._id);
    if (duplicate) await refundPayment(duplicate, "Duplicate payment");
    return;
  }
  if (booking.status === "cancelled") {
    const p = await PaymentModel.findById(payment._id);
    if (p) await refundPayment(p, "Booking was cancelled before payment completed");
    return;
  }
  if (booking.status === "expired") {
    // The hold lapsed while the customer approved the payment: try to take the places again.
    const trip = await holdPlaces(booking.tripId, booking.places);
    if (!trip) {
      const p = await PaymentModel.findById(payment._id);
      if (p) await refundPayment(p, "Trip filled up before payment completed");
      booking.status = "cancelled";
      booking.cancelReason = "Places no longer available";
      booking.cancelledBy = "system";
      booking.cancelledAt = new Date();
      await booking.save();
      return;
    }
  }
  booking.status = "confirmed";
  booking.paymentStatus = "paid";
  booking.paymentMethod = payment.method as never;
  booking.holdExpiresAt = null;
  await booking.save();
  await announceConfirmed(booking, false);
}

export async function onBookingPaymentFailed(payment: { bookingId?: Types.ObjectId | null; failureReason?: string | null }): Promise<void> {
  const booking = await BookingModel.findById(payment.bookingId);
  if (!booking || booking.status !== "pending_payment") return;
  booking.paymentStatus = "failed";
  await booking.save();
  await notify({
    userId: booking.userId,
    locale: booking.locale as Locale,
    type: "payment.failed",
    inApp: { title: "notifications.paymentFailedTitle", body: "notifications.paymentFailedBody" },
    vars: { reference: booking.reference, time: booking.holdExpiresAt ? formatClock(booking.holdExpiresAt) : "" },
    data: { bookingId: booking._id.toString() },
  });
  emit(rooms.user(booking.userId.toString()), "booking.updated", await toBookingDTO(booking));
}

/** "Cash at station": the places are reserved and the fare is collected at check-in. */
export async function reserveForCash(booking: BookingDoc): Promise<void> {
  booking.status = "confirmed";
  booking.paymentStatus = "cash_due";
  booking.paymentMethod = "cash";
  booking.holdExpiresAt = null;
  await booking.save();
  await announceConfirmed(booking, true);
}

// ── Cancellation ─────────────────────────────────────────────────────────────

export async function cancelBooking(
  booking: BookingDoc,
  opts: { by: "passenger" | "operator" | "admin" | "system"; reason: string; actor?: Actor | null; tripCancelled?: boolean },
): Promise<BookingDoc> {
  if (booking.status !== "pending_payment" && booking.status !== "confirmed") throw conflict("INVALID_STATE");
  const trip = await TripModel.findById(booking.tripId);
  if (opts.by === "passenger") {
    const hours = await cancellationHoursFor(booking.operatorId);
    if (!canCancelBooking(booking, trip, hours)) throw conflict("CANCELLATION_WINDOW_CLOSED", { hours });
  }
  const wasPaid = booking.paymentStatus === "paid";
  booking.status = "cancelled";
  booking.cancelledAt = new Date();
  booking.cancelledBy = opts.by;
  booking.cancelReason = opts.reason;
  booking.holdExpiresAt = null;

  let refunded = 0;
  if (wasPaid) {
    const payment = await PaymentModel.findOne({ bookingId: booking._id, status: "success" });
    if (payment) {
      await refundPayment(payment, opts.reason);
      refunded = payment.amount;
    }
    booking.paymentStatus = "refunded";
    booking.refundAmount = refunded;
  } else if (booking.paymentStatus === "pending") {
    await PaymentModel.updateMany(
      { bookingId: booking._id, status: { $in: ["initiated", "pending"] } },
      { $set: { status: "cancelled" }, $push: { events: { status: "cancelled", at: new Date(), note: opts.reason } } },
    );
  }
  await booking.save();
  if (trip && !opts.tripCancelled && trip.status !== "departed" && trip.status !== "arrived") {
    await releasePlaces(trip._id, booking.places);
    await emitTripUpdate((await TripModel.findById(trip._id)) ?? trip);
  }

  const vars = { ...(await bookingVars(booking)), phone: formatPhone(booking.traveler.phone), amount: formatRwf(refunded) };
  if (opts.tripCancelled) {
    await notify({
      userId: booking.userId,
      phone: booking.traveler.phone,
      locale: booking.locale as Locale,
      type: "trip.cancelled",
      inApp: { title: "notifications.tripCancelledTitle", body: "notifications.bookingCancelledBody" },
      sms: "notifications.tripCancelledSms",
      vars,
      data: { bookingId: booking._id.toString() },
      transactional: true,
    });
  } else {
    await notify({
      userId: booking.userId,
      locale: booking.locale as Locale,
      type: "booking.cancelled",
      inApp: { title: "notifications.bookingCancelledTitle", body: refunded > 0 ? "notifications.refundBody" : "notifications.bookingCancelledBody" },
      vars,
      data: { bookingId: booking._id.toString() },
    });
  }
  if (opts.actor && opts.by !== "passenger") {
    await audit(opts.actor, "booking.cancel", "booking", booking._id, `${booking.reference}: ${opts.reason}`, {
      operatorId: booking.operatorId,
    });
  }
  emit(rooms.user(booking.userId.toString()), "booking.updated", await toBookingDTO(booking));
  return booking;
}

/** Releases places held by unpaid bookings once the payment window has passed. */
export async function expireBookingHolds(): Promise<number> {
  const now = new Date();
  const stale = await BookingModel.find({ status: "pending_payment", holdExpiresAt: { $lt: now } }).limit(500);
  let expired = 0;
  for (const booking of stale) {
    const pending = await PaymentModel.findOne({
      bookingId: booking._id,
      status: { $in: ["initiated", "pending"] },
      createdAt: { $gt: new Date(now.getTime() - 3 * 60_000) },
    }).lean();
    if (pending) continue; // the customer is approving right now; give the provider a moment
    const res = await BookingModel.updateOne(
      { _id: booking._id, status: "pending_payment" },
      { $set: { status: "expired", holdExpiresAt: null } },
    );
    if (res.modifiedCount === 1) {
      await releasePlaces(booking.tripId, booking.places);
      const trip = await TripModel.findById(booking.tripId);
      if (trip) await emitTripUpdate(trip);
      expired++;
    }
  }
  return expired;
}

// ── Station check-in ─────────────────────────────────────────────────────────

export async function checkInTicket(
  staff: UserDoc,
  input: { code: string; collectCash?: boolean },
): Promise<CheckInResultDTO> {
  await ensureLookups();
  if (!staff.stationId) throw new ApiError(403, "FORBIDDEN");
  const raw = input.code.trim();
  const method = raw.startsWith("FKT1.") ? "qr" : "manual";
  let booking: BookingDoc | null = null;
  if (method === "qr") {
    const bookingId = verifyTicket(raw);
    if (bookingId) booking = await BookingModel.findById(bookingId);
  } else {
    booking = await BookingModel.findOne({ reference: raw.toUpperCase().replace(/\s+/g, "") });
  }

  const record = async (result: CheckInResultDTO["result"], b: BookingDoc | null, trip: TripDoc | null) => {
    await TicketScanModel.create({
      bookingId: b?._id ?? null,
      input: method === "manual" ? raw.slice(0, 40) : "qr",
      stationId: staff.stationId,
      scannedBy: staff._id,
      method,
      result,
    });
    const amountDue = b && (b.paymentStatus === "cash_due" || b.status === "pending_payment") ? b.totalAmount : 0;
    return { result, booking: b ? manifestBookingDTO(b.toObject(), trip?.toObject() ?? null) : null, amountDue };
  };

  if (!booking) return record("invalid", null, null);
  const trip = await TripModel.findById(booking.tripId);
  if (!trip) return record("invalid", booking, null);
  if (booking.status === "cancelled" || booking.status === "expired") return record("cancelled", booking, trip);
  if (trip.originId.toString() !== staff.stationId.toString()) return record("wrong_station", booking, trip);
  if (kigaliDate(trip.departureAt) !== kigaliDate()) return record("wrong_day", booking, trip);
  if (booking.checkedInAt) return record("already_used", booking, trip);

  const owesCash = booking.paymentStatus === "cash_due" || booking.status === "pending_payment";
  if (owesCash) {
    if (!input.collectCash) return record("unpaid", booking, trip);
    await recordCashPayment({ kind: "booking", target: booking, operatorId: booking.operatorId, staffId: staff._id });
    booking.status = "confirmed";
    booking.paymentStatus = "paid";
    booking.paymentMethod = "cash";
    booking.holdExpiresAt = null;
  }
  booking.checkedInAt = new Date();
  booking.checkedInBy = staff._id;
  await booking.save();
  const updatedTrip = await TripModel.findByIdAndUpdate(trip._id, { $inc: { checkedInCount: booking.places } }, { returnDocument: "after" });
  const result = await record("valid", booking, updatedTrip ?? trip);
  emit([rooms.station(staff.stationId.toString()), rooms.operator(booking.operatorId.toString())], "checkin.created", result.booking);
  emit(rooms.user(booking.userId.toString()), "booking.updated", await toBookingDTO(booking));
  if (updatedTrip) await emitTripUpdate(updatedTrip);
  return result;
}

// ── Reminders ────────────────────────────────────────────────────────────────

export async function sendDepartureReminders(): Promise<number> {
  const settings = await getSettings();
  const now = Date.now();
  const windowEnd = new Date(now + (settings.reminderMinutesBeforeDeparture + 5) * 60_000);
  const bookings = await BookingModel.find({
    status: "confirmed",
    reminderSentAt: null,
    departureAt: { $gt: new Date(now + 10 * 60_000), $lt: windowEnd },
  }).limit(500);
  for (const booking of bookings) {
    booking.reminderSentAt = new Date();
    await booking.save();
    await notify({
      userId: booking.userId,
      phone: booking.traveler.phone,
      locale: booking.locale as Locale,
      type: "trip.reminder",
      sms: "notifications.reminderSms",
      vars: await bookingVars(booking),
      transactional: true,
    });
  }
  return bookings.length;
}
