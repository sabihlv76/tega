import { Router } from "express";
import { z } from "zod";
import { LOCALES, MAX_PLACES_PER_BOOKING, PARCEL_SIZES, PAYMENT_METHODS } from "../../shared/constants";
import { conflict, notFound } from "../lib/errors";
import { body, query, rateLimit, requireAuth, validate } from "../middleware";
import { NotificationModel, OtpModel, UserModel } from "../models";
import { normalizeTarget, requestOtp } from "../services/auth";
import { cancelBooking, createBooking, findUserBooking, listUserBookings, toBookingDTO } from "../services/bookings";
import { createParcel, findParcelByCode, listUserParcels, toParcelDTO } from "../services/parcels";
import { getPaymentForUser, initiatePayment, latestPaymentFor } from "../services/payments/service";
import { notificationDTO } from "../services/serializers";
import { hashSecret, safeEqual } from "../lib/crypto";
import { badRequest } from "../lib/errors";
import { requireUser, toUserDTO } from "./helpers";

// Endpoints for any signed-in user (passengers, and staff when they travel or send parcels).

export const meRouter = Router();
// Guards are scoped to this router's paths because every router is mounted on /api/v1.
meRouter.use(["/me", "/bookings", "/payments", "/parcels"], requireAuth);

meRouter.get("/me", async (req, res) => {
  res.json(await toUserDTO(requireUser(req)));
});

const profileSchema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  language: z.enum(LOCALES).optional(),
  notificationPrefs: z.object({ sms: z.boolean(), email: z.boolean(), inApp: z.boolean() }).partial().optional(),
});

meRouter.patch("/me", validate({ body: profileSchema }), async (req, res) => {
  const user = requireUser(req);
  const input = body<z.infer<typeof profileSchema>>(req);
  if (input.name !== undefined) user.name = input.name;
  if (input.language) user.language = input.language;
  if (input.notificationPrefs) {
    user.notificationPrefs = { ...user.notificationPrefs, ...input.notificationPrefs } as typeof user.notificationPrefs;
  }
  await user.save();
  res.json(await toUserDTO(user));
});

// Changing phone or email requires proving ownership of the new contact with a code.
const contactSchema = z.object({ channel: z.enum(["sms", "email"]), value: z.string().trim().min(3).max(200) });

meRouter.post(
  "/me/contact/request",
  rateLimit({ name: "contact", windowMs: 15 * 60_000, max: 10 }),
  validate({ body: contactSchema }),
  async (req, res) => {
    const input = body<z.infer<typeof contactSchema>>(req);
    const target = normalizeTarget(input.channel, input.value);
    const taken = await UserModel.exists(input.channel === "sms" ? { phone: target } : { email: target });
    if (taken) throw conflict("DUPLICATE", { field: input.channel === "sms" ? "phone" : "email" });
    res.json(await requestOtp(input.channel, target, req.locale));
  },
);

meRouter.post(
  "/me/contact/verify",
  validate({ body: contactSchema.extend({ code: z.string().trim().length(6) }) }),
  async (req, res) => {
    const user = requireUser(req);
    const input = body<z.infer<typeof contactSchema> & { code: string }>(req);
    const target = normalizeTarget(input.channel, input.value);
    const otp = await OtpModel.findOne({ target, consumedAt: null }).sort({ createdAt: -1 });
    if (!otp || otp.expiresAt.getTime() < Date.now()) throw badRequest("OTP_EXPIRED");
    if (otp.attempts >= 5) throw badRequest("OTP_TOO_MANY_ATTEMPTS");
    if (!safeEqual(hashSecret(input.code, target), otp.codeHash)) {
      otp.attempts += 1;
      await otp.save();
      throw badRequest("OTP_INVALID");
    }
    otp.consumedAt = new Date();
    await otp.save();
    if (input.channel === "sms") user.phone = target;
    else user.email = target;
    await user.save();
    res.json(await toUserDTO(user));
  },
);

// ── Notifications ────────────────────────────────────────────────────────────

meRouter.get("/me/notifications", async (req, res) => {
  const user = requireUser(req);
  const items = await NotificationModel.find({ userId: user._id }).sort({ createdAt: -1 }).limit(100).lean();
  res.json(items.map(notificationDTO));
});

meRouter.post("/me/notifications/read", validate({ body: z.object({ ids: z.array(z.string()).max(200).optional() }) }), async (req, res) => {
  const user = requireUser(req);
  const { ids } = body<{ ids?: string[] }>(req);
  await NotificationModel.updateMany(
    { userId: user._id, readAt: null, ...(ids?.length ? { _id: { $in: ids } } : {}) },
    { $set: { readAt: new Date() } },
  );
  res.json({ ok: true });
});

// ── Bookings & tickets ───────────────────────────────────────────────────────

const bookingSchema = z.object({
  tripId: z.string().length(24),
  places: z.number().int().min(1).max(MAX_PLACES_PER_BOOKING),
  traveler: z.object({
    name: z.string().trim().min(2).max(120),
    phone: z.string().trim().min(9).max(20),
    email: z.string().trim().email().max(150).nullish().or(z.literal("")),
  }),
});

meRouter.post("/bookings", rateLimit({ name: "booking", windowMs: 60_000, max: 20 }), validate({ body: bookingSchema }), async (req, res) => {
  const input = body<z.infer<typeof bookingSchema>>(req);
  const user = requireUser(req);
  if (!user.name) {
    user.name = input.traveler.name;
    await user.save();
  }
  res.status(201).json(await createBooking(user, { ...input, traveler: { ...input.traveler, email: input.traveler.email || null } }, req.locale));
});

meRouter.get(
  "/bookings",
  validate({ query: z.object({ scope: z.enum(["upcoming", "past", "cancelled"]).default("upcoming") }) }),
  async (req, res) => {
    const { scope } = query<{ scope: "upcoming" | "past" | "cancelled" }>(req);
    res.json(await listUserBookings(requireUser(req)._id, scope));
  },
);

meRouter.get("/bookings/:id", async (req, res) => {
  const booking = await findUserBooking(requireUser(req)._id, String(req.params.id));
  res.json({ booking: await toBookingDTO(booking), payment: await latestPaymentFor("booking", booking._id) });
});

meRouter.post("/bookings/:id/cancel", async (req, res) => {
  const user = requireUser(req);
  const booking = await findUserBooking(user._id, String(req.params.id));
  await cancelBooking(booking, { by: "passenger", reason: "Cancelled by passenger" });
  res.json(await toBookingDTO(booking));
});

// ── Payments ─────────────────────────────────────────────────────────────────

const paymentSchema = z.object({
  kind: z.enum(["booking", "parcel"]),
  id: z.string().length(24),
  method: z.enum(PAYMENT_METHODS),
  phone: z.string().trim().max(20).optional(),
});

meRouter.post("/payments", rateLimit({ name: "payment", windowMs: 60_000, max: 10 }), validate({ body: paymentSchema }), async (req, res) => {
  const input = body<z.infer<typeof paymentSchema>>(req);
  res.status(201).json(await initiatePayment(requireUser(req)._id, input));
});

meRouter.get("/payments/:id", async (req, res) => {
  res.json(await getPaymentForUser(String(req.params.id), requireUser(req)._id));
});

// ── Parcels ──────────────────────────────────────────────────────────────────

const parcelSchema = z.object({
  from: z.string().min(1).max(80),
  to: z.string().min(1).max(80),
  operatorId: z.string().length(24),
  description: z.string().trim().min(2).max(200),
  weightKg: z.number().positive().max(100),
  size: z.enum(PARCEL_SIZES),
  receiver: z.object({ name: z.string().trim().min(2).max(120), phone: z.string().trim().min(9).max(20) }),
  sender: z.object({ name: z.string().trim().max(120).optional(), phone: z.string().trim().max(20).optional() }).optional(),
});

meRouter.post("/parcels", rateLimit({ name: "parcel", windowMs: 60_000, max: 10 }), validate({ body: parcelSchema }), async (req, res) => {
  const input = body<z.infer<typeof parcelSchema>>(req);
  res.status(201).json(await createParcel(requireUser(req), input, req.locale));
});

meRouter.get("/parcels", async (req, res) => {
  res.json(await listUserParcels(requireUser(req)._id));
});

meRouter.get("/parcels/:code", async (req, res) => {
  const user = requireUser(req);
  const parcel = await findParcelByCode(String(req.params.code));
  if (parcel.senderId.toString() !== user._id.toString()) throw notFound();
  res.json({ parcel: await toParcelDTO(parcel, true), payment: await latestPaymentFor("parcel", parcel._id) });
});
