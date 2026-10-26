import { Types } from "mongoose";
import { commissionOf, parcelPrice } from "../../shared/money";
import { addDays, kigaliDate, kigaliDateTime } from "../../shared/time";
import { config } from "../config";
import { bookingReference, encrypt, hashSecret, parcelCode, randomCode } from "../lib/crypto";
import { logger } from "../lib/logger";
import {
  AuditLogModel,
  BookingModel,
  LocationModel,
  NotificationModel,
  OperatorModel,
  ParcelModel,
  PaymentModel,
  PayoutModel,
  type RouteDoc,
  RouteModel,
  ScheduleModel,
  TripModel,
  UserModel,
  VehicleModel,
} from "../models";
import { capForRoute } from "../services/fares";
import { ensureLookups, invalidateLookups } from "../services/lookup";
import { generatePayouts } from "../services/payouts";
import { generateTripsFromSchedules } from "../services/trips";
import { importRuraRegistry } from "./rura";

// Demo dataset: four approved operators and one pending application, real RURA fare caps, a few
// weeks of trip history (for revenue dashboards), live trips around "now", parcels in every state
// and one account per role. Deterministic (seeded PRNG) so screenshots and tests are reproducible.

const MIN = 60_000;
const DAY = 24 * 60 * MIN;

function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const FIRST = ["Jean", "Aline", "Eric", "Diane", "Patrick", "Claudine", "Emmanuel", "Grace", "Olivier", "Josiane", "Fabrice", "Solange", "Innocent", "Vestine", "Thierry", "Chantal", "Jean Paul", "Clarisse", "Yves", "Sandrine", "Didier", "Esther", "Gilbert", "Liliane", "Kevin", "Nadine"];
const LAST = ["Habimana", "Uwase", "Niyonzima", "Mukamana", "Nshimiyimana", "Uwimana", "Hakizimana", "Ingabire", "Mugisha", "Iradukunda", "Ndayisaba", "Umutoni", "Bizimana", "Nyiransabimana", "Twagirayezu", "Uwera", "Kamanzi", "Murenzi", "Gatete", "Mutesi"];

interface RouteSpec {
  from: string;
  to: string;
  via?: string[];
  km: number;
  minutes: number;
  price: number;
  times: string[];
  vehicles: number[];
}

interface OperatorSpec {
  name: string;
  slug: string;
  reg: string;
  hq: string;
  status: "approved" | "pending";
  parcels: { enabled: boolean; perKg: number; minimum: number };
  bank: { bankName: string; accountName: string; accountNumber: string } | null;
  owner: { name: string; phone: string; email: string };
  vehicles: { plate: string; model: string; capacity: number }[];
  routes: RouteSpec[];
}

const OPERATORS: OperatorSpec[] = [
  {
    name: "Volcano Express",
    slug: "volcano-express",
    reg: "RURA-PT-0142",
    hq: "kigali",
    status: "approved",
    parcels: { enabled: true, perKg: 1000, minimum: 1000 },
    bank: { bankName: "Bank of Kigali", accountName: "Volcano Express Ltd", accountNumber: "000400012344821" },
    owner: { name: "Eric Habimana", phone: "+250788000010", email: "ops@volcano-express.rw" },
    vehicles: [
      { plate: "RAC204B", model: "Toyota Coaster 2021", capacity: 30 },
      { plate: "RAC305D", model: "Yutong ZK6122", capacity: 50 },
      { plate: "RAD118C", model: "Toyota Coaster 2019", capacity: 30 },
      { plate: "RAE207K", model: "Higer KLQ6129", capacity: 45 },
    ],
    routes: [
      { from: "kigali", to: "musanze", km: 93, minutes: 150, price: 3500, times: ["06:30", "09:00", "12:00", "15:30", "18:00"], vehicles: [0, 2] },
      { from: "musanze", to: "kigali", km: 93, minutes: 150, price: 3500, times: ["07:00", "10:30", "14:00", "17:00"], vehicles: [2, 0] },
      { from: "kigali", to: "rubavu", km: 157, minutes: 210, price: 6800, times: ["07:30", "13:30"], vehicles: [1] },
      { from: "kigali", to: "huye", km: 133, minutes: 165, price: 5000, times: ["11:00"], vehicles: [3] },
    ],
  },
  {
    name: "Horizon Lines",
    slug: "horizon-lines",
    reg: "RURA-PT-0217",
    hq: "kigali",
    status: "approved",
    parcels: { enabled: true, perKg: 800, minimum: 1000 },
    bank: { bankName: "Equity Bank Rwanda", accountName: "Horizon Lines Ltd", accountNumber: "4002200193071" },
    owner: { name: "Claudine Uwimana", phone: "+250788000020", email: "ops@horizon-lines.rw" },
    vehicles: [
      { plate: "RAB118F", model: "Yutong ZK6122", capacity: 45 },
      { plate: "RAD412C", model: "Toyota Coaster 2022", capacity: 30 },
      { plate: "RAE220A", model: "Toyota Hiace", capacity: 18 },
      { plate: "RAC771H", model: "Higer KLQ6129", capacity: 45 },
    ],
    routes: [
      { from: "kigali", to: "huye", km: 133, minutes: 165, price: 5000, times: ["07:00", "10:00", "13:00", "16:00"], vehicles: [0, 3] },
      { from: "huye", to: "kigali", km: 133, minutes: 165, price: 5000, times: ["06:30", "11:30", "15:00"], vehicles: [3, 0] },
      { from: "kigali", to: "karongi", km: 135, minutes: 210, price: 5500, times: ["10:00"], vehicles: [1] },
      { from: "kigali", to: "muhanga", km: 50, minutes: 75, price: 2000, times: ["06:00", "08:00", "10:00", "12:00", "14:00", "16:00", "18:00"], vehicles: [2] },
    ],
  },
  {
    name: "Ritco Express",
    slug: "ritco-express",
    reg: "RURA-PT-0031",
    hq: "kigali",
    status: "approved",
    parcels: { enabled: false, perKg: 1000, minimum: 1000 },
    bank: { bankName: "I&M Bank Rwanda", accountName: "Ritco Ltd", accountNumber: "20030561203056" },
    owner: { name: "Patrick Niyonzima", phone: "+250788000030", email: "ops@ritco.rw" },
    vehicles: [
      { plate: "RAF781G", model: "Scania Touring", capacity: 52 },
      { plate: "RAB209D", model: "Yutong ZK6122", capacity: 45 },
      { plate: "RAH447K", model: "Toyota Coaster 2020", capacity: 30 },
    ],
    routes: [
      { from: "kigali", to: "rusizi", via: ["huye"], km: 293, minutes: 360, price: 11000, times: ["05:30"], vehicles: [0] },
      { from: "kigali", to: "nyagatare", km: 160, minutes: 180, price: 6500, times: ["08:30", "14:30"], vehicles: [1] },
      { from: "kigali", to: "rwamagana", km: 55, minutes: 60, price: 2400, times: ["07:00", "09:00", "11:00", "13:00", "15:00", "17:00"], vehicles: [2] },
    ],
  },
  {
    name: "Virunga Express",
    slug: "virunga-express",
    reg: "RURA-PT-0388",
    hq: "musanze",
    status: "approved",
    parcels: { enabled: true, perKg: 900, minimum: 800 },
    bank: { bankName: "MTN MoMo Merchant", accountName: "Virunga Express", accountNumber: "0788000040" },
    owner: { name: "Grace Mukamana", phone: "+250788000040", email: "ops@virunga-express.rw" },
    vehicles: [
      { plate: "RAD903H", model: "Toyota Coaster 2021", capacity: 30 },
      { plate: "RAE502C", model: "Yutong ZK6107", capacity: 40 },
      { plate: "RAG503D", model: "Toyota Hiace", capacity: 18 },
    ],
    routes: [
      { from: "kigali", to: "nyanza", km: 88, minutes: 120, price: 3600, times: ["10:30", "17:00"], vehicles: [0] },
      { from: "kigali", to: "musanze", km: 93, minutes: 150, price: 3700, times: ["08:00", "16:30"], vehicles: [1] },
      { from: "kigali", to: "kayonza", km: 75, minutes: 90, price: 3100, times: ["09:00", "15:00"], vehicles: [2] },
    ],
  },
  {
    name: "Kigali Coach Ltd",
    slug: "kigali-coach",
    reg: "RURA-PT-0455",
    hq: "kigali",
    status: "pending",
    parcels: { enabled: true, perKg: 900, minimum: 1000 },
    bank: null,
    owner: { name: "Didier Bizimana", phone: "+250788000050", email: "hello@kigalicoach.rw" },
    vehicles: [{ plate: "RAH120B", model: "Toyota Coaster 2023", capacity: 30 }],
    routes: [],
  },
];

export async function seedDemoData(options: { force?: boolean } = {}): Promise<void> {
  if (config.sms.provider !== "console" && !options.force) {
    throw new Error("Refusing to seed demo data while a live SMS provider is configured (use --force to override).");
  }
  const rand = mulberry32(20261024);
  const pick = <T>(arr: readonly T[]): T => arr[Math.floor(rand() * arr.length)];
  const int = (min: number, max: number) => min + Math.floor(rand() * (max - min + 1));

  const registry = await importRuraRegistry();
  logger.info(`Imported ${registry.locations} locations and ${registry.caps} RURA fare caps`);
  const loc = async (slug: string) => {
    const l = await LocationModel.findOne({ slug }).lean();
    if (!l) throw new Error(`Missing location ${slug}`);
    return l._id;
  };

  // ── People ─────────────────────────────────────────────────────────────────
  const admin = await UserModel.create({ name: "Aline Uwase", phone: "+250788000001", email: "admin@fika.rw", role: "admin" });
  const [nyabugogo, huye, musanze] = [await loc("kigali"), await loc("huye"), await loc("musanze")];
  await UserModel.create([
    { name: "Samuel Kayitare", phone: "+250788000100", email: "station@fika.rw", role: "station", stationId: nyabugogo },
    { name: "Josiane Ingabire", phone: "+250788000101", role: "station", stationId: huye },
    { name: "Claude Nshimiyimana", phone: "+250788000102", role: "station", stationId: musanze },
  ]);
  const passenger = await UserModel.create({ name: "Jean Baptiste", phone: "+250788123456", email: "passenger@fika.rw", role: "passenger" });
  const usedPhones = new Set<string>();
  const demoPassengers = Array.from({ length: 40 }, () => {
    let phone = "";
    do phone = `+25078800${int(2000, 9999)}`;
    while (usedPhones.has(phone));
    usedPhones.add(phone);
    return { name: `${pick(FIRST)} ${pick(LAST)}`, phone, role: "passenger", language: pick(["en", "rw", "rw", "fr", "sw"] as const) };
  });
  const passengers = [passenger, ...(await UserModel.insertMany(demoPassengers))];

  // ── Operators, fleet, routes, recurring departures ─────────────────────────
  const routeDocs: { route: RouteDoc; spec: RouteSpec; vehicles: Types.ObjectId[]; operatorName: string; plates: string[] }[] = [];
  const operatorIds: Types.ObjectId[] = [];
  for (const spec of OPERATORS) {
    const operator = await OperatorModel.create({
      name: spec.name,
      slug: spec.slug,
      registrationNumber: spec.reg,
      contactPhone: spec.owner.phone,
      contactEmail: spec.owner.email,
      headquartersId: await loc(spec.hq),
      status: spec.status,
      approvedAt: spec.status === "approved" ? new Date(Date.now() - 60 * DAY) : null,
      approvedBy: spec.status === "approved" ? admin._id : null,
      bankAccount: spec.bank,
      parcelPricing: spec.parcels,
    });
    operatorIds.push(operator._id);
    await UserModel.create({
      name: spec.owner.name,
      phone: spec.owner.phone,
      email: spec.owner.email,
      role: "operator",
      operatorId: operator._id,
      isOperatorOwner: true,
    });
    const vehicles: { _id: Types.ObjectId }[] = [];
    for (const v of spec.vehicles) {
      vehicles.push(await VehicleModel.create({ operatorId: operator._id, plateNumber: v.plate, model: v.model, capacity: v.capacity }));
    }
    for (const r of spec.routes) {
      const originId = await loc(r.from);
      const destinationId = await loc(r.to);
      const viaIds = await Promise.all((r.via ?? []).map(loc));
      const cap = await capForRoute({ originId, destinationId, viaIds, priceRwf: r.price });
      const route = new RouteModel({
        operatorId: operator._id,
        originId,
        destinationId,
        viaIds,
        distanceKm: r.km,
        durationMinutes: r.minutes,
        priceRwf: r.price,
        capRwf: cap.capRwf,
        capStatus: cap.capStatus,
      });
      await route.save();
      for (const [i, time] of r.times.entries()) {
        await ScheduleModel.create({
          operatorId: operator._id,
          routeId: route._id,
          vehicleId: vehicles[r.vehicles[i % r.vehicles.length]]._id,
          departureTime: time,
          daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
        });
      }
      routeDocs.push({
        route,
        spec: r,
        vehicles: r.vehicles.map((i) => vehicles[i]._id),
        operatorName: spec.name,
        plates: r.vehicles.map((i) => spec.vehicles[i].plate),
      });
    }
  }
  // A second Volcano agent (non-owner) for the team screen.
  await UserModel.create({ name: "Diane Ingabire", phone: "+250788000011", role: "operator", operatorId: operatorIds[0] });
  invalidateLookups();
  await ensureLookups();

  // ── History: past trips with completed bookings and payments ───────────────
  const now = Date.now();
  const today = kigaliDate();
  const usedRefs = new Set<string>();
  const ref = () => {
    let r = "";
    do r = bookingReference(new Date());
    while (usedRefs.has(r));
    usedRefs.add(r);
    return r;
  };
  const tripsToInsert = [];
  const bookingsToInsert = [];
  const paymentsToInsert = [];
  for (let d = 14; d >= 0; d--) {
    const date = addDays(today, -d);
    for (const rd of routeDocs) {
      for (const [i, time] of rd.spec.times.entries()) {
        const departureAt = kigaliDateTime(date, time);
        if (departureAt.getTime() > now - 30 * MIN) continue; // future and imminent trips come from the generator
        if (rand() < 0.15) continue; // not every departure every day in the history
        const vehicleIdx = i % rd.vehicles.length;
        const capacity = OPERATORS.flatMap((o) => o.vehicles).find((v) => v.plate === rd.plates[vehicleIdx])?.capacity ?? 30;
        const arrived = departureAt.getTime() + rd.spec.minutes * MIN < now;
        const tripId = new Types.ObjectId();
        let seats = 0;
        let checkedIn = 0;
        const bookingsCount = int(Math.floor(capacity * 0.12), Math.floor(capacity * 0.35));
        for (let b = 0; b < bookingsCount && seats < capacity; b++) {
          const places = rand() < 0.8 ? 1 : int(2, 3);
          if (seats + places > capacity) break;
          seats += places;
          const p = pick(passengers);
          const createdAt = new Date(departureAt.getTime() - int(30, 4 * 24 * 60) * MIN);
          const method = rand() < 0.6 ? "mtn" : rand() < 0.7 ? "airtel" : "cash";
          const total = rd.spec.price * places;
          const bookingId = new Types.ObjectId();
          const boarded = rand() < 0.93;
          if (boarded) checkedIn += places;
          bookingsToInsert.push({
            _id: bookingId,
            reference: ref(),
            userId: p._id,
            tripId,
            operatorId: rd.route.operatorId,
            originId: rd.route.originId,
            destinationId: rd.route.destinationId,
            departureAt,
            places,
            unitPrice: rd.spec.price,
            totalAmount: total,
            traveler: { name: p.name ?? "Passenger", phone: p.phone ?? "+250788000999", email: null },
            status: arrived ? "completed" : "confirmed",
            paymentStatus: "paid",
            paymentMethod: method,
            checkedInAt: boarded ? new Date(departureAt.getTime() - int(5, 40) * MIN) : null,
            locale: p.language,
            reminderSentAt: createdAt,
            createdAt,
            updatedAt: createdAt,
          });
          const commission = commissionOf(total, 0.05);
          paymentsToInsert.push({
            kind: "booking",
            bookingId,
            operatorId: rd.route.operatorId,
            userId: p._id,
            method,
            mode: method === "cash" ? "live" : "mock",
            phone: method === "cash" ? null : p.phone,
            amount: total,
            status: "success",
            providerRef: method === "cash" ? null : `MOCK-${method.toUpperCase()}-${randomCode(10)}`,
            commissionRate: 0.05,
            commissionAmount: commission,
            operatorAmount: total - commission,
            paidAt: method === "cash" ? new Date(departureAt.getTime() - 15 * MIN) : new Date(createdAt.getTime() + 2 * MIN),
            eligibleForPayoutAt: departureAt,
            events: [{ status: "success", at: createdAt }],
            createdAt,
            updatedAt: createdAt,
          });
        }
        tripsToInsert.push({
          _id: tripId,
          operatorId: rd.route.operatorId,
          routeId: rd.route._id,
          scheduleId: null,
          vehicleId: rd.vehicles[vehicleIdx],
          originId: rd.route.originId,
          destinationId: rd.route.destinationId,
          viaIds: rd.route.viaIds,
          departureAt,
          durationMinutes: rd.spec.minutes,
          priceRwf: rd.spec.price,
          capRwf: rd.route.capRwf,
          seatsTotal: capacity,
          seatsBooked: seats,
          checkedInCount: checkedIn,
          status: arrived ? "arrived" : "departed",
          delayMinutes: rand() < 0.15 ? int(5, 25) : 0,
          operatorName: rd.operatorName,
          plateNumber: rd.plates[vehicleIdx],
          vehicleModel: null,
        });
      }
    }
  }
  await TripModel.insertMany(tripsToInsert, { ordered: false });
  await BookingModel.insertMany(bookingsToInsert, { ordered: false });
  await PaymentModel.insertMany(paymentsToInsert, { ordered: false });
  logger.info(`Seeded ${tripsToInsert.length} past trips, ${bookingsToInsert.length} bookings`);

  // Paid payouts for the two oldest weeks, pending payouts for recent completed trips.
  for (const operatorId of operatorIds.slice(0, 4)) {
    for (const weeksAgo of [2]) {
      const periodEnd = new Date(now - (weeksAgo - 1) * 7 * DAY);
      const periodStart = new Date(now - weeksAgo * 7 * DAY);
      const payments = await PaymentModel.find({
        operatorId,
        payoutId: null,
        eligibleForPayoutAt: { $gte: periodStart, $lt: periodEnd },
      }).lean();
      if (!payments.length) continue;
      const gross = payments.reduce((s, p) => s + p.amount, 0);
      const online = payments.filter((p) => p.method !== "cash").reduce((s, p) => s + p.amount, 0);
      const commission = payments.reduce((s, p) => s + p.commissionAmount, 0);
      const operator = await OperatorModel.findById(operatorId).lean();
      const payout = await PayoutModel.create({
        operatorId,
        periodStart,
        periodEnd,
        paymentsCount: payments.length,
        gross,
        onlineGross: online,
        cashGross: gross - online,
        commission,
        net: online - commission,
        status: "paid",
        dueDate: new Date(periodEnd.getTime() + 2 * DAY),
        processedAt: new Date(periodEnd.getTime() + 2 * DAY),
        processedBy: admin._id,
        reference: `PO-${randomCode(8)}`,
        bankAccountMasked: operator?.bankAccount ? `•••• ${operator.bankAccount.accountNumber.slice(-4)}` : null,
      });
      await PaymentModel.updateMany({ _id: { $in: payments.map((p) => p._id) } }, { $set: { payoutId: payout._id } });
    }
  }
  await generatePayouts({ force: true, now: new Date(now - DAY) });

  // ── Upcoming trips, then live situations around "now" ─────────────────────
  await generateTripsFromSchedules(14);
  const volcanoMusanze = routeDocs.find((r) => r.operatorName === "Volcano Express" && r.spec.to === "musanze")!;
  const horizonHuye = routeDocs.find((r) => r.operatorName === "Horizon Lines" && r.spec.to === "huye")!;
  const virungaNyanza = routeDocs.find((r) => r.operatorName === "Virunga Express" && r.spec.to === "nyanza")!;

  const oneOff = async (rd: (typeof routeDocs)[number], minutesFromNow: number, status: "scheduled" | "boarding" | "departed", delay = 0) =>
    TripModel.create({
      operatorId: rd.route.operatorId,
      routeId: rd.route._id,
      vehicleId: rd.vehicles[0],
      originId: rd.route.originId,
      destinationId: rd.route.destinationId,
      viaIds: rd.route.viaIds,
      departureAt: new Date(Math.round((now + minutesFromNow * MIN) / (5 * MIN)) * 5 * MIN),
      durationMinutes: rd.spec.minutes,
      priceRwf: rd.spec.price,
      capRwf: rd.route.capRwf,
      seatsTotal: 30,
      status,
      delayMinutes: delay,
      statusChangedAt: new Date(),
      operatorName: rd.operatorName,
      plateNumber: rd.plates[0],
    });

  const boarding = await oneOff(volcanoMusanze, 20, "boarding");
  const travelling = await oneOff(horizonHuye, -70, "departed");
  await oneOff(virungaNyanza, 55, "scheduled", 30);

  // Fill the boarding bus: a mix of paid, checked-in and cash-at-station passengers.
  let seats = 0;
  let checked = 0;
  for (let i = 0; i < 18; i++) {
    const p = passengers[1 + i];
    const cash = i % 6 === 5;
    const isChecked = !cash && i < 9;
    const createdAt = new Date(now - int(60, 3 * 24 * 60) * MIN);
    const booking = await BookingModel.create({
      reference: ref(),
      userId: p._id,
      tripId: boarding._id,
      operatorId: boarding.operatorId,
      originId: boarding.originId,
      destinationId: boarding.destinationId,
      departureAt: boarding.departureAt,
      places: 1,
      unitPrice: boarding.priceRwf,
      totalAmount: boarding.priceRwf,
      traveler: { name: p.name ?? "Passenger", phone: p.phone ?? "", email: null },
      status: "confirmed",
      paymentStatus: cash ? "cash_due" : "paid",
      paymentMethod: cash ? "cash" : "mtn",
      checkedInAt: isChecked ? new Date(now - int(1, 25) * MIN) : null,
      locale: p.language,
      createdAt,
    });
    seats += 1;
    if (isChecked) checked += 1;
    const commission = commissionOf(boarding.priceRwf, 0.05);
    await PaymentModel.create({
      kind: "booking",
      bookingId: booking._id,
      operatorId: boarding.operatorId,
      userId: p._id,
      method: cash ? "cash" : "mtn",
      mode: cash ? "live" : "mock",
      phone: cash ? null : p.phone,
      amount: boarding.priceRwf,
      status: cash ? "pending" : "success",
      commissionRate: 0.05,
      commissionAmount: cash ? 0 : commission,
      operatorAmount: cash ? 0 : boarding.priceRwf - commission,
      paidAt: cash ? null : createdAt,
      providerRef: cash ? null : `MOCK-MTN-${randomCode(10)}`,
    });
  }
  boarding.seatsBooked = seats;
  boarding.checkedInCount = checked;
  await boarding.save();

  // ── The demo passenger's own trips ─────────────────────────────────────────
  const tomorrow = addDays(today, 1);
  const tomorrowTrip = await TripModel.findOne({
    routeId: volcanoMusanze.route._id,
    departureAt: kigaliDateTime(tomorrow, "09:00"),
  });
  if (tomorrowTrip) {
    const booking = await BookingModel.create({
      reference: ref(),
      userId: passenger._id,
      tripId: tomorrowTrip._id,
      operatorId: tomorrowTrip.operatorId,
      originId: tomorrowTrip.originId,
      destinationId: tomorrowTrip.destinationId,
      departureAt: tomorrowTrip.departureAt,
      places: 2,
      unitPrice: tomorrowTrip.priceRwf,
      totalAmount: tomorrowTrip.priceRwf * 2,
      traveler: { name: "Jean Baptiste", phone: "+250788123456", email: "passenger@fika.rw" },
      status: "confirmed",
      paymentStatus: "paid",
      paymentMethod: "mtn",
      locale: "en",
    });
    tomorrowTrip.seatsBooked += 2;
    await tomorrowTrip.save();
    const commission = commissionOf(booking.totalAmount, 0.05);
    await PaymentModel.create({
      kind: "booking",
      bookingId: booking._id,
      operatorId: booking.operatorId,
      userId: passenger._id,
      method: "mtn",
      mode: "mock",
      phone: "+250788123456",
      amount: booking.totalAmount,
      status: "success",
      providerRef: `MOCK-MTN-${randomCode(10)}`,
      commissionRate: 0.05,
      commissionAmount: commission,
      operatorAmount: booking.totalAmount - commission,
      paidAt: new Date(),
    });
    await NotificationModel.create({
      userId: passenger._id,
      type: "booking.confirmed",
      title: "Booking confirmed",
      body: `${booking.reference}: Kigali (Nyabugogo) → Musanze, ${tomorrow} at 09:00. Show your QR ticket at the station.`,
      data: { bookingId: booking._id.toString(), reference: booking.reference },
    });
  }
  const huyeLater = await TripModel.findOne({ routeId: horizonHuye.route._id, departureAt: { $gt: new Date(now + 2 * DAY) } }).sort({ departureAt: 1 });
  if (huyeLater) {
    await BookingModel.create({
      reference: ref(),
      userId: passenger._id,
      tripId: huyeLater._id,
      operatorId: huyeLater.operatorId,
      originId: huyeLater.originId,
      destinationId: huyeLater.destinationId,
      departureAt: huyeLater.departureAt,
      places: 1,
      unitPrice: huyeLater.priceRwf,
      totalAmount: huyeLater.priceRwf,
      traveler: { name: "Jean Baptiste", phone: "+250788123456", email: null },
      status: "confirmed",
      paymentStatus: "cash_due",
      paymentMethod: "cash",
      locale: "en",
    });
    huyeLater.seatsBooked += 1;
    await huyeLater.save();
  }

  // ── Parcels in every state ─────────────────────────────────────────────────
  const makeParcel = async (opts: {
    rd: (typeof routeDocs)[number];
    status: "awaiting_dropoff" | "received" | "in_transit" | "arrived" | "collected";
    tripId?: Types.ObjectId | null;
    sender?: (typeof passengers)[number];
    hoursAgo: number;
  }) => {
    const sender = opts.sender ?? pick(passengers);
    const receiver = pick(passengers);
    const weight = pick([0.5, 1, 2, 3.5, 5, 8, 12]);
    const size = weight <= 5 ? "small" : weight <= 15 ? "medium" : "large";
    const spec = OPERATORS.find((o) => o.name === opts.rd.operatorName)!;
    const price = parcelPrice(weight, spec.parcels.perKg, spec.parcels.minimum);
    const code = parcelCode();
    const pickup = String(int(100000, 999999));
    const created = new Date(now - opts.hoursAgo * 60 * MIN);
    const flow = ["pending_payment", "awaiting_dropoff", "received", "loaded", "in_transit", "arrived", "collected"];
    const upto = flow.indexOf(opts.status);
    const events = flow.slice(0, upto + 1).map((s, i) => ({
      status: s,
      at: new Date(created.getTime() + i * 25 * MIN),
      stationId: s === "received" || s === "awaiting_dropoff" ? opts.rd.route.originId : s === "arrived" || s === "collected" ? opts.rd.route.destinationId : null,
    }));
    const parcel = await ParcelModel.create({
      code,
      pickupCodeHash: hashSecret(pickup, code),
      pickupCodeEnc: encrypt(pickup),
      senderId: sender._id,
      sender: { name: sender.name ?? "Sender", phone: sender.phone ?? "" },
      receiver: { name: receiver.name ?? "Receiver", phone: receiver.phone ?? "" },
      originId: opts.rd.route.originId,
      destinationId: opts.rd.route.destinationId,
      operatorId: opts.rd.route.operatorId,
      description: pick(["Documents", "Clothes", "Phone accessories", "Shoes", "Books", "Spare parts", "Coffee beans"]),
      weightKg: weight,
      size,
      priceRwf: price,
      status: opts.status,
      paymentStatus: "paid",
      paymentMethod: "mtn",
      tripId: opts.tripId ?? null,
      events,
      createdAt: created,
    });
    const commission = commissionOf(price, 0.05);
    await PaymentModel.create({
      kind: "parcel",
      parcelId: parcel._id,
      operatorId: parcel.operatorId,
      userId: sender._id,
      method: "mtn",
      mode: "mock",
      phone: sender.phone,
      amount: price,
      status: "success",
      providerRef: `MOCK-MTN-${randomCode(10)}`,
      commissionRate: 0.05,
      commissionAmount: commission,
      operatorAmount: price - commission,
      paidAt: created,
      eligibleForPayoutAt: ["in_transit", "arrived", "collected"].includes(opts.status) ? created : null,
    });
    return parcel;
  };
  for (let i = 0; i < 3; i++) await makeParcel({ rd: pick([volcanoMusanze, horizonHuye]), status: "awaiting_dropoff", hoursAgo: 1 + i });
  for (let i = 0; i < 2; i++) await makeParcel({ rd: horizonHuye, status: "received", hoursAgo: 3 + i });
  await makeParcel({ rd: horizonHuye, status: "in_transit", tripId: travelling._id, sender: passenger, hoursAgo: 4 });
  for (let i = 0; i < 2; i++) await makeParcel({ rd: horizonHuye, status: "in_transit", tripId: travelling._id, hoursAgo: 4 + i });
  for (let i = 0; i < 2; i++) await makeParcel({ rd: horizonHuye, status: "arrived", hoursAgo: 20 + i });
  await makeParcel({ rd: volcanoMusanze, status: "collected", sender: passenger, hoursAgo: 72 });
  for (let i = 0; i < 6; i++) await makeParcel({ rd: pick([volcanoMusanze, horizonHuye]), status: "collected", hoursAgo: 30 + i * 24 });

  // ── Audit trail ────────────────────────────────────────────────────────────
  for (const [i, spec] of OPERATORS.filter((o) => o.status === "approved").entries()) {
    await AuditLogModel.create({
      actorId: admin._id,
      actorRole: "admin",
      action: "operator.approved",
      entityType: "operator",
      entityId: operatorIds[i].toString(),
      summary: spec.name,
      createdAt: new Date(now - (60 - i) * DAY),
    });
  }
  invalidateLookups();
  logger.info(
    [
      "Demo data ready. Sign in with any of these numbers (OTP codes are printed in this console):",
      "  Passenger     +250 788 123 456   (passenger@fika.rw)",
      "  Operator      +250 788 000 010   Volcano Express owner",
      "  Station desk  +250 788 000 100   Nyabugogo bus park",
      "  Admin         +250 788 000 001   (admin@fika.rw)",
    ].join("\n"),
  );
}
