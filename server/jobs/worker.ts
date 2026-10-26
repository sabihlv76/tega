import os from "node:os";
import { errorFields, logger } from "../lib/logger";
import { JobModel } from "../models";
import { expireBookingHolds, sendDepartureReminders } from "../services/bookings";
import { sendEmail, sendSms } from "../services/messaging";
import { expireParcelHolds } from "../services/parcels";
import { pollPayment, settleMockPayment } from "../services/payments/service";
import { generatePayouts } from "../services/payouts";
import { autoAdvanceTrips, generateTripsFromSchedules } from "../services/trips";
import { enqueue } from "./queue";

type Handler = (payload: Record<string, unknown>) => Promise<unknown>;

export const handlers: Record<string, Handler> = {
  "sms.send": (p) => sendSms(String(p.to), String(p.body)),
  "email.send": (p) => sendEmail(String(p.to), String(p.subject), String(p.body)),
  "payment.mock.settle": (p) => settleMockPayment(String(p.paymentId)),
  "payment.poll": (p) => pollPayment(String(p.paymentId)),
  "holds.expire": async () => {
    await expireBookingHolds();
    await expireParcelHolds();
  },
  "trips.generate": () => generateTripsFromSchedules(14),
  "trips.advance": () => autoAdvanceTrips(),
  "reminders.departure": () => sendDepartureReminders(),
  "payouts.generate": () => generatePayouts(),
};

const WORKER_ID = `${os.hostname()}:${process.pid}`;
const BUSY_DELAY_MS = 50;
const IDLE_DELAY_MS = 1000;

async function claim() {
  return JobModel.findOneAndUpdate(
    { status: "queued", runAt: { $lte: new Date() } },
    { $set: { status: "running", lockedAt: new Date(), lockedBy: WORKER_ID }, $inc: { attempts: 1 } },
    { sort: { runAt: 1 }, returnDocument: "after" },
  );
}

export async function runJobOnce(): Promise<boolean> {
  const job = await claim();
  if (!job) return false;
  const handler = handlers[job.type];
  try {
    if (!handler) throw new Error(`No handler for job type ${job.type}`);
    await handler((job.payload as Record<string, unknown>) ?? {});
    job.status = "done";
    job.finishedAt = new Date();
    job.lastError = null;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (job.attempts < job.maxAttempts) {
      job.status = "queued";
      job.runAt = new Date(Date.now() + 2 ** job.attempts * 5_000);
    } else {
      job.status = "failed";
      job.finishedAt = new Date();
      logger.error(`Job ${job.type} failed permanently`, errorFields(err));
    }
    job.lastError = message;
  }
  job.lockedAt = null;
  job.lockedBy = null;
  await job.save();
  return true;
}

/** Enqueues recurring maintenance work; uniqueKey makes it safe with several API instances. */
async function scheduleRecurring(): Promise<void> {
  const now = new Date();
  const minute = Math.floor(now.getTime() / 60_000);
  const every = (n: number) => Math.floor(minute / n);
  await Promise.all([
    enqueue("holds.expire", {}, { uniqueKey: `holds.expire:${minute}`, maxAttempts: 1 }),
    enqueue("trips.advance", {}, { uniqueKey: `trips.advance:${minute}`, maxAttempts: 1 }),
    enqueue("reminders.departure", {}, { uniqueKey: `reminders:${every(5)}`, maxAttempts: 1 }),
    enqueue("trips.generate", {}, { uniqueKey: `trips.generate:${every(60)}`, maxAttempts: 3 }),
    enqueue("payouts.generate", {}, { uniqueKey: `payouts.generate:${every(360)}`, maxAttempts: 3 }),
  ]);
}

export function startWorker(): { stop: () => Promise<void> } {
  let running = true;
  let current: Promise<void> = Promise.resolve();

  const loop = async () => {
    while (running) {
      let worked = false;
      try {
        worked = await runJobOnce();
      } catch (err) {
        logger.error("Job worker error", errorFields(err));
      }
      await new Promise((r) => setTimeout(r, worked ? BUSY_DELAY_MS : IDLE_DELAY_MS));
    }
  };

  const tick = async () => {
    try {
      await scheduleRecurring();
      // Recover jobs left "running" by a crashed process.
      await JobModel.updateMany(
        { status: "running", lockedAt: { $lt: new Date(Date.now() - 5 * 60_000) } },
        { $set: { status: "queued", lockedAt: null, lockedBy: null } },
      );
    } catch (err) {
      logger.error("Job scheduler error", errorFields(err));
    }
  };

  void tick();
  const timer = setInterval(tick, 30_000);
  current = loop();
  logger.info(`Background worker started (${WORKER_ID})`);

  return {
    stop: async () => {
      running = false;
      clearInterval(timer);
      await current;
    },
  };
}
