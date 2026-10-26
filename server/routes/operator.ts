import { type RequestHandler, Router } from "express";
import { Types } from "mongoose";
import { z } from "zod";
import { DOCUMENT_TYPES, type DocumentType, TRIP_STATUSES, VEHICLE_STATUSES } from "../../shared/constants";
import { normalizeRwPhone, percentChange } from "../../shared/money";
import { addDays, isValidTimeString, kigaliDate, kigaliDayRange } from "../../shared/time";
import type { OperatorDashboardDTO, OperatorRevenueDTO, TrendPoint } from "../../shared/types";
import { config } from "../config";
import { ApiError, badRequest, conflict, notFound } from "../lib/errors";
import { qf } from "../lib/mongo";
import { body, query, requireRole, validate } from "../middleware";
import {
  BookingModel,
  FileModel,
  type OperatorDoc,
  OperatorModel,
  ParcelModel,
  PaymentModel,
  PayoutModel,
  RouteModel,
  ScheduleModel,
  TripModel,
  UserModel,
  VehicleModel,
} from "../models";
import { audit } from "../services/audit";
import { assertPriceAllowed, refreshRouteCap } from "../services/fares";
import { ensureLookups, invalidateLookups, loc } from "../services/lookup";
import { notify } from "../services/notify";
import { buildReport } from "../services/reports";
import {
  manifestBookingDTO,
  operatorDTO,
  payoutDTO,
  routeDTO,
  scheduleDTO,
  stationParcelDTO,
  stationTripDTO,
  vehicleDTO,
} from "../services/serializers";
import { getSettings } from "../services/settings";
import { objectKey, putObject } from "../services/storage";
import { cancelTrip, clearFutureTrips, createOneOffTrip, generateTripsFromSchedules, setTripDelay, setTripStatus } from "../services/trips";
import { actorOf, requireUser, sendCsv, toUserDTO } from "./helpers";
import { upload } from "./public";

export const operatorRouter = Router();
operatorRouter.use("/operator", requireRole("operator"));

const opId = (req: Parameters<RequestHandler>[0]): Types.ObjectId => requireUser(req).operatorId as Types.ObjectId;

async function loadOperator(req: Parameters<RequestHandler>[0]): Promise<OperatorDoc> {
  const operator = await OperatorModel.findById(opId(req));
  if (!operator) throw notFound();
  return operator;
}

/** Pending operators may prepare their setup; suspended or rejected ones are read-only. */
const requireWritable: RequestHandler = async (req, _res, next) => {
  const operator = await OperatorModel.findById(opId(req), { status: 1 }).lean();
  if (!operator || operator.status === "suspended" || operator.status === "rejected") {
    return next(new ApiError(403, "OPERATOR_NOT_APPROVED"));
  }
  next();
};

const requireOwner: RequestHandler = (req, _res, next) => {
  if (!requireUser(req).isOperatorOwner) return next(new ApiError(403, "FORBIDDEN"));
  next();
};

async function filesFor(ids: Types.ObjectId[]) {
  const files = await FileModel.find({ _id: { $in: ids } }).lean();
  return new Map(files.map((f) => [f._id.toString(), f]));
}

operatorRouter.get("/operator/me", async (req, res) => {
  await ensureLookups();
  const operator = await loadOperator(req);
  const settings = await getSettings();
  res.json(operatorDTO(operator.toObject(), await filesFor(operator.documents.map((d) => d.fileId)), settings.commissionRate));
});

// ── Dashboard ────────────────────────────────────────────────────────────────

async function paidSum(match: Record<string, unknown>): Promise<number> {
  const [row] = await PaymentModel.aggregate<{ total: number }>([
    { $match: { status: "success", ...match } },
    { $group: { _id: null, total: { $sum: "$amount" } } },
  ]);
  return row?.total ?? 0;
}

operatorRouter.get("/operator/dashboard", async (req, res) => {
  await ensureLookups();
  const operatorId = opId(req);
  const today = kigaliDate();
  const t = kigaliDayRange(today);
  const y = kigaliDayRange(addDays(today, -1));
  const sold = { $in: ["confirmed", "completed"] };
  const [bookingsToday, bookingsYesterday, revenueToday, revenueYesterday, vehicles, inTransit, pendingPickup, capViolations] =
    await Promise.all([
      BookingModel.countDocuments(qf({ operatorId, status: sold, createdAt: { $gte: t.start, $lt: t.end } })),
      BookingModel.countDocuments(qf({ operatorId, status: sold, createdAt: { $gte: y.start, $lt: y.end } })),
      paidSum({ operatorId, paidAt: { $gte: t.start, $lt: t.end } }),
      paidSum({ operatorId, paidAt: { $gte: y.start, $lt: y.end } }),
      VehicleModel.find({ operatorId, status: { $ne: "retired" } }, { status: 1 }).lean(),
      ParcelModel.countDocuments({ operatorId, status: "in_transit" }),
      ParcelModel.countDocuments({ operatorId, status: "arrived" }),
      RouteModel.countDocuments({ operatorId, capStatus: "above_cap" }),
    ]);
  const trips = await TripModel.find({
    operatorId,
    departureAt: { $gte: new Date(Date.now() - 60 * 60_000), $lt: t.end },
    status: { $in: ["scheduled", "boarding"] },
  })
    .sort({ departureAt: 1 })
    .limit(6)
    .lean();
  const parcelCounts = await ParcelModel.aggregate<{ _id: Types.ObjectId; n: number }>([
    { $match: { tripId: { $in: trips.map((tr) => tr._id) } } },
    { $group: { _id: "$tripId", n: { $sum: 1 } } },
  ]);
  const parcelsByTrip = new Map(parcelCounts.map((p) => [p._id.toString(), p.n]));
  const recent = await BookingModel.find({ operatorId, status: { $in: ["confirmed", "completed", "pending_payment"] } })
    .sort({ createdAt: -1 })
    .limit(6)
    .lean();
  const recentTrips = await TripModel.find({ _id: { $in: recent.map((b) => b.tripId) } }).lean();
  const tripMap = new Map(recentTrips.map((tr) => [tr._id.toString(), tr]));
  const dto: OperatorDashboardDTO = {
    date: today,
    bookingsToday,
    bookingsChange: percentChange(bookingsToday, bookingsYesterday),
    revenueToday,
    revenueChange: percentChange(revenueToday, revenueYesterday),
    activeVehicles: vehicles.filter((v) => v.status === "active").length,
    totalVehicles: vehicles.length,
    parcelsInTransit: inTransit,
    parcelsPendingPickup: pendingPickup,
    upcomingDepartures: trips.map((tr) => stationTripDTO(tr, parcelsByTrip.get(tr._id.toString()) ?? 0)),
    recentBookings: recent.map((b) => manifestBookingDTO(b, tripMap.get(b.tripId.toString()) ?? null)),
    capViolations,
  };
  res.json(dto);
});

// ── Routes ───────────────────────────────────────────────────────────────────

const objectId = z.string().regex(/^[a-f0-9]{24}$/i);

const routeSchema = z.object({
  originId: objectId,
  destinationId: objectId,
  viaIds: z.array(objectId).max(10).default([]),
  distanceKm: z.number().positive().max(1000).nullish(),
  durationMinutes: z.number().int().min(5).max(24 * 60),
  priceRwf: z.number().int().min(0).max(100_000),
});

operatorRouter.get("/operator/routes", async (req, res) => {
  await ensureLookups();
  const operatorId = opId(req);
  const [routes, schedules] = await Promise.all([
    RouteModel.find({ operatorId }).sort({ createdAt: 1 }).lean(),
    ScheduleModel.find({ operatorId, active: true }, { routeId: 1 }).lean(),
  ]);
  const perRoute = new Map<string, number>();
  for (const s of schedules) perRoute.set(s.routeId.toString(), (perRoute.get(s.routeId.toString()) ?? 0) + 1);
  res.json(routes.map((r) => routeDTO(r, perRoute.get(r._id.toString()) ?? 0)));
});

operatorRouter.post("/operator/routes", requireWritable, validate({ body: routeSchema }), async (req, res) => {
  const input = body<z.infer<typeof routeSchema>>(req);
  if (input.originId === input.destinationId) throw badRequest("VALIDATION_ERROR", { field: "destinationId" });
  const operatorId = opId(req);
  const cap = await assertPriceAllowed(input);
  const route = await RouteModel.create({ ...input, distanceKm: input.distanceKm ?? null, operatorId, ...cap });
  await refreshRouteCap(route._id);
  await audit(actorOf(req), "route.create", "route", route._id, null, { operatorId });
  await ensureLookups();
  res.status(201).json(routeDTO((await RouteModel.findById(route._id).lean())!, 0));
});

const routePatchSchema = routeSchema
  .omit({ originId: true, destinationId: true })
  .partial()
  .extend({ status: z.enum(["active", "paused"]).optional() });

operatorRouter.patch("/operator/routes/:id", requireWritable, validate({ body: routePatchSchema }), async (req, res) => {
  const input = body<z.infer<typeof routePatchSchema>>(req);
  const route = await RouteModel.findOne({ _id: req.params.id, operatorId: opId(req) });
  if (!route) throw notFound();
  // Routes paused by FIKA for a fare-cap violation stay paused until the price is fixed.
  if (input.status === "active" && route.pausedReason && route.capStatus === "above_cap" && input.priceRwf === undefined) {
    throw conflict("FARE_ABOVE_CAP");
  }
  Object.assign(route, input);
  if (input.priceRwf !== undefined || input.viaIds !== undefined) {
    const cap = await assertPriceAllowed(route);
    route.capRwf = cap.capRwf;
    route.capStatus = cap.capStatus;
    await TripModel.updateMany(
      { routeId: route._id, departureAt: { $gt: new Date() }, status: "scheduled" },
      { $set: { priceRwf: route.priceRwf, capRwf: cap.capRwf, durationMinutes: route.durationMinutes } },
    );
  } else if (input.durationMinutes !== undefined) {
    await TripModel.updateMany(
      { routeId: route._id, departureAt: { $gt: new Date() }, status: "scheduled" },
      { $set: { durationMinutes: route.durationMinutes } },
    );
  }
  if (input.status === "active") route.pausedReason = null;
  await route.save();
  await refreshRouteCap(route._id);
  await audit(actorOf(req), "route.update", "route", route._id, JSON.stringify(input).slice(0, 200), { operatorId: route.operatorId });
  await ensureLookups();
  res.json(routeDTO((await RouteModel.findById(route._id).lean())!, 0));
});

// ── Vehicles ─────────────────────────────────────────────────────────────────

const plate = z
  .string()
  .trim()
  .transform((v) => v.toUpperCase().replace(/[\s-]/g, ""))
  .pipe(z.string().regex(/^[A-Z0-9]{5,10}$/));

const vehicleSchema = z.object({
  plateNumber: plate,
  model: z.string().trim().max(100).nullish(),
  capacity: z.number().int().min(1).max(120),
});

operatorRouter.get("/operator/vehicles", async (req, res) => {
  const vehicles = await VehicleModel.find({ operatorId: opId(req) }).sort({ createdAt: 1 }).lean();
  const files = await filesFor(vehicles.flatMap((v) => v.documents.map((d) => d.fileId)));
  res.json(vehicles.map((v) => vehicleDTO(v, files)));
});

operatorRouter.post("/operator/vehicles", requireWritable, validate({ body: vehicleSchema }), async (req, res) => {
  const input = body<z.infer<typeof vehicleSchema>>(req);
  const vehicle = await VehicleModel.create({ ...input, model: input.model ?? null, operatorId: opId(req) });
  await audit(actorOf(req), "vehicle.create", "vehicle", vehicle._id, vehicle.plateNumber, { operatorId: vehicle.operatorId });
  res.status(201).json(vehicleDTO(vehicle.toObject(), new Map()));
});

const vehiclePatchSchema = z.object({
  model: z.string().trim().max(100).nullish(),
  capacity: z.number().int().min(1).max(120).optional(),
  status: z.enum(VEHICLE_STATUSES).optional(),
});

operatorRouter.patch("/operator/vehicles/:id", requireWritable, validate({ body: vehiclePatchSchema }), async (req, res) => {
  const input = body<z.infer<typeof vehiclePatchSchema>>(req);
  const vehicle = await VehicleModel.findOne({ _id: req.params.id, operatorId: opId(req) });
  if (!vehicle) throw notFound();
  if (input.status && input.status !== "active") {
    const booked = await TripModel.exists({ vehicleId: vehicle._id, departureAt: { $gt: new Date() }, seatsBooked: { $gt: 0 }, status: "scheduled" });
    if (booked) throw conflict("VEHICLE_IN_USE");
  }
  Object.assign(vehicle, input);
  await vehicle.save();
  if (input.capacity !== undefined) {
    await TripModel.updateMany(
      { vehicleId: vehicle._id, departureAt: { $gt: new Date() }, status: "scheduled", seatsBooked: { $lte: vehicle.capacity } },
      { $set: { seatsTotal: vehicle.capacity } },
    );
  }
  if (input.status && input.status !== "active") {
    await TripModel.deleteMany({ vehicleId: vehicle._id, departureAt: { $gt: new Date() }, seatsBooked: 0, status: "scheduled" });
  }
  await audit(actorOf(req), "vehicle.update", "vehicle", vehicle._id, JSON.stringify(input), { operatorId: vehicle.operatorId });
  const files = await filesFor(vehicle.documents.map((d) => d.fileId));
  res.json(vehicleDTO(vehicle.toObject(), files));
});

const documentSchema = z.object({
  type: z.enum(DOCUMENT_TYPES),
  expiresAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(z.literal("")),
});

async function storeUpload(req: Parameters<RequestHandler>[0], purpose: DocumentType) {
  if (!req.file) throw badRequest("VALIDATION_ERROR", { field: "file" });
  const stored = await putObject(objectKey(purpose, req.file.originalname), req.file.buffer, req.file.mimetype);
  return FileModel.create({
    ownerId: requireUser(req)._id,
    operatorId: opId(req),
    purpose,
    driver: stored.driver,
    key: stored.key,
    filename: req.file.originalname.slice(0, 120),
    contentType: req.file.mimetype,
    size: req.file.size,
  });
}

operatorRouter.post(
  "/operator/vehicles/:id/documents",
  requireWritable,
  upload.single("file"),
  validate({ body: documentSchema }),
  async (req, res) => {
    const input = body<z.infer<typeof documentSchema>>(req);
    const vehicle = await VehicleModel.findOne({ _id: req.params.id, operatorId: opId(req) });
    if (!vehicle) throw notFound();
    const file = await storeUpload(req, input.type);
    vehicle.documents.push({
      type: input.type,
      fileId: file._id,
      expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
      verified: false,
      uploadedAt: new Date(),
    });
    await vehicle.save();
    res.status(201).json(vehicleDTO(vehicle.toObject(), await filesFor(vehicle.documents.map((d) => d.fileId))));
  },
);

operatorRouter.post("/operator/documents", requireWritable, upload.single("file"), validate({ body: documentSchema }), async (req, res) => {
  const input = body<z.infer<typeof documentSchema>>(req);
  const operator = await loadOperator(req);
  const file = await storeUpload(req, input.type);
  operator.documents.push({
    type: input.type,
    fileId: file._id,
    expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
    verified: false,
    uploadedAt: new Date(),
  });
  await operator.save();
  await ensureLookups();
  const settings = await getSettings();
  res.status(201).json(operatorDTO(operator.toObject(), await filesFor(operator.documents.map((d) => d.fileId)), settings.commissionRate));
});

// ── Recurring departures & trips ─────────────────────────────────────────────

const timeString = z.string().refine(isValidTimeString, "Use HH:mm");
const scheduleSchema = z.object({
  routeId: objectId,
  vehicleId: objectId,
  departureTime: timeString,
  daysOfWeek: z.array(z.number().int().min(0).max(6)).min(1).max(7),
});

operatorRouter.get("/operator/schedules", async (req, res) => {
  await ensureLookups();
  const operatorId = opId(req);
  const schedules = await ScheduleModel.find({ operatorId }).sort({ departureTime: 1 }).lean();
  const [routes, vehicles] = await Promise.all([
    RouteModel.find({ operatorId }).lean(),
    VehicleModel.find({ operatorId }).lean(),
  ]);
  const routeMap = new Map(routes.map((r) => [r._id.toString(), r]));
  const vehicleMap = new Map(vehicles.map((v) => [v._id.toString(), v]));
  res.json(schedules.map((s) => scheduleDTO(s, routeMap.get(s.routeId.toString()), vehicleMap.get(s.vehicleId.toString()))));
});

operatorRouter.post("/operator/schedules", requireWritable, validate({ body: scheduleSchema }), async (req, res) => {
  const input = body<z.infer<typeof scheduleSchema>>(req);
  const operatorId = opId(req);
  const [route, vehicle] = await Promise.all([
    RouteModel.exists({ _id: input.routeId, operatorId }),
    VehicleModel.exists({ _id: input.vehicleId, operatorId }),
  ]);
  if (!route || !vehicle) throw notFound();
  const schedule = new ScheduleModel({
    operatorId,
    routeId: input.routeId,
    vehicleId: input.vehicleId,
    departureTime: input.departureTime.padStart(5, "0"),
    daysOfWeek: input.daysOfWeek,
  });
  await schedule.save();
  await generateTripsFromSchedules(14, schedule._id);
  await audit(actorOf(req), "schedule.create", "schedule", schedule._id, input.departureTime, { operatorId });
  res.status(201).json({ id: schedule._id.toString() });
});

const schedulePatchSchema = scheduleSchema.omit({ routeId: true }).partial().extend({ active: z.boolean().optional() });

operatorRouter.patch("/operator/schedules/:id", requireWritable, validate({ body: schedulePatchSchema }), async (req, res) => {
  const input = body<z.infer<typeof schedulePatchSchema>>(req);
  const schedule = await ScheduleModel.findOne({ _id: req.params.id, operatorId: opId(req) });
  if (!schedule) throw notFound();
  if (input.vehicleId && !(await VehicleModel.exists({ _id: input.vehicleId, operatorId: opId(req) }))) throw notFound();
  Object.assign(schedule, input);
  if (input.departureTime) schedule.departureTime = input.departureTime.padStart(5, "0");
  await schedule.save();
  await clearFutureTrips(schedule._id);
  if (schedule.active) await generateTripsFromSchedules(14, schedule._id);
  await audit(actorOf(req), "schedule.update", "schedule", schedule._id, JSON.stringify(input), { operatorId: schedule.operatorId });
  res.json({ ok: true });
});

operatorRouter.delete("/operator/schedules/:id", requireWritable, async (req, res) => {
  const schedule = await ScheduleModel.findOne({ _id: req.params.id, operatorId: opId(req) });
  if (!schedule) throw notFound();
  // Future trips without bookings go with it; booked trips stay so passengers keep their seats.
  await clearFutureTrips(schedule._id);
  await schedule.deleteOne();
  await audit(actorOf(req), "schedule.delete", "schedule", schedule._id, null, { operatorId: schedule.operatorId });
  res.json({ ok: true });
});

const dateQuery = z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() });

operatorRouter.get("/operator/trips", validate({ query: dateQuery }), async (req, res) => {
  await ensureLookups();
  const { date } = query<{ date?: string }>(req);
  const { start, end } = kigaliDayRange(date ?? kigaliDate());
  const trips = await TripModel.find({ operatorId: opId(req), departureAt: { $gte: start, $lt: end } })
    .sort({ departureAt: 1 })
    .lean();
  const counts = await ParcelModel.aggregate<{ _id: Types.ObjectId; n: number }>([
    { $match: { tripId: { $in: trips.map((t) => t._id) } } },
    { $group: { _id: "$tripId", n: { $sum: 1 } } },
  ]);
  const map = new Map(counts.map((c) => [c._id.toString(), c.n]));
  res.json(trips.map((t) => stationTripDTO(t, map.get(t._id.toString()) ?? 0)));
});

const tripCreateSchema = z.object({
  routeId: objectId,
  vehicleId: objectId,
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  time: timeString,
});

operatorRouter.post("/operator/trips", requireWritable, validate({ body: tripCreateSchema }), async (req, res) => {
  const input = body<z.infer<typeof tripCreateSchema>>(req);
  const trip = await createOneOffTrip(opId(req), input);
  await audit(actorOf(req), "trip.create", "trip", trip._id, `${input.date} ${input.time}`, { operatorId: trip.operatorId });
  await ensureLookups();
  res.status(201).json(stationTripDTO(trip.toObject()));
});

const tripPatchSchema = z.object({
  status: z.enum(TRIP_STATUSES).optional(),
  delayMinutes: z.number().int().min(0).max(24 * 60).optional(),
  reason: z.string().trim().max(200).optional(),
});

operatorRouter.patch("/operator/trips/:id", requireWritable, validate({ body: tripPatchSchema }), async (req, res) => {
  const input = body<z.infer<typeof tripPatchSchema>>(req);
  const trip = await TripModel.findOne({ _id: req.params.id, operatorId: opId(req) });
  if (!trip) throw notFound();
  const actor = actorOf(req);
  if (input.status === "cancelled") await cancelTrip(trip, input.reason || "Cancelled by operator", actor);
  else if (input.status) await setTripStatus(trip, input.status, actor);
  if (input.delayMinutes !== undefined) await setTripDelay(trip, input.delayMinutes, actor);
  await ensureLookups();
  res.json(stationTripDTO((await TripModel.findById(trip._id).lean())!));
});

// ── Bookings manifest ────────────────────────────────────────────────────────

const manifestQuery = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  status: z.enum(["all", "confirmed", "pending_payment", "checked_in", "cancelled"]).default("all"),
  tripId: objectId.optional(),
});

async function manifest(operatorId: Types.ObjectId, q: z.infer<typeof manifestQuery>) {
  const { start, end } = kigaliDayRange(q.date ?? kigaliDate());
  const filter: Record<string, unknown> = { operatorId, departureAt: { $gte: start, $lt: end } };
  if (q.tripId) filter.tripId = new Types.ObjectId(q.tripId);
  if (q.status === "confirmed") filter.status = { $in: ["confirmed", "completed"] };
  else if (q.status === "pending_payment") filter.status = "pending_payment";
  else if (q.status === "cancelled") filter.status = { $in: ["cancelled", "expired"] };
  else if (q.status === "checked_in") filter.checkedInAt = { $ne: null };
  const bookings = await BookingModel.find(filter).sort({ departureAt: 1, createdAt: 1 }).limit(2000).lean();
  const trips = await TripModel.find({ _id: { $in: bookings.map((b) => b.tripId) } }).lean();
  const tripMap = new Map(trips.map((t) => [t._id.toString(), t]));
  return bookings.map((b) => manifestBookingDTO(b, tripMap.get(b.tripId.toString()) ?? null));
}

operatorRouter.get("/operator/bookings", validate({ query: manifestQuery }), async (req, res) => {
  await ensureLookups();
  res.json(await manifest(opId(req), query<z.infer<typeof manifestQuery>>(req)));
});

operatorRouter.get("/operator/bookings.csv", validate({ query: dateQuery }), async (req, res) => {
  const { date } = query<{ date?: string }>(req);
  const day = date ?? kigaliDate();
  const csv = await buildReport("bookings", { from: day, to: day, operatorId: opId(req) });
  sendCsv(res, `fika-bookings-${day}.csv`, csv);
});

// ── Parcels ──────────────────────────────────────────────────────────────────

const parcelQuery = z.object({
  status: z.enum(["active", "awaiting_dropoff", "received", "in_transit", "arrived", "collected"]).default("active"),
});

operatorRouter.get("/operator/parcels", validate({ query: parcelQuery }), async (req, res) => {
  await ensureLookups();
  const { status } = query<z.infer<typeof parcelQuery>>(req);
  const filter: Record<string, unknown> = { operatorId: opId(req) };
  if (status === "active") filter.status = { $in: ["awaiting_dropoff", "received", "loaded", "in_transit", "arrived"] };
  else if (status === "received") filter.status = { $in: ["received", "loaded"] };
  else filter.status = status;
  const parcels = await ParcelModel.find(filter).sort({ createdAt: -1 }).limit(500).lean();
  res.json(parcels.map(stationParcelDTO));
});

// ── Pricing ──────────────────────────────────────────────────────────────────

const pricingSchema = z.object({
  routes: z.array(z.object({ id: objectId, priceRwf: z.number().int().min(0).max(100_000) })).max(200).default([]),
  parcelPricing: z
    .object({ enabled: z.boolean(), perKg: z.number().int().min(0).max(50_000), minimum: z.number().int().min(0).max(100_000) })
    .optional(),
});

operatorRouter.patch("/operator/pricing", requireWritable, validate({ body: pricingSchema }), async (req, res) => {
  const input = body<z.infer<typeof pricingSchema>>(req);
  const operatorId = opId(req);
  for (const r of input.routes) {
    const route = await RouteModel.findOne({ _id: r.id, operatorId });
    if (!route || route.priceRwf === r.priceRwf) continue;
    route.priceRwf = r.priceRwf;
    const cap = await assertPriceAllowed(route);
    route.capRwf = cap.capRwf;
    route.capStatus = cap.capStatus;
    await route.save();
    await TripModel.updateMany(
      { routeId: route._id, departureAt: { $gt: new Date() }, status: "scheduled" },
      { $set: { priceRwf: route.priceRwf, capRwf: cap.capRwf } },
    );
    await refreshRouteCap(route._id);
  }
  if (input.parcelPricing) await OperatorModel.updateOne({ _id: operatorId }, { $set: { parcelPricing: input.parcelPricing } });
  await audit(actorOf(req), "pricing.update", "operator", operatorId, `${input.routes.length} route prices`, { operatorId });
  res.json({ ok: true });
});

// ── Revenue ──────────────────────────────────────────────────────────────────

const periodQuery = z.object({ period: z.enum(["week", "month", "year"]).default("month") });

export async function revenueSeries(match: Record<string, unknown>, period: "week" | "month" | "year"): Promise<TrendPoint[]> {
  const now = new Date();
  if (period === "year") {
    const start = new Date(now);
    start.setUTCMonth(start.getUTCMonth() - 11, 1);
    const rows = await PaymentModel.aggregate<{ _id: string; v: number }>([
      { $match: { status: "success", paidAt: { $gte: start }, ...match } },
      { $group: { _id: { $dateToString: { format: "%Y-%m", date: "$paidAt", timezone: "Africa/Kigali" } }, v: { $sum: "$amount" } } },
    ]);
    const map = new Map(rows.map((r) => [r._id, r.v]));
    return Array.from({ length: 12 }, (_, i) => {
      const d = new Date(start);
      d.setUTCMonth(start.getUTCMonth() + i);
      const key = d.toISOString().slice(0, 7);
      return { label: key, value: map.get(key) ?? 0 };
    });
  }
  const days = period === "week" ? 7 : 30;
  const first = addDays(kigaliDate(), -(days - 1));
  const rows = await PaymentModel.aggregate<{ _id: string; v: number }>([
    { $match: { status: "success", paidAt: { $gte: kigaliDayRange(first).start }, ...match } },
    { $group: { _id: { $dateToString: { format: "%Y-%m-%d", date: "$paidAt", timezone: "Africa/Kigali" } }, v: { $sum: "$amount" } } },
  ]);
  const map = new Map(rows.map((r) => [r._id, r.v]));
  return Array.from({ length: days }, (_, i) => {
    const key = addDays(first, i);
    return { label: key, value: map.get(key) ?? 0 };
  });
}

export function periodStart(period: "week" | "month" | "year"): Date {
  const days = period === "week" ? 7 : period === "month" ? 30 : 365;
  return kigaliDayRange(addDays(kigaliDate(), -(days - 1))).start;
}

operatorRouter.get("/operator/revenue", validate({ query: periodQuery }), async (req, res) => {
  await ensureLookups();
  const { period } = query<z.infer<typeof periodQuery>>(req);
  const operatorId = opId(req);
  const since = periodStart(period);
  const [totals] = await PaymentModel.aggregate<{
    gross: number;
    online: number;
    cash: number;
    commission: number;
    parcels: number;
  }>([
    { $match: { operatorId, status: "success", paidAt: { $gte: since } } },
    {
      $group: {
        _id: null,
        gross: { $sum: "$amount" },
        online: { $sum: { $cond: [{ $ne: ["$method", "cash"] }, "$amount", 0] } },
        cash: { $sum: { $cond: [{ $eq: ["$method", "cash"] }, "$amount", 0] } },
        commission: { $sum: "$commissionAmount" },
        parcels: { $sum: { $cond: [{ $eq: ["$kind", "parcel"] }, "$amount", 0] } },
      },
    },
  ]);
  const byRoute = await BookingModel.aggregate<{ _id: { o: Types.ObjectId; d: Types.ObjectId }; bookings: number; gross: number }>([
    { $match: { operatorId, paymentStatus: "paid", createdAt: { $gte: since } } },
    { $group: { _id: { o: "$originId", d: "$destinationId" }, bookings: { $sum: 1 }, gross: { $sum: "$totalAmount" } } },
    { $sort: { gross: -1 } },
    { $limit: 10 },
  ]);
  const [payouts, settings, operator] = await Promise.all([
    PayoutModel.find({ operatorId }).sort({ createdAt: -1 }).limit(10).lean(),
    getSettings(),
    OperatorModel.findById(operatorId, { commissionRate: 1 }).lean(),
  ]);
  const gross = totals?.gross ?? 0;
  const commission = totals?.commission ?? 0;
  const dto: OperatorRevenueDTO = {
    period,
    gross,
    online: totals?.online ?? 0,
    cash: totals?.cash ?? 0,
    commission,
    net: gross - commission,
    parcels: totals?.parcels ?? 0,
    series: await revenueSeries({ operatorId }, period),
    byRoute: byRoute.map((r) => ({ route: `${loc(r._id.o).name} → ${loc(r._id.d).name}`, bookings: r.bookings, gross: r.gross })),
    payouts: payouts.map(payoutDTO),
    commissionRate: operator?.commissionRate ?? settings.commissionRate,
    payoutCycleDays: settings.payoutCycleDays,
  };
  res.json(dto);
});

// ── Settings & team ──────────────────────────────────────────────────────────

const settingsSchema = z.object({
  name: z.string().trim().min(2).max(150).optional(),
  contactPhone: z.string().trim().max(20).optional(),
  contactEmail: z.string().trim().email().max(150).nullish().or(z.literal("")),
  headquartersId: objectId.nullish(),
  cancellationHours: z.number().int().min(0).max(72).optional(),
  bankAccount: z
    .object({
      bankName: z.string().trim().min(2).max(80),
      accountName: z.string().trim().min(2).max(120),
      accountNumber: z.string().trim().min(4).max(34),
    })
    .nullish(),
});

operatorRouter.patch("/operator/settings", requireOwner, requireWritable, validate({ body: settingsSchema }), async (req, res) => {
  const input = body<z.infer<typeof settingsSchema>>(req);
  const operator = await loadOperator(req);
  if (input.name) operator.name = input.name;
  if (input.contactPhone) {
    const phone = normalizeRwPhone(input.contactPhone);
    if (!phone) throw badRequest("PHONE_INVALID", { field: "contactPhone" });
    operator.contactPhone = phone;
  }
  if (input.contactEmail !== undefined) operator.contactEmail = input.contactEmail || null;
  if (input.headquartersId !== undefined) operator.headquartersId = input.headquartersId ? new Types.ObjectId(input.headquartersId) : null;
  if (input.cancellationHours !== undefined) operator.cancellationHours = input.cancellationHours;
  if (input.bankAccount !== undefined) operator.bankAccount = input.bankAccount ?? null;
  await operator.save();
  invalidateLookups();
  await audit(actorOf(req), "operator.settings", "operator", operator._id, Object.keys(input).join(", "), { operatorId: operator._id });
  await ensureLookups();
  const settings = await getSettings();
  res.json(operatorDTO(operator.toObject(), await filesFor(operator.documents.map((d) => d.fileId)), settings.commissionRate));
});

operatorRouter.get("/operator/staff", async (req, res) => {
  const staff = await UserModel.find({ role: "operator", operatorId: opId(req) }).sort({ createdAt: 1 });
  res.json(await Promise.all(staff.map((u) => toUserDTO(u))));
});

const staffSchema = z.object({
  name: z.string().trim().min(2).max(120),
  phone: z.string().trim().min(9).max(20),
  email: z.string().trim().email().max(150).optional().or(z.literal("")),
});

operatorRouter.post("/operator/staff", requireOwner, requireWritable, validate({ body: staffSchema }), async (req, res) => {
  const input = body<z.infer<typeof staffSchema>>(req);
  const phone = normalizeRwPhone(input.phone);
  if (!phone) throw badRequest("PHONE_INVALID", { field: "phone" });
  const operator = await loadOperator(req);
  let user = await UserModel.findOne({ phone });
  if (user && user.role !== "passenger") throw conflict("DUPLICATE", { field: "phone" });
  if (user) {
    user.role = "operator";
    user.operatorId = operator._id;
    user.isOperatorOwner = false;
    if (!user.name) user.name = input.name;
    await user.save();
  } else {
    user = await UserModel.create({
      name: input.name,
      phone,
      email: input.email || null,
      role: "operator",
      operatorId: operator._id,
      status: "invited",
    });
  }
  await notify({
    userId: user._id,
    type: "staff.invited",
    sms: "notifications.staffInvitedSms",
    vars: { org: operator.name, role: "operator", link: `${config.webUrl}/auth/login` },
    transactional: true,
  });
  await audit(actorOf(req), "staff.add", "user", user._id, `${input.name} ${phone}`, { operatorId: operator._id });
  res.status(201).json(await toUserDTO(user));
});

operatorRouter.delete("/operator/staff/:id", requireOwner, async (req, res) => {
  const user = await UserModel.findOne({ _id: req.params.id, operatorId: opId(req), role: "operator" });
  if (!user) throw notFound();
  if (user.isOperatorOwner) throw conflict("INVALID_STATE");
  user.role = "passenger";
  user.operatorId = null;
  await user.save();
  await audit(actorOf(req), "staff.remove", "user", user._id, user.name ?? null, { operatorId: opId(req) });
  res.json({ ok: true });
});
