import { Router } from "express";
import { Types } from "mongoose";
import { z } from "zod";
import { FARE_CAP_ENFORCEMENT, LOCALES, ROLES, USER_STATUSES } from "../../shared/constants";
import { formatRwf, normalizeRwPhone, percentChange } from "../../shared/money";
import { addDays, kigaliDate, kigaliDayRange } from "../../shared/time";
import type {
  AdminDashboardDTO,
  AdminOperatorDetailDTO,
  AdminRevenueDTO,
  CapViolationDTO,
  FareCapDTO,
  FareCapListDTO,
  OperatorSummaryDTO,
} from "../../shared/types";
import { config } from "../config";
import { badRequest, conflict, notFound } from "../lib/errors";
import { qf } from "../lib/mongo";
import { body, query, requireRole, validate } from "../middleware";
import {
  AuditLogModel,
  BookingModel,
  FareCapModel,
  FileModel,
  LocationModel,
  OperatorModel,
  ParcelModel,
  PaymentModel,
  PayoutModel,
  RouteModel,
  TripModel,
  UserModel,
  VehicleModel,
} from "../models";
import { audit } from "../services/audit";
import { importCapsCsv, refreshCapsForPair, refreshRouteCap } from "../services/fares";
import { ensureLookups, invalidateLookups, loc, op } from "../services/lookup";
import { notify, notifyOperatorStaff } from "../services/notify";
import { generatePayouts, processAllPayouts, processPayout } from "../services/payouts";
import { buildReport, REPORT_TYPES, type ReportType } from "../services/reports";
import { auditLogDTO, operatorDTO, payoutDTO, routeDTO, vehicleDTO } from "../services/serializers";
import { getSettings, updateSettings } from "../services/settings";
import { generateTripsFromSchedules } from "../services/trips";
import { actorOf, sendCsv, toUserDTO } from "./helpers";
import { revenueSeries } from "./operator";
import { createLocation, upload } from "./public";

export const adminRouter = Router();
adminRouter.use("/admin", requireRole("admin"));

const objectId = z.string().regex(/^[a-f0-9]{24}$/i);

async function filesFor(ids: Types.ObjectId[]) {
  const files = await FileModel.find({ _id: { $in: ids } }).lean();
  return new Map(files.map((f) => [f._id.toString(), f]));
}

async function recentActivity(limit = 12) {
  const logs = await AuditLogModel.find({}).sort({ createdAt: -1 }).limit(limit).lean();
  const actors = await UserModel.find({ _id: { $in: logs.map((l) => l.actorId).filter(Boolean) } }, { name: 1, role: 1 }).lean();
  const map = new Map(actors.map((a) => [a._id.toString(), { name: a.name ?? null, role: a.role }]));
  return logs.map((l) => auditLogDTO(l, map));
}

// ── Dashboard ────────────────────────────────────────────────────────────────

adminRouter.get("/admin/dashboard", async (_req, res) => {
  await ensureLookups();
  const settings = await getSettings();
  const today = kigaliDate();
  const t = kigaliDayRange(today);
  const [operators, pending, suspended, passengers, bookingsToday, todayPay, inTransit, capViolations, pendingPayouts, pendingOps] =
    await Promise.all([
      OperatorModel.countDocuments({}),
      OperatorModel.countDocuments({ status: "pending" }),
      OperatorModel.countDocuments({ status: "suspended" }),
      UserModel.countDocuments({ role: "passenger" }),
      BookingModel.countDocuments({ status: { $in: ["confirmed", "completed"] }, createdAt: { $gte: t.start, $lt: t.end } }),
      PaymentModel.aggregate<{ gross: number; commission: number }>([
        { $match: { status: "success", kind: "booking", paidAt: { $gte: t.start, $lt: t.end } } },
        { $group: { _id: null, gross: { $sum: "$amount" }, commission: { $sum: "$commissionAmount" } } },
      ]),
      ParcelModel.countDocuments({ status: "in_transit" }),
      RouteModel.countDocuments({ capStatus: "above_cap" }),
      PayoutModel.aggregate<{ total: number }>([{ $match: { status: "pending" } }, { $group: { _id: null, total: { $sum: "$net" } } }]),
      OperatorModel.find({ status: "pending" }).sort({ createdAt: 1 }).limit(5).lean(),
    ]);
  const first = addDays(today, -13);
  const rows = await BookingModel.aggregate<{ _id: string; n: number }>([
    { $match: { status: { $in: ["confirmed", "completed"] }, createdAt: { $gte: kigaliDayRange(first).start } } },
    { $group: { _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt", timezone: "Africa/Kigali" } }, n: { $sum: 1 } } },
  ]);
  const byDay = new Map(rows.map((r) => [r._id, r.n]));
  const files = await filesFor(pendingOps.flatMap((o) => o.documents.map((d) => d.fileId)));
  const dto: AdminDashboardDTO = {
    operators: { total: operators, pending, suspended },
    passengers,
    bookingsToday,
    revenueToday: todayPay[0]?.gross ?? 0,
    commissionToday: todayPay[0]?.commission ?? 0,
    parcelsInTransit: inTransit,
    capViolations,
    pendingPayouts: pendingPayouts[0]?.total ?? 0,
    series: Array.from({ length: 14 }, (_, i) => {
      const day = addDays(first, i);
      return { label: day, value: byDay.get(day) ?? 0 };
    }),
    recentActivity: await recentActivity(),
    pendingOperators: pendingOps.map((o) => operatorDTO(o, files, settings.commissionRate)),
  };
  res.json(dto);
});

adminRouter.get("/admin/audit-logs", async (req, res) => {
  const limit = Math.min(200, Number(req.query.limit) || 50);
  res.json(await recentActivity(limit));
});

// ── Operators ────────────────────────────────────────────────────────────────

adminRouter.get(
  "/admin/operators",
  validate({ query: z.object({ status: z.enum(["all", "pending", "approved", "suspended", "rejected"]).default("all") }) }),
  async (req, res) => {
    await ensureLookups();
    const { status } = query<{ status: string }>(req);
    const settings = await getSettings();
    const operators = await OperatorModel.find(qf(status === "all" ? {} : { status })).sort({ createdAt: -1 }).lean();
    const files = await filesFor(operators.flatMap((o) => o.documents.map((d) => d.fileId)));
    res.json(operators.map((o) => operatorDTO(o, files, settings.commissionRate)));
  },
);

adminRouter.get("/admin/operators/:id", async (req, res) => {
  await ensureLookups();
  const operator = await OperatorModel.findById(req.params.id).lean();
  if (!operator) throw notFound();
  const settings = await getSettings();
  const since = new Date(Date.now() - 30 * 24 * 3600_000);
  const { start, end } = kigaliDayRange(kigaliDate());
  const [routes, vehicles, tripsToday, bookings30d, revenue, staff] = await Promise.all([
    RouteModel.find({ operatorId: operator._id }).lean(),
    VehicleModel.find({ operatorId: operator._id }).lean(),
    TripModel.countDocuments({ operatorId: operator._id, departureAt: { $gte: start, $lt: end }, status: { $ne: "cancelled" } }),
    BookingModel.countDocuments({ operatorId: operator._id, status: { $in: ["confirmed", "completed"] }, createdAt: { $gte: since } }),
    PaymentModel.aggregate<{ total: number }>([
      { $match: { operatorId: operator._id, status: "success", paidAt: { $gte: since } } },
      { $group: { _id: null, total: { $sum: "$amount" } } },
    ]),
    UserModel.find({ operatorId: operator._id, role: "operator" }),
  ]);
  const files = await filesFor([
    ...operator.documents.map((d) => d.fileId),
    ...vehicles.flatMap((v) => v.documents.map((d) => d.fileId)),
  ]);
  const summary: OperatorSummaryDTO = {
    ...operatorDTO(operator, files, settings.commissionRate),
    stats: {
      routes: routes.length,
      vehicles: vehicles.length,
      tripsToday,
      bookings30d,
      revenue30d: revenue[0]?.total ?? 0,
      capViolations: routes.filter((r) => r.capStatus === "above_cap").length,
    },
  };
  const dto: AdminOperatorDetailDTO = {
    operator: summary,
    routes: routes.map((r) => routeDTO(r)),
    vehicles: vehicles.map((v) => vehicleDTO(v, files)),
    staff: await Promise.all(staff.map((u) => toUserDTO(u))),
  };
  res.json(dto);
});

async function setOperatorStatus(
  id: string,
  status: "approved" | "rejected" | "suspended",
  reason: string | null,
  req: Parameters<typeof actorOf>[0],
) {
  const operator = await OperatorModel.findById(id);
  if (!operator) throw notFound();
  const allowed: Record<string, string[]> = {
    approved: ["pending", "suspended", "rejected"],
    rejected: ["pending"],
    suspended: ["approved"],
  };
  if (!allowed[status].includes(operator.status)) throw conflict("INVALID_STATE");
  operator.status = status;
  operator.statusReason = reason;
  if (status === "approved") {
    operator.approvedAt = new Date();
    operator.approvedBy = req.user?._id ?? null;
  }
  await operator.save();
  invalidateLookups();
  await audit(actorOf(req), `operator.${status}`, "operator", operator._id, reason ?? operator.name, { operatorId: operator._id });

  const owner = await UserModel.findOne({ operatorId: operator._id, isOperatorOwner: true });
  if (status === "approved") {
    await generateTripsFromSchedules(14);
    if (owner) {
      await notify({
        userId: owner._id,
        type: "operator.approved",
        inApp: { title: "notifications.operatorApprovedTitle", body: "notifications.operatorApprovedSms" },
        sms: "notifications.operatorApprovedSms",
        vars: { operator: operator.name, link: `${config.webUrl}/operator` },
        transactional: true,
      });
    }
  } else if (status === "rejected" && owner) {
    await notify({
      userId: owner._id,
      type: "operator.rejected",
      sms: "notifications.operatorRejectedSms",
      vars: { operator: operator.name, reason: reason ?? "" },
      transactional: true,
    });
  }
  return operator;
}

const reasonSchema = z.object({ reason: z.string().trim().max(300).optional() });

adminRouter.post("/admin/operators/:id/approve", async (req, res) => {
  await setOperatorStatus(String(req.params.id), "approved", null, req);
  res.json({ ok: true });
});
adminRouter.post("/admin/operators/:id/reject", validate({ body: reasonSchema }), async (req, res) => {
  await setOperatorStatus(String(req.params.id), "rejected", body<{ reason?: string }>(req).reason ?? null, req);
  res.json({ ok: true });
});
adminRouter.post("/admin/operators/:id/suspend", validate({ body: reasonSchema }), async (req, res) => {
  await setOperatorStatus(String(req.params.id), "suspended", body<{ reason?: string }>(req).reason ?? null, req);
  res.json({ ok: true });
});
adminRouter.post("/admin/operators/:id/reactivate", async (req, res) => {
  await setOperatorStatus(String(req.params.id), "approved", null, req);
  res.json({ ok: true });
});

adminRouter.patch(
  "/admin/operators/:id",
  validate({ body: z.object({ commissionRate: z.number().min(0).max(100).nullable() }) }),
  async (req, res) => {
    const { commissionRate } = body<{ commissionRate: number | null }>(req);
    const operator = await OperatorModel.findById(req.params.id);
    if (!operator) throw notFound();
    operator.commissionRate = commissionRate == null ? null : commissionRate / 100;
    await operator.save();
    await audit(actorOf(req), "operator.commission", "operator", operator._id, String(commissionRate), { operatorId: operator._id });
    res.json({ ok: true });
  },
);

adminRouter.post("/admin/files/:fileId/verify", async (req, res) => {
  const raw = String(req.params.fileId);
  if (!objectId.safeParse(raw).success) throw notFound();
  const fileId = new Types.ObjectId(raw);
  const a = await OperatorModel.updateOne({ "documents.fileId": fileId }, { $set: { "documents.$.verified": true } });
  const b = await VehicleModel.updateOne({ "documents.fileId": fileId }, { $set: { "documents.$.verified": true } });
  if (a.matchedCount + b.matchedCount === 0) throw notFound();
  await audit(actorOf(req), "document.verify", "file", fileId, null);
  res.json({ ok: true });
});

// ── Routes oversight ─────────────────────────────────────────────────────────

adminRouter.get(
  "/admin/routes",
  validate({ query: z.object({ filter: z.enum(["all", "above_cap", "no_cap", "paused"]).default("all") }) }),
  async (req, res) => {
    await ensureLookups();
    const { filter } = query<{ filter: string }>(req);
    const q = filter === "paused" ? { status: "paused" } : filter === "all" ? {} : { capStatus: filter };
    const routes = await RouteModel.find(qf(q)).sort({ capStatus: 1, createdAt: -1 }).limit(1000).lean();
    res.json(routes.map((r) => routeDTO(r)));
  },
);

adminRouter.post("/admin/routes/:id/enforce-cap", async (req, res) => {
  const route = await RouteModel.findById(req.params.id);
  if (!route) throw notFound();
  if (route.capRwf == null) throw conflict("INVALID_STATE");
  route.priceRwf = route.capRwf;
  route.capStatus = "ok";
  if (route.pausedReason) {
    route.status = "active";
    route.pausedReason = null;
  }
  await route.save();
  await TripModel.updateMany(
    { routeId: route._id, departureAt: { $gt: new Date() }, status: "scheduled" },
    { $set: { priceRwf: route.priceRwf } },
  );
  await refreshRouteCap(route._id);
  await ensureLookups();
  const name = `${loc(route.originId).name} → ${loc(route.destinationId).name}`;
  await audit(actorOf(req), "route.enforce_cap", "route", route._id, name, { operatorId: route.operatorId });
  await notifyOperatorStaff(
    route.operatorId,
    "route.price_enforced",
    { title: "notifications.priceEnforcedTitle", body: "notifications.priceEnforcedBody" },
    { route: name, cap: formatRwf(route.capRwf ?? 0) },
  );
  res.json(routeDTO(route.toObject()));
});

adminRouter.post("/admin/routes/:id/pause", validate({ body: reasonSchema }), async (req, res) => {
  const route = await RouteModel.findById(req.params.id);
  if (!route) throw notFound();
  const reason = body<{ reason?: string }>(req).reason || "Fare cap compliance";
  route.status = "paused";
  route.pausedReason = reason;
  await route.save();
  await ensureLookups();
  const name = `${loc(route.originId).name} → ${loc(route.destinationId).name}`;
  await audit(actorOf(req), "route.pause", "route", route._id, `${name}: ${reason}`, { operatorId: route.operatorId });
  await notifyOperatorStaff(
    route.operatorId,
    "route.paused",
    { title: "notifications.routePausedTitle", body: "notifications.routePausedBody" },
    { route: name, reason },
  );
  res.json(routeDTO(route.toObject()));
});

adminRouter.post("/admin/routes/:id/resume", async (req, res) => {
  const route = await RouteModel.findById(req.params.id);
  if (!route) throw notFound();
  route.status = "active";
  route.pausedReason = null;
  await route.save();
  await generateTripsFromSchedules(14);
  await audit(actorOf(req), "route.resume", "route", route._id, null, { operatorId: route.operatorId });
  await ensureLookups();
  res.json(routeDTO(route.toObject()));
});

// ── Fare caps ────────────────────────────────────────────────────────────────

async function violations(): Promise<CapViolationDTO[]> {
  await ensureLookups();
  const routes = await RouteModel.find({ capStatus: "above_cap" }).lean();
  return routes.map((r) => ({
    routeId: r._id.toString(),
    operator: op(r.operatorId),
    origin: loc(r.originId),
    destination: loc(r.destinationId),
    priceRwf: r.priceRwf,
    capRwf: r.capRwf ?? 0,
    status: r.status as "active" | "paused",
  }));
}

adminRouter.get("/admin/fare-caps/violations", async (_req, res) => {
  res.json(await violations());
});

adminRouter.get(
  "/admin/fare-caps",
  validate({ query: z.object({ q: z.string().max(60).optional(), withRoutes: z.enum(["1", "0"]).default("1") }) }),
  async (req, res) => {
    await ensureLookups();
    const { q, withRoutes } = query<{ q?: string; withRoutes: "1" | "0" }>(req);
    const [caps, routes] = await Promise.all([FareCapModel.find({}).lean(), RouteModel.find({}, { originId: 1, destinationId: 1, operatorId: 1, capStatus: 1 }).lean()]);
    const key = (a: unknown, b: unknown) => [String(a), String(b)].sort().join("|");
    const operatorsByPair = new Map<string, Set<string>>();
    const violationsByPair = new Map<string, number>();
    for (const r of routes) {
      const k = key(r.originId, r.destinationId);
      if (!operatorsByPair.has(k)) operatorsByPair.set(k, new Set());
      operatorsByPair.get(k)!.add(r.operatorId.toString());
      if (r.capStatus === "above_cap") violationsByPair.set(k, (violationsByPair.get(k) ?? 0) + 1);
    }
    const needle = (q ?? "").trim().toLowerCase();
    const items: FareCapDTO[] = caps
      .map((c) => {
        const k = key(c.originId, c.destinationId);
        return {
          id: c._id.toString(),
          origin: loc(c.originId),
          destination: loc(c.destinationId),
          via: c.viaId ? loc(c.viaId) : null,
          capRwf: c.capRwf,
          distanceKm: c.distanceKm ?? null,
          effectiveFrom: (c.effectiveFrom ?? c.createdAt).toISOString(),
          source: c.source as FareCapDTO["source"],
          corridor: c.corridor ?? null,
          operators: operatorsByPair.get(k)?.size ?? 0,
          violations: violationsByPair.get(k) ?? 0,
        };
      })
      .filter((c) => (withRoutes === "1" && !needle ? c.operators > 0 : true))
      .filter((c) => !needle || `${c.origin.name} ${c.destination.name} ${c.via?.name ?? ""}`.toLowerCase().includes(needle))
      .sort((a, b) => b.violations - a.violations || b.operators - a.operators || a.origin.name.localeCompare(b.origin.name))
      .slice(0, 300);
    const dto: FareCapListDTO = { items, total: caps.length, violations: await violations() };
    res.json(dto);
  },
);

const capSchema = z.object({
  originId: objectId,
  destinationId: objectId,
  viaId: objectId.nullish(),
  capRwf: z.number().int().positive().max(200_000),
  distanceKm: z.number().positive().max(2000).nullish(),
  effectiveFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

adminRouter.post("/admin/fare-caps", validate({ body: capSchema }), async (req, res) => {
  const input = body<z.infer<typeof capSchema>>(req);
  if (input.originId === input.destinationId) throw badRequest("VALIDATION_ERROR", { field: "destinationId" });
  const cap = await FareCapModel.findOneAndUpdate(
    { originId: input.originId, destinationId: input.destinationId, viaId: input.viaId ?? null },
    {
      $set: {
        capRwf: input.capRwf,
        distanceKm: input.distanceKm ?? null,
        effectiveFrom: input.effectiveFrom ? new Date(`${input.effectiveFrom}T00:00:00+02:00`) : new Date(),
        source: "manual",
      },
    },
    { upsert: true, returnDocument: "after" },
  );
  await refreshCapsForPair(input.originId, input.destinationId);
  await audit(actorOf(req), "farecap.upsert", "fare_cap", cap?._id ?? null, `${input.capRwf} RWF`);
  res.status(201).json({ ok: true, id: cap?._id.toString() });
});

adminRouter.patch(
  "/admin/fare-caps/:id",
  validate({ body: capSchema.pick({ capRwf: true, distanceKm: true, effectiveFrom: true }).partial() }),
  async (req, res) => {
    const input = body<{ capRwf?: number; distanceKm?: number | null; effectiveFrom?: string }>(req);
    const cap = await FareCapModel.findById(req.params.id);
    if (!cap) throw notFound();
    if (input.capRwf !== undefined) cap.capRwf = input.capRwf;
    if (input.distanceKm !== undefined) cap.distanceKm = input.distanceKm ?? null;
    if (input.effectiveFrom) cap.effectiveFrom = new Date(`${input.effectiveFrom}T00:00:00+02:00`);
    cap.source = "manual";
    await cap.save();
    await refreshCapsForPair(cap.originId, cap.destinationId);
    await audit(actorOf(req), "farecap.update", "fare_cap", cap._id, `${cap.capRwf} RWF`);
    res.json({ ok: true });
  },
);

adminRouter.delete("/admin/fare-caps/:id", async (req, res) => {
  const cap = await FareCapModel.findByIdAndDelete(req.params.id);
  if (!cap) throw notFound();
  await refreshCapsForPair(cap.originId, cap.destinationId);
  await audit(actorOf(req), "farecap.delete", "fare_cap", cap._id, null);
  res.json({ ok: true });
});

adminRouter.post("/admin/fare-caps/import", upload.single("file"), async (req, res) => {
  const text = req.file ? req.file.buffer.toString("utf8") : typeof req.body?.csv === "string" ? req.body.csv : "";
  if (!text.trim()) throw badRequest("VALIDATION_ERROR", { field: "file" });
  const result = await importCapsCsv(text);
  await audit(actorOf(req), "farecap.import", "fare_cap", null, `${result.imported} caps`);
  res.json(result);
});

// ── Users ────────────────────────────────────────────────────────────────────

adminRouter.get(
  "/admin/users",
  validate({
    query: z.object({
      role: z.enum(["all", ...ROLES]).default("all"),
      q: z.string().max(80).optional(),
      page: z.coerce.number().int().min(1).default(1),
    }),
  }),
  async (req, res) => {
    const { role, q, page } = query<{ role: string; q?: string; page: number }>(req);
    const filter: Record<string, unknown> = role === "all" ? {} : { role };
    if (q?.trim()) {
      const re = new RegExp(q.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
      filter.$or = [{ name: re }, { phone: re }, { email: re }];
    }
    const pageSize = 25;
    const [users, total] = await Promise.all([
      UserModel.find(filter).sort({ createdAt: -1 }).skip((page - 1) * pageSize).limit(pageSize),
      UserModel.countDocuments(filter),
    ]);
    const counts = await BookingModel.aggregate<{ _id: Types.ObjectId; n: number }>([
      { $match: { userId: { $in: users.map((u) => u._id) } } },
      { $group: { _id: "$userId", n: { $sum: 1 } } },
    ]);
    const countMap = new Map(counts.map((c) => [c._id.toString(), c.n]));
    const items = await Promise.all(
      users.map(async (u) => ({ ...(await toUserDTO(u)), bookings: countMap.get(u._id.toString()) ?? 0 })),
    );
    res.json({ items, total, page, pageSize });
  },
);

const staffSchema = z.object({
  name: z.string().trim().min(2).max(120),
  phone: z.string().trim().max(20).optional().or(z.literal("")),
  email: z.string().trim().email().max(150).optional().or(z.literal("")),
  role: z.enum(["operator", "station", "admin"]),
  operatorId: objectId.optional(),
  stationId: objectId.optional(),
  language: z.enum(LOCALES).default("en"),
});

adminRouter.post("/admin/users", validate({ body: staffSchema }), async (req, res) => {
  const input = body<z.infer<typeof staffSchema>>(req);
  const phone = input.phone ? normalizeRwPhone(input.phone) : null;
  if (input.phone && !phone) throw badRequest("PHONE_INVALID", { field: "phone" });
  const email = input.email ? input.email.toLowerCase() : null;
  if (!phone && !email) throw badRequest("VALIDATION_ERROR", { field: "phone" });
  if (input.role === "operator" && !(input.operatorId && (await OperatorModel.exists({ _id: input.operatorId })))) {
    throw badRequest("VALIDATION_ERROR", { field: "operatorId" });
  }
  if (input.role === "station" && !(input.stationId && (await LocationModel.exists({ _id: input.stationId, isStation: true })))) {
    throw badRequest("VALIDATION_ERROR", { field: "stationId" });
  }
  const or: Record<string, string>[] = [];
  if (phone) or.push({ phone });
  if (email) or.push({ email });
  let user = await UserModel.findOne(qf({ $or: or }));
  if (user && user.role !== "passenger") throw conflict("DUPLICATE", { field: "phone" });
  const fields = {
    name: input.name,
    role: input.role,
    operatorId: input.role === "operator" ? new Types.ObjectId(input.operatorId) : null,
    stationId: input.role === "station" ? new Types.ObjectId(input.stationId) : null,
    isOperatorOwner: false,
  };
  if (user) {
    Object.assign(user, fields);
    if (!user.phone && phone) user.phone = phone;
    if (!user.email && email) user.email = email;
    await user.save();
  } else {
    user = await UserModel.create({ ...fields, phone, email, language: input.language, status: "invited" });
  }
  await ensureLookups();
  const org = input.role === "operator" ? op(input.operatorId).name : input.role === "station" ? loc(input.stationId).name : "FIKA";
  await notify({
    userId: user._id,
    type: "staff.invited",
    sms: "notifications.staffInvitedSms",
    vars: { org, role: input.role, link: `${config.webUrl}/auth/login` },
    transactional: true,
  });
  await audit(actorOf(req), "user.create", "user", user._id, `${input.name} (${input.role})`);
  res.status(201).json(await toUserDTO(user));
});

const userPatchSchema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  role: z.enum(ROLES).optional(),
  status: z.enum(USER_STATUSES).optional(),
  operatorId: objectId.nullish(),
  stationId: objectId.nullish(),
});

adminRouter.patch("/admin/users/:id", validate({ body: userPatchSchema }), async (req, res) => {
  const input = body<z.infer<typeof userPatchSchema>>(req);
  const user = await UserModel.findById(req.params.id);
  if (!user) throw notFound();
  if (user._id.equals(req.user!._id) && (input.role && input.role !== "admin" || input.status === "suspended")) {
    throw conflict("INVALID_STATE");
  }
  if (input.name) user.name = input.name;
  if (input.status) user.status = input.status;
  if (input.role) user.role = input.role;
  if (input.operatorId !== undefined) user.operatorId = input.operatorId ? new Types.ObjectId(input.operatorId) : null;
  if (input.stationId !== undefined) user.stationId = input.stationId ? new Types.ObjectId(input.stationId) : null;
  if (user.role !== "operator") {
    user.operatorId = null;
    user.isOperatorOwner = false;
  }
  if (user.role !== "station") user.stationId = null;
  if (user.role === "operator" && !user.operatorId) throw badRequest("VALIDATION_ERROR", { field: "operatorId" });
  if (user.role === "station" && !user.stationId) throw badRequest("VALIDATION_ERROR", { field: "stationId" });
  await user.save();
  await audit(actorOf(req), "user.update", "user", user._id, JSON.stringify(input));
  res.json(await toUserDTO(user));
});

// ── Revenue & payouts ────────────────────────────────────────────────────────

adminRouter.get(
  "/admin/revenue",
  validate({ query: z.object({ period: z.enum(["week", "month", "year"]).default("month") }) }),
  async (req, res) => {
    await ensureLookups();
    const { period } = query<{ period: "week" | "month" | "year" }>(req);
    const settings = await getSettings();
    const days = period === "week" ? 7 : period === "month" ? 30 : 365;
    const now = Date.now();
    const curStart = new Date(now - days * 24 * 3600_000);
    const prevStart = new Date(now - 2 * days * 24 * 3600_000);
    const sums = async (from: Date, to: Date) => {
      const [row] = await PaymentModel.aggregate<{ gross: number; commission: number; parcels: number }>([
        { $match: { status: "success", paidAt: { $gte: from, $lt: to } } },
        {
          $group: {
            _id: null,
            gross: { $sum: { $cond: [{ $eq: ["$kind", "booking"] }, "$amount", 0] } },
            commission: { $sum: "$commissionAmount" },
            parcels: { $sum: { $cond: [{ $eq: ["$kind", "parcel"] }, "$amount", 0] } },
          },
        },
      ]);
      return row ?? { gross: 0, commission: 0, parcels: 0 };
    };
    const [cur, prev] = await Promise.all([sums(curStart, new Date(now)), sums(prevStart, curStart)]);
    const byOperator = await PaymentModel.aggregate<{ _id: Types.ObjectId; commission: number; gross: number }>([
      { $match: { status: "success", paidAt: { $gte: curStart } } },
      { $group: { _id: "$operatorId", commission: { $sum: "$commissionAmount" }, gross: { $sum: "$amount" } } },
      { $sort: { commission: -1 } },
      { $limit: 8 },
    ]);
    const pending = await PayoutModel.find({ status: { $in: ["pending", "failed"] } }).sort({ dueDate: 1 }).limit(50).lean();
    const weekEnd = now + 7 * 24 * 3600_000;
    const dto: AdminRevenueDTO = {
      period,
      gross: cur.gross,
      grossChange: percentChange(cur.gross, prev.gross),
      commission: cur.commission,
      commissionChange: percentChange(cur.commission, prev.commission),
      commissionRate: settings.commissionRate,
      parcelRevenue: cur.parcels,
      parcelChange: percentChange(cur.parcels, prev.parcels),
      pendingPayouts: pending.filter((p) => p.status === "pending").reduce((s, p) => s + Math.max(0, p.net), 0),
      operatorsDueThisWeek: new Set(
        pending.filter((p) => p.status === "pending" && p.dueDate.getTime() <= weekEnd).map((p) => p.operatorId.toString()),
      ).size,
      series: await revenueSeries({}, period),
      byOperator: byOperator.map((r) => ({ operator: op(r._id), commission: r.commission, gross: r.gross })),
      upcomingPayouts: pending.map(payoutDTO),
    };
    res.json(dto);
  },
);

adminRouter.get(
  "/admin/payouts",
  validate({ query: z.object({ status: z.enum(["all", "pending", "processing", "paid", "failed"]).default("all") }) }),
  async (req, res) => {
    await ensureLookups();
    const { status } = query<{ status: string }>(req);
    const payouts = await PayoutModel.find(qf(status === "all" ? {} : { status })).sort({ createdAt: -1 }).limit(200).lean();
    res.json(payouts.map(payoutDTO));
  },
);

adminRouter.post("/admin/payouts/generate", async (req, res) => {
  const created = await generatePayouts({ force: true });
  await audit(actorOf(req), "payout.generate", "payout", null, `${created} prepared`);
  res.json({ created });
});

adminRouter.post("/admin/payouts/process-all", async (req, res) => {
  res.json({ processed: await processAllPayouts(actorOf(req)) });
});

adminRouter.post("/admin/payouts/:id/process", async (req, res) => {
  await ensureLookups();
  const payout = await processPayout(String(req.params.id), actorOf(req));
  res.json(payoutDTO(payout.toObject()));
});

// ── Reports ──────────────────────────────────────────────────────────────────

adminRouter.get(
  "/admin/reports/:type",
  validate({
    query: z.object({
      from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    }),
  }),
  async (req, res) => {
    const type = String(req.params.type).replace(/\.csv$/, "") as ReportType;
    if (!REPORT_TYPES.includes(type)) throw notFound();
    const range = query<{ from?: string; to?: string }>(req);
    const csv = await buildReport(type, range);
    await audit(actorOf(req), "report.export", "report", null, type);
    sendCsv(res, `fika-${type}-${range.from ?? "all"}-${range.to ?? kigaliDate()}.csv`, csv);
  },
);

// ── Settings & locations ─────────────────────────────────────────────────────

adminRouter.get("/admin/settings", async (_req, res) => {
  res.json(await getSettings());
});

const settingsSchema = z
  .object({
    commissionRate: z.number().min(0).max(0.5),
    holdMinutes: z.number().int().min(3).max(60),
    parcelHoldMinutes: z.number().int().min(5).max(240),
    fareCapEnforcement: z.enum(FARE_CAP_ENFORCEMENT),
    defaultCancellationHours: z.number().int().min(0).max(72),
    reminderMinutesBeforeDeparture: z.number().int().min(10).max(24 * 60),
    payoutCycleDays: z.number().int().min(1).max(31),
    channels: z.object({ sms: z.boolean(), email: z.boolean(), inApp: z.boolean() }),
    supportPhone: z.string().trim().max(30),
    supportEmail: z.string().trim().email().max(150),
  })
  .partial();

adminRouter.patch("/admin/settings", validate({ body: settingsSchema }), async (req, res) => {
  const input = body<z.infer<typeof settingsSchema>>(req);
  const next = await updateSettings(input, req.user?._id);
  await audit(actorOf(req), "settings.update", "settings", null, Object.keys(input).join(", "));
  res.json(next);
});

adminRouter.get("/admin/locations", async (_req, res) => {
  const locations = await LocationModel.find({}).sort({ isStation: -1, name: 1 }).lean();
  res.json(
    locations.map((l) => ({
      id: l._id.toString(),
      slug: l.slug,
      name: l.name,
      isStation: l.isStation,
      district: l.district ?? null,
      province: l.province ?? null,
      aliases: l.aliases ?? [],
      active: l.active,
    })),
  );
});

const locationSchema = z.object({
  name: z.string().trim().min(2).max(120),
  isStation: z.boolean().default(false),
  aliases: z.array(z.string().trim().max(60)).max(10).optional(),
  district: z.string().trim().max(80).nullish(),
  province: z.string().trim().max(80).nullish(),
});

adminRouter.post("/admin/locations", validate({ body: locationSchema }), async (req, res) => {
  const input = body<z.infer<typeof locationSchema>>(req);
  const created = await createLocation(input);
  await audit(actorOf(req), "location.create", "location", created._id, created.name);
  res.status(201).json({ id: created._id.toString() });
});

adminRouter.patch(
  "/admin/locations/:id",
  validate({ body: locationSchema.partial().extend({ active: z.boolean().optional() }) }),
  async (req, res) => {
    const input = body<Partial<z.infer<typeof locationSchema>> & { active?: boolean }>(req);
    const location = await LocationModel.findById(req.params.id);
    if (!location) throw notFound();
    if (input.name) location.name = input.name;
    if (input.isStation !== undefined) location.isStation = input.isStation;
    if (input.active !== undefined) location.active = input.active;
    if (input.aliases) location.aliases = input.aliases.map((a) => a.toUpperCase());
    if (input.district !== undefined) location.district = input.district ?? null;
    if (input.province !== undefined) location.province = input.province ?? null;
    await location.save();
    invalidateLookups();
    await audit(actorOf(req), "location.update", "location", location._id, location.name);
    res.json({ ok: true });
  },
);
