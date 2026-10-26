import http from "node:http";
import { createApp } from "./app";
import { config } from "./config";
import { connectDatabase } from "./db";
import { startWorker } from "./jobs/worker";
import { errorFields, logger } from "./lib/logger";
import { migrateUp, pendingMigrations } from "./migrations";
import { closeRealtime, initRealtime } from "./realtime";
import { generateTripsFromSchedules } from "./services/trips";

async function main() {
  if (config.usingDevSecrets && !config.isProd) {
    logger.warn("JWT_SECRET / TICKET_SECRET not set: using development secrets. Set them before deploying.");
  }
  const db = await connectDatabase();

  // The local database sets itself up (indexes, bus parks, RURA fare caps). A real database (MongoDB
  // Atlas, configured with MONGODB_URI) is only changed by `npm run db:setup`.
  if (db.memory) await migrateUp();
  else {
    const pending = await pendingMigrations();
    if (pending.length)
      logger.warn(`Database not set up yet (${pending.length} pending migrations). Run: npm run db:setup`);
  }
  await generateTripsFromSchedules(14);

  const app = createApp();
  const server = http.createServer(app);
  initRealtime(server);
  const worker = config.jobsEnabled ? startWorker() : null;

  server.listen(config.port, () => {
    logger.info(`FIKA API listening on http://localhost:${config.port} (${config.env})`);
  });

  let stopping = false;
  const shutdown = async (signal: string) => {
    if (stopping) return;
    stopping = true;
    logger.info(`${signal} received, shutting down…`);
    server.close();
    await closeRealtime();
    await worker?.stop();
    await db.stop();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((err) => {
  logger.error("API failed to start", errorFields(err));
  process.exit(1);
});
