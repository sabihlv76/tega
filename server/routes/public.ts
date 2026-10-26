import { Router } from "express";
import multer from "multer";
import mongoose from "mongoose";
import { z } from "zod";
import { BRAND_NAME, LOCALES, MAX_PLACES_PER_BOOKING } from "../../shared/constants";
import { normalizeRwPhone } from "../../shared/money";
import { kigaliDate } from "../../shared/time";
import type { PublicConfigDTO } from "../../shared/types";
import { config } from "../config";
import { slugify } from "../lib/crypto";
import { ApiError, badRequest, conflict } from "../lib/errors";
import { body, query, rateLimit, validate } from "../middleware";
import { FileModel, LocationModel, OperatorModel, UserModel } from "../models";
import { findCap } from "../services/fares";
import { allLocations, ensureLookups, findLocation, invalidateLookups, locOrNull } from "../services/lookup";
import { notifyAdmins } from "../services/notify";
import { findParcelByCode, quoteParcel, toParcelDTO } from "../services/parcels";
import { getSettings } from "../services/settings";
import { objectKey, putObject } from "../services/storage";
import { boardFor, getTripDTO, popularRoutes, searchTrips } from "../services/trips";

export const publicRouter = Router();

const ALLOWED_TYPES = ["application/pdf", "image/jpeg", "image/png", "image/webp"];
export const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 3 },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_TYPES.includes(file.mimetype)) cb(null, true);
    else cb(new ApiError(400, "FILE_TYPE"));
  },
});

publicRouter.get("/health", async (_req, res) => {
  const dbUp = mongoose.connection.readyState === 1;
  res.status(dbUp ? 200 : 503).json({ ok: dbUp, db: dbUp ? "up" : "down", time: new Date().toISOString() });
});

publicRouter.get("/config", async (_req, res) => {
  const settings = await getSettings();
  const dto: PublicConfigDTO = {
    brand: BRAND_NAME,
    googleEnabled: config.google.enabled,
    emailOtpEnabled: settings.channels.email,
    payments: { mtn: config.payments.mtn.mode, airtel: config.payments.airtel.mode, cash: true },
    locales: [...LOCALES],
    supportPhone: settings.supportPhone,
    supportEmail: settings.supportEmail,
    maxPlacesPerBooking: MAX_PLACES_PER_BOOKING,
    fareCapEnforcement: settings.fareCapEnforcement,
  };
  res.json(dto);
});

publicRouter.get(
  "/locations",
  validate({ query: z.object({ q: z.string().max(60).optional(), stations: z.enum(["1", "0"]).optional() }) }),
  async (req, res) => {
    const { q, stations } = query<{ q?: string; stations?: "1" | "0" }>(req);
    await ensureLookups();
    const needle = (q ?? "").trim().toLowerCase();
    const items = allLocations()
      .filter((l) => l.active && (stations !== "1" || l.isStation))
      .filter(
        (l) =>
          !needle ||
          l.name.toLowerCase().includes(needle) ||
          l.slug.includes(needle) ||
          l.aliases.some((a) => a.toLowerCase().includes(needle)),
      )
      .sort((a, b) => Number(b.isStation) - Number(a.isStation) || a.name.localeCompare(b.name));
    res.json(items.slice(0, needle ? 30 : 500));
  },
);

publicRouter.get("/routes/popular", async (_req, res) => {
  res.json(await popularRoutes(6));
});

const searchSchema = z.object({
  from: z.string().min(1).max(80),
  to: z.string().min(1).max(80),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

publicRouter.get("/trips/search", rateLimit({ name: "search", windowMs: 60_000, max: 120 }), validate({ query: searchSchema }), async (req, res) => {
  const q = query<z.infer<typeof searchSchema>>(req);
  res.json(await searchTrips(q.from, q.to, q.date ?? kigaliDate()));
});

publicRouter.get("/trips/:id", async (req, res) => {
  res.json(await getTripDTO(String(req.params.id)));
});

publicRouter.get("/board/:station", async (req, res) => {
  const date = typeof req.query.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(req.query.date) ? req.query.date : kigaliDate();
  res.json(await boardFor(String(req.params.station), date));
});

const quoteSchema = z.object({
  from: z.string().min(1).max(80),
  to: z.string().min(1).max(80),
  weightKg: z.coerce.number().positive().max(100).default(1),
});

publicRouter.get("/parcels/quote", validate({ query: quoteSchema }), async (req, res) => {
  const q = query<z.infer<typeof quoteSchema>>(req);
  res.json(await quoteParcel(q.from, q.to, q.weightKg));
});

publicRouter.get("/parcels/track/:code", rateLimit({ name: "track", windowMs: 60_000, max: 60 }), async (req, res) => {
  const parcel = await findParcelByCode(String(req.params.code));
  res.json(await toParcelDTO(parcel, false));
});

// ── Operator applications (public, with RURA licence upload) ─────────────────

const applySchema = z.object({
  companyName: z.string().trim().min(2).max(150),
  registrationNumber: z.string().trim().min(3).max(50),
  contactName: z.string().trim().min(2).max(120),
  contactPhone: z.string().trim().min(9).max(20),
  contactEmail: z.string().trim().email().max(150).optional().or(z.literal("")),
  headquarters: z.string().trim().max(80).optional(),
});

publicRouter.post(
  "/operators/apply",
  rateLimit({ name: "apply", windowMs: 60 * 60_000, max: 5 }),
  upload.single("licence"),
  validate({ body: applySchema }),
  async (req, res) => {
    const input = body<z.infer<typeof applySchema>>(req);
    const phone = normalizeRwPhone(input.contactPhone);
    if (!phone) throw badRequest("PHONE_INVALID", { field: "contactPhone" });
    if (await OperatorModel.exists({ registrationNumber: input.registrationNumber.toUpperCase() })) {
      throw conflict("DUPLICATE", { field: "registrationNumber" });
    }
    const existingUser = await UserModel.findOne({ phone });
    if (existingUser && existingUser.role !== "passenger") throw conflict("DUPLICATE", { field: "contactPhone" });

    const hq = input.headquarters ? await findLocation(input.headquarters) : null;
    let slug = slugify(input.companyName) || "operator";
    if (await OperatorModel.exists({ slug })) slug = `${slug}-${Date.now().toString(36).slice(-4)}`;
    const operator = await OperatorModel.create({
      name: input.companyName,
      slug,
      registrationNumber: input.registrationNumber,
      contactPhone: phone,
      contactEmail: input.contactEmail || null,
      headquartersId: hq ? hq.id : null,
      status: "pending",
    });
    if (req.file) {
      const key = objectKey("rura_licence", req.file.originalname);
      const stored = await putObject(key, req.file.buffer, req.file.mimetype);
      const file = await FileModel.create({
        operatorId: operator._id,
        purpose: "rura_licence",
        driver: stored.driver,
        key: stored.key,
        filename: req.file.originalname.slice(0, 120),
        contentType: req.file.mimetype,
        size: req.file.size,
      });
      operator.documents.push({ type: "rura_licence", fileId: file._id, verified: false, uploadedAt: new Date() });
      await operator.save();
    }
    if (existingUser) {
      existingUser.role = "operator";
      existingUser.operatorId = operator._id;
      existingUser.isOperatorOwner = true;
      if (!existingUser.name) existingUser.name = input.contactName;
      await existingUser.save();
    } else {
      await UserModel.create({
        name: input.contactName,
        phone,
        email: input.contactEmail || null,
        role: "operator",
        operatorId: operator._id,
        isOperatorOwner: true,
        language: req.locale,
      });
    }
    invalidateLookups();
    await notifyAdmins(
      "operator.applied",
      { title: "notifications.newOperatorTitle", body: "notifications.newOperatorBody" },
      { operator: operator.name },
      { operatorId: operator._id.toString() },
    );
    res.status(201).json({ ok: true, operatorId: operator._id.toString() });
  },
);

// RURA cap for a pair of locations (used live in the operator route editor). Caps are public data.
const capQuery = z.object({
  origin: z.string().regex(/^[a-f0-9]{24}$/i),
  destination: z.string().regex(/^[a-f0-9]{24}$/i),
  via: z.string().optional(),
});

publicRouter.get("/fares/cap", validate({ query: capQuery }), async (req, res) => {
  const q = query<z.infer<typeof capQuery>>(req);
  const via = (q.via ?? "").split(",").filter((v) => /^[a-f0-9]{24}$/i.test(v));
  const cap = await findCap(q.origin, q.destination, via);
  await ensureLookups();
  res.json({ capRwf: cap?.capRwf ?? null, via: cap?.viaId ? locOrNull(cap.viaId) : null, source: cap?.source ?? null });
});

// Station list for the public departure-board picker.
publicRouter.get("/stations", async (_req, res) => {
  await ensureLookups();
  res.json(allLocations().filter((l) => l.isStation && l.active));
});

// Used by admins (settings) through the admin router; exported for reuse.
export async function createLocation(input: { name: string; isStation: boolean; aliases?: string[]; district?: string | null; province?: string | null }) {
  let slug = slugify(input.name);
  if (await LocationModel.exists({ slug })) slug = `${slug}-${Date.now().toString(36).slice(-4)}`;
  const created = await LocationModel.create({
    name: input.name.trim(),
    slug,
    isStation: input.isStation,
    aliases: (input.aliases ?? []).map((a) => a.trim().toUpperCase()).filter(Boolean),
    district: input.district ?? null,
    province: input.province ?? null,
  });
  invalidateLookups();
  return created;
}
