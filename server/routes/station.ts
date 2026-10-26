import { type Request, Router } from "express";
import { z } from "zod";
import { kigaliDate, kigaliDayRange } from "../../shared/time";
import type { StationDashboardDTO, StationTripDetailDTO } from "../../shared/types";
import { ApiError, conflict, notFound } from "../lib/errors";
import { body, query, rateLimit, requireRole, validate } from "../middleware";
import { BookingModel, ParcelModel, TripModel } from "../models";
import { checkInTicket } from "../services/bookings";
import { ensureLookups, loc } from "../services/lookup";
import { findParcelByCode, loadParcel, receiveParcel, releaseParcel, stationParcels } from "../services/parcels";
import { manifestBookingDTO, stationParcelDTO, stationTripDTO } from "../services/serializers";
import { setTripDelay, setTripStatus } from "../services/trips";
import { actorOf, requireUser } from "./helpers";

export const stationRouter = Router();
stationRouter.use("/station", requireRole("station"));

function stationOf(req: Request) {
  const user = requireUser(req);
  if (!user.stationId) throw new ApiError(403, "FORBIDDEN", { reason: "no_station" });
  return user.stationId;
}

async function departures(stationId: ReturnType<typeof stationOf>, date: string) {
  const { start, end } = kigaliDayRange(date);
  const trips = await TripModel.find({ originId: stationId, departureAt: { $gte: start, $lt: end } }).sort({ departureAt: 1 }).lean();
  const counts = await ParcelModel.aggregate<{ _id: unknown; n: number }>([
    { $match: { tripId: { $in: trips.map((t) => t._id) } } },
    { $group: { _id: "$tripId", n: { $sum: 1 } } },
  ]);
  const map = new Map(counts.map((c) => [String(c._id), c.n]));
  return trips.map((t) => stationTripDTO(t, map.get(t._id.toString()) ?? 0));
}

stationRouter.get("/station/dashboard", async (req, res) => {
  await ensureLookups();
  const stationId = stationOf(req);
  const today = kigaliDate();
  const trips = await departures(stationId, today);
  const now = Date.now();
  const [toLoad, toRelease] = await Promise.all([
    ParcelModel.countDocuments({ originId: stationId, status: "received" }),
    ParcelModel.countDocuments({ destinationId: stationId, status: "arrived" }),
  ]);
  const active = trips.filter((t) => t.status !== "cancelled");
  const dto: StationDashboardDTO = {
    station: loc(stationId),
    date: today,
    departuresToday: active.length,
    passengersCheckedIn: active.reduce((s, t) => s + t.checkedIn, 0),
    passengersBooked: active.reduce((s, t) => s + t.booked, 0),
    parcelsToLoad: toLoad,
    parcelsToRelease: toRelease,
    nextDepartures: active
      .filter((t) => t.status === "scheduled" || t.status === "boarding" || new Date(t.departureAt).getTime() > now - 15 * 60_000)
      .filter((t) => t.status !== "arrived" && t.status !== "departed")
      .slice(0, 8),
  };
  res.json(dto);
});

const dateQuery = z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() });

stationRouter.get("/station/trips", validate({ query: dateQuery }), async (req, res) => {
  await ensureLookups();
  const { date } = query<{ date?: string }>(req);
  res.json(await departures(stationOf(req), date ?? kigaliDate()));
});

stationRouter.get("/station/trips/:id", async (req, res) => {
  await ensureLookups();
  const stationId = stationOf(req);
  const trip = await TripModel.findOne({ _id: req.params.id, originId: stationId }).lean();
  if (!trip) throw notFound();
  const [bookings, parcels, loadable] = await Promise.all([
    BookingModel.find({ tripId: trip._id, status: { $in: ["confirmed", "completed", "pending_payment"] } })
      .sort({ "traveler.name": 1 })
      .lean(),
    ParcelModel.find({ tripId: trip._id }).lean(),
    ParcelModel.find({
      originId: stationId,
      destinationId: trip.destinationId,
      operatorId: trip.operatorId,
      status: "received",
    }).lean(),
  ]);
  const dto: StationTripDetailDTO = {
    trip: stationTripDTO(trip, parcels.length),
    passengers: bookings.map((b) => manifestBookingDTO(b, trip)),
    parcels: parcels.map(stationParcelDTO),
    loadable: loadable.map(stationParcelDTO),
  };
  res.json(dto);
});

const tripPatchSchema = z.object({
  status: z.enum(["scheduled", "boarding", "departed"]).optional(),
  delayMinutes: z.number().int().min(0).max(24 * 60).optional(),
});

stationRouter.patch("/station/trips/:id", validate({ body: tripPatchSchema }), async (req, res) => {
  const input = body<z.infer<typeof tripPatchSchema>>(req);
  const trip = await TripModel.findOne({ _id: req.params.id, originId: stationOf(req) });
  if (!trip) throw notFound();
  if (input.status) await setTripStatus(trip, input.status, actorOf(req));
  if (input.delayMinutes !== undefined) await setTripDelay(trip, input.delayMinutes, actorOf(req));
  await ensureLookups();
  res.json(stationTripDTO((await TripModel.findById(trip._id).lean())!));
});

const checkinSchema = z.object({ code: z.string().trim().min(5).max(200), collectCash: z.boolean().optional() });

stationRouter.post(
  "/station/checkin",
  rateLimit({ name: "checkin", windowMs: 60_000, max: 120, key: (req) => req.user?._id.toString() ?? req.ip ?? "" }),
  validate({ body: checkinSchema }),
  async (req, res) => {
    const input = body<z.infer<typeof checkinSchema>>(req);
    res.json(await checkInTicket(requireUser(req), input));
  },
);

// ── Parcels desk ─────────────────────────────────────────────────────────────

stationRouter.get("/station/parcels", async (req, res) => {
  res.json(await stationParcels(requireUser(req)));
});

stationRouter.get("/station/parcels/:code", async (req, res) => {
  await ensureLookups();
  const stationId = stationOf(req).toString();
  const parcel = await findParcelByCode(String(req.params.code));
  if (parcel.originId.toString() !== stationId && parcel.destinationId.toString() !== stationId) throw notFound();
  res.json(stationParcelDTO(parcel.toObject()));
});

stationRouter.get("/station/parcels/:code/trips", async (req, res) => {
  await ensureLookups();
  const stationId = stationOf(req);
  const parcel = await findParcelByCode(String(req.params.code));
  if (parcel.originId.toString() !== stationId.toString()) throw conflict("INVALID_STATE");
  const { start, end } = kigaliDayRange(kigaliDate());
  const trips = await TripModel.find({
    originId: stationId,
    destinationId: parcel.destinationId,
    operatorId: parcel.operatorId,
    status: { $in: ["scheduled", "boarding"] },
    departureAt: { $gte: new Date(Math.max(start.getTime(), Date.now() - 30 * 60_000)), $lt: new Date(end.getTime() + 24 * 3600_000) },
  })
    .sort({ departureAt: 1 })
    .limit(10)
    .lean();
  res.json(trips.map((t) => stationTripDTO(t)));
});

stationRouter.post(
  "/station/parcels/:code/receive",
  validate({ body: z.object({ collectCash: z.boolean().optional() }) }),
  async (req, res) => {
    const { collectCash } = body<{ collectCash?: boolean }>(req);
    res.json(await receiveParcel(requireUser(req), String(req.params.code), !!collectCash));
  },
);

stationRouter.post("/station/parcels/:code/load", validate({ body: z.object({ tripId: z.string().length(24) }) }), async (req, res) => {
  const { tripId } = body<{ tripId: string }>(req);
  res.json(await loadParcel(requireUser(req), String(req.params.code), tripId));
});

stationRouter.post(
  "/station/parcels/:code/release",
  rateLimit({ name: "release", windowMs: 15 * 60_000, max: 20, key: (req) => `${req.params.code}` }),
  validate({ body: z.object({ pickupCode: z.string().trim().length(6) }) }),
  async (req, res) => {
    const { pickupCode } = body<{ pickupCode: string }>(req);
    res.json(await releaseParcel(requireUser(req), String(req.params.code), pickupCode));
  },
);
