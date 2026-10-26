import { JobModel } from "../models";

// A small, durable job queue on MongoDB. Jobs survive restarts, are retried with backoff and can be
// de-duplicated with a uniqueKey (safe with several API instances running the worker).

export interface EnqueueOptions {
  runAt?: Date;
  delayMs?: number;
  uniqueKey?: string;
  maxAttempts?: number;
}

export async function enqueue(type: string, payload: Record<string, unknown> = {}, options: EnqueueOptions = {}) {
  const runAt = options.runAt ?? new Date(Date.now() + (options.delayMs ?? 0));
  if (options.uniqueKey) {
    await JobModel.updateOne(
      { uniqueKey: options.uniqueKey },
      { $setOnInsert: { type, payload, runAt, maxAttempts: options.maxAttempts ?? 5, status: "queued" } },
      { upsert: true },
    );
    return;
  }
  await JobModel.create({ type, payload, runAt, maxAttempts: options.maxAttempts ?? 5 });
}
