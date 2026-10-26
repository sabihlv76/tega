import { Types } from "mongoose";
import type { TripStatus } from "../../shared/constants";
import { addDays, formatClock, isValidDateString, kigaliDate, kigaliDateTime, kigaliDayRange, kigaliWeekday } from "../../shared/time";
import type { BoardDTO, BoardItemDTO, PopularRouteDTO, TripDTO } from "../../shared/types";
import { badRequest, conflict, notFound } from "../lib/errors";
import { logger } from "../lib/logger";
import {
  BookingModel,
  OperatorModel,
  PaymentModel,
  RouteModel,
  ScheduleModel,
  type TripDoc,
  TripModel,
  VehicleModel,
} from "../models";
import { emit, rooms } from "../realtime";
import { type Actor, audit } from "./audit";
import { cancelBooking } from "./bookings";
import { ensureLookups, findLocation, loc, op } from "./lookup";
import { notify } from "./notify";
import { onTripArrived, onTripCancelled, onTripDeparted } from "./parcels";
import { deriveBoardStatus, effectiveDeparture, tripDTO } from "./serializers";

type Oid = Types.ObjectId | string;
const MINUTE = 60_000;

// ── Capacity (atomic, prevents overbooking without transactions) ─────────────

export async function holdPlaces(tripId: Oid, places: number): Promise<TripDoc | null> {
  return TripModel.findOneAndUpdate(
    {
      _id: tripId,
      status: { $in: ["scheduled", "boarding"] },
      $expr: { $lte: [{ $add: ["$seatsBooked", places] }, "$seatsTotal"] },
    },
    { $inc: { seatsBooked: places } },
    { returnDocument: "after" },
  );
}

export async function releasePlaces(tripId: Oid, places: number): Promise<void> {
  await TripModel.updateOne({ _id: tripId, seatsBooked: { $gte: places } }, { $inc: { seatsBooked: -places } });
}

// ── Generation from recurring departures ─────────────────────────────────────

export async function generateTripsFromSchedules(daysAhead = 14, scheduleId?: Oid): Promise<number> {
  const schedules = await ScheduleModel.find(scheduleId ? { _id: scheduleId, active: true } : { active: true }).lean();
  if (schedules.length === 0) return 0;
  const [routes, vehicles, operators] = await Promise.all([
    RouteModel.find({ _id: { $in: schedules.map((s) => s.routeId) } }).lean(),
    VehicleModel.find({ _id: { $in: schedules.map((s) => s.vehicleId) } }).lean(),
    OperatorModel.find({ _id: { $in: schedules.map((s) => s.operatorId) } }, { name: 1, status: 1 }).lean(),
  ]);
  const routeMap = new Map(routes.map((r) => [r._id.toString(), r]));
  const vehicleMap = new Map(vehicles.map((v) => [v._id.toString(), v]));
  const operatorMap = new Map(operators.map((o) => [o._id.toString(), o]));

  const today = kigaliDate();
  const now = Date.now();
  const ops = [];
  for (const s of schedules) {
    const route = routeMap.get(s.routeId.toString());
    const vehicle = vehicleMap.get(s.vehicleId.toString());
    const operator = operatorMap.get(s.operatorId.toString());
    if (!route || !vehicle || !operator) continue;
    if (route.status !== "active" || vehicle.status !== "active" || operator.status !== "approved") continue;
    for (let d = 0; d <= daysAhead; d++) {
      const date = addDays(today, d);
      if (!s.daysOfWeek.includes(kigaliWeekday(date))) continue;
      const departureAt = kigaliDateTime(date, s.departureTime);
      if (departureAt.getTime() < now) continue;
      ops.push({
        updateOne: {
          filter: { scheduleId: s._id, departureAt },
          update: {
            $setOnInsert: {
              operatorId: s.operatorId,
              routeId: route._id,
              scheduleId: s._id,
              vehicleId: vehicle._id,
              originId: route.originId,
              destinationId: route.destinationId,
              viaIds: route.viaIds ?? [],
              departureAt,
              durationMinutes: route.durationMinutes,
              priceRwf: route.priceRwf,
              capRwf: route.capRwf ?? null,
              seatsTotal: vehicle.capacity,
              seatsBooked: 0,
              checkedInCount: 0,
              delayMinutes: 0,
              status: "scheduled",
              operatorName: operator.name,
              plateNumber: vehicle.plateNumber,
              vehicleModel: vehicle.model ?? null,
            },
          },
          upsert: true,
        },
      });
    }
  }
  let created = 0;
  for (let i = 0; i < ops.length; i += 500) {
    const res = await TripModel.bulkWrite(ops.slice(i, i + 500), { ordered: false });
    created += res.upsertedCount;
  }
  if (created > 0) logger.info(`Generated ${created} trips from recurring departures`);
  return created;
}

/** Removes future, unbooked trips of a schedule (before regenerating it after an edit). */
export async function clearFutureTrips(scheduleId: Oid): Promise<void> {
  await TripModel.deleteMany({ scheduleId, departureAt: { $gt: new Date() }, seatsBooked: 0, status: "scheduled" });
}

export async function createOneOffTrip(
  operatorId: Oid,
  input: { routeId: string; vehicleId: string; date: string; time: string },
): Promise<TripDoc> {
  if (!isValidDateString(input.date)) throw badRequest("VALIDATION_ERROR", { field: "date" });
  const [route, vehicle, operator] = await Promise.all([
    RouteModel.findOne({ _id: input.routeId, operatorId }).lean(),
    VehicleModel.findOne({ _id: input.vehicleId, operatorId }).lean(),
    OperatorModel.findById(operatorId).lean(),
  ]);
  if (!route || !vehicle || !operator) throw notFound();
  if (vehicle.status !== "active") throw badRequest("INVALID_STATE", { field: "vehicleId" });
  const departureAt = kigaliDateTime(input.date, input.time);
  if (departureAt.getTime() < Date.now()) throw badRequest("VALIDATION_ERROR", { field: "time" });
  return TripModel.create({
    operatorId,
    routeId: route._id,
    vehicleId: vehicle._id,
    originId: route.originId,
    destinationId: route.destinationId,
    viaIds: route.viaIds ?? [],
    departureAt,
    durationMinutes: route.durationMinutes,
    priceRwf: route.priceRwf,
    capRwf: route.capRwf ?? null,
    seatsTotal: vehicle.capacity,
    operatorName: operator.name,
    plateNumber: vehicle.plateNumber,
    vehicleModel: vehicle.model ?? null,
  });
}

// ── Search ───────────────────────────────────────────────────────────────────

export async function searchTrips(from: string, to: string, date: string): Promise<TripDTO[]> {
  await ensureLookups();
  const [origin, destination] = await Promise.all([findLocation(from), findLocation(to)]);
  if (!origin || !destination) return [];
  if (!isValidDateString(date)) throw badRequest("VALIDATION_ERROR", { field: "date" });
  const { start, end } = kigaliDayRange(date);
  const trips = await TripModel.find({
    originId: origin.id,
    destinationId: destination.id,
    departureAt: { $gte: start, $lt: end },
  })
    .sort({ departureAt: 1 })
    .lean();
  if (trips.length === 0) return [];
  const [routes, operators] = await Promise.all([
    RouteModel.find({ _id: { $in: trips.map((t) => t.routeId) } }, { status: 1 }).lean(),
    OperatorModel.find({ _id: { $in: trips.map((t) => t.operatorId) } }, { status: 1 }).lean(),
  ]);
  const activeRoutes = new Set(routes.filter((r) => r.status === "active").map((r) => r._id.toString()));
  const approved = new Set(operators.filter((o) => o.status === "approved").map((o) => o._id.toString()));
  const now = Date.now();
  return trips
    .filter(
      (t) =>
        activeRoutes.has(t.routeId.toString()) &&
        approved.has(t.operatorId.toString()) &&
        (t.status === "scheduled" || t.status === "boarding") &&
        effectiveDeparture(t).getTime() > now,
    )
    .sort((a, b) => effectiveDeparture(a).getTime() - effectiveDeparture(b).getTime())
    .map((t) => tripDTO(t));
}

export async function getTripDTO(tripId: string): Promise<TripDTO> {
  if (!Types.ObjectId.isValid(tripId)) throw notFound();
  await ensureLookups();
  const trip = await TripModel.findById(tripId).lean();
  if (!trip) throw notFound();
  return tripDTO(trip);
}

export async function popularRoutes(limit = 6): Promise<PopularRouteDTO[]> {
  await ensureLookups();
  const now = new Date();
  const rows = await TripModel.aggregate<{
    _id: { o: Types.ObjectId; d: Types.ObjectId };
    trips: number;
    minPrice: number;
    duration: number;
    operators: Types.ObjectId[];
  }>([
    { $match: { departureAt: { $gte: now, $lt: new Date(now.getTime() + 7 * 24 * 60 * MINUTE) }, status: "scheduled" } },
    {
      $group: {
        _id: { o: "$originId", d: "$destinationId" },
        trips: { $sum: 1 },
        minPrice: { $min: "$priceRwf" },
        duration: { $min: "$durationMinutes" },
        operators: { $addToSet: "$operatorId" },
      },
    },
    { $sort: { trips: -1 } },
    { $limit: limit },
  ]);
  return rows.map((r) => ({
    origin: loc(r._id.o),
    destination: loc(r._id.d),
    durationMinutes: r.duration,
    fromPriceRwf: r.minPrice,
    operators: r.operators.length,
  }));
}

// ── Departure boards ─────────────────────────────────────────────────────────

function boardItem(trip: Parameters<typeof tripDTO>[0]): BoardItemDTO {
  return {
    tripId: trip._id.toString(),
    departureAt: effectiveDeparture(trip).toISOString(),
    scheduledAt: new Date(trip.departureAt).toISOString(),
    origin: loc(trip.originId),
    destination: loc(trip.destinationId),
    via: (trip.viaIds ?? []).map((v) => loc(v)),
    durationMinutes: trip.durationMinutes,
    operatorName: op(trip.operatorId).name !== "—" ? op(trip.operatorId).name : trip.operatorName,
    plateNumber: trip.plateNumber,
    status: deriveBoardStatus(trip),
    delayMinutes: trip.delayMinutes ?? 0,
  };
}

export async function boardFor(stationIdOrSlug: string, date = kigaliDate()): Promise<BoardDTO> {
  await ensureLookups();
  const station = await findLocation(stationIdOrSlug);
  if (!station) throw notFound();
  const { start, end } = kigaliDayRange(date);
  const trips = await TripModel.find({ originId: station.id, departureAt: { $gte: start, $lt: end } }).lean();
  const now = Date.now();
  const items = trips
    .filter((t) => {
      if (t.status === "arrived") return false;
      if (t.status === "departed" || t.status === "cancelled") {
        return effectiveDeparture(t).getTime() > now - 30 * MINUTE;
      }
      return true;
    })
    .sort((a, b) => effectiveDeparture(a).getTime() - effectiveDeparture(b).getTime())
    .map(boardItem);
  return {
    station: { id: station.id, slug: station.slug, name: station.name },
    date,
    items,
    remaining: items.filter((i) => i.status !== "departed" && i.status !== "cancelled" && i.status !== "arrived").length,
  };
}

/** Pushes a trip change to everyone watching it (passengers, boards, operator and station desks). */
export async function emitTripUpdate(trip: TripDoc | Parameters<typeof tripDTO>[0]): Promise<void> {
  await ensureLookups();
  const plain = "toObject" in trip ? (trip as TripDoc).toObject() : trip;
  const dto = tripDTO(plain);
  const origin = plain.originId.toString();
  emit([rooms.trip(dto.id), rooms.operator(plain.operatorId.toString()), rooms.station(origin)], "trip.updated", dto);
  emit(rooms.board(origin), "board.updated", boardItem(plain));
}

// ── Status changes ───────────────────────────────────────────────────────────

const TRANSITIONS: Record<TripStatus, TripStatus[]> = {
  scheduled: ["boarding", "departed", "cancelled"],
  boarding: ["departed", "cancelled", "scheduled"],
  departed: ["arrived"],
  arrived: [],
  cancelled: [],
};

async function passengersOf(tripId: Types.ObjectId) {
  return BookingModel.find({ tripId, status: "confirmed" }).lean();
}

export async function setTripStatus(trip: TripDoc, status: TripStatus, actor: Actor | null): Promise<TripDoc> {
  if (status === "cancelled") return cancelTrip(trip, "Cancelled by operator", actor);
  if (!TRANSITIONS[trip.status as TripStatus].includes(status)) throw conflict("INVALID_STATE");
  trip.status = status;
  trip.statusChangedAt = new Date();
  await trip.save();
  await ensureLookups();

  if (status === "boarding") {
    for (const b of await passengersOf(trip._id)) {
      await notify({
        userId: b.userId,
        locale: b.locale as never,
        type: "trip.boarding",
        inApp: { title: "notifications.boardingTitle", body: "notifications.boardingBody" },
        vars: { to: loc(trip.destinationId).name, plate: trip.plateNumber },
        data: { bookingId: b._id.toString(), reference: b.reference },
      });
    }
  }
  if (status === "departed") {
    const now = new Date();
    const bookings = await BookingModel.find({ tripId: trip._id }, { _id: 1, status: 1, places: 1 }).lean();
    const paidIds = bookings.map((b) => b._id);
    await PaymentModel.updateMany(
      { bookingId: { $in: paidIds }, status: "success", eligibleForPayoutAt: null },
      { $set: { eligibleForPayoutAt: now } },
    );
    // Unpaid holds on a departed bus can no longer be completed.
    await BookingModel.updateMany(
      { tripId: trip._id, status: "pending_payment" },
      { $set: { status: "expired", holdExpiresAt: null } },
    );
    await onTripDeparted(trip);
  }
  if (status === "arrived") {
    await BookingModel.updateMany({ tripId: trip._id, status: "confirmed" }, { $set: { status: "completed" } });
    await onTripArrived(trip);
  }
  await audit(actor, `trip.${status}`, "trip", trip._id, `${loc(trip.originId).name} → ${loc(trip.destinationId).name} ${formatClock(trip.departureAt)}`, {
    operatorId: trip.operatorId,
  });
  await emitTripUpdate(trip);
  return trip;
}

export async function setTripDelay(trip: TripDoc, minutes: number, actor: Actor | null): Promise<TripDoc> {
  if (trip.status !== "scheduled" && trip.status !== "boarding") throw conflict("INVALID_STATE");
  const previous = trip.delayMinutes ?? 0;
  trip.delayMinutes = Math.max(0, Math.round(minutes));
  trip.statusChangedAt = new Date();
  await trip.save();
  await ensureLookups();
  if (trip.delayMinutes > previous) {
    for (const b of await passengersOf(trip._id)) {
      await notify({
        userId: b.userId,
        phone: b.traveler.phone,
        locale: b.locale as never,
        type: "trip.delayed",
        inApp: { title: "notifications.tripDelayedTitle", body: "notifications.tripDelayedBody" },
        sms: "notifications.tripDelayedBody",
        vars: { time: formatClock(trip.departureAt), to: loc(trip.destinationId).name, minutes: trip.delayMinutes },
        data: { bookingId: b._id.toString(), reference: b.reference },
        transactional: true,
      });
    }
  }
  await audit(actor, "trip.delay", "trip", trip._id, `${trip.delayMinutes} min`, { operatorId: trip.operatorId });
  await emitTripUpdate(trip);
  return trip;
}

export async function cancelTrip(trip: TripDoc, reason: string, actor: Actor | null): Promise<TripDoc> {
  if (trip.status === "departed" || trip.status === "arrived" || trip.status === "cancelled") {
    throw conflict("INVALID_STATE");
  }
  trip.status = "cancelled";
  trip.cancelReason = reason;
  trip.statusChangedAt = new Date();
  await trip.save();
  const bookings = await BookingModel.find({ tripId: trip._id, status: { $in: ["pending_payment", "confirmed"] } });
  for (const booking of bookings) {
    await cancelBooking(booking, { by: actor?.role === "admin" ? "admin" : "operator", reason, actor, tripCancelled: true });
  }
  await TripModel.updateOne({ _id: trip._id }, { $set: { seatsBooked: 0 } });
  await onTripCancelled(trip);
  await audit(actor, "trip.cancel", "trip", trip._id, reason, { operatorId: trip.operatorId });
  await emitTripUpdate(trip);
  return trip;
}

/** Keeps statuses moving when staff forget to update them (runs every minute). */
export async function autoAdvanceTrips(): Promise<void> {
  const now = Date.now();
  const stale = await TripModel.find({
    status: { $in: ["scheduled", "boarding"] },
    departureAt: { $lt: new Date(now - 20 * MINUTE) },
  }).limit(200);
  for (const trip of stale) {
    if (effectiveDeparture(trip).getTime() + 20 * MINUTE < now) await setTripStatus(trip, "departed", null);
  }
  const travelling = await TripModel.find({ status: "departed", departureAt: { $lt: new Date(now - 30 * MINUTE) } }).limit(200);
  for (const trip of travelling) {
    if (effectiveDeparture(trip).getTime() + (trip.durationMinutes + 30) * MINUTE < now) {
      await setTripStatus(trip, "arrived", null);
    }
  }
}
