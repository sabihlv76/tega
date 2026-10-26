import http from "node:http";
import { createApp } from "./app";
import { config } from "./config";
import { connectDatabase } from "./db";
import { startWorker } from "./jobs/worker";
import { errorFields, logger } from "./lib/logger";
import { UserModel } from "./models";
import { closeRealtime, initRealtime } from "./realtime";
import { seedDemoData } from "./seed/seed";
import { generateTripsFromSchedules } from "./services/trips";

async function main() {
  if (config.usingDevSecrets && !config.isProd) {
    logger.warn("JWT_SECRET / TICKET_SECRET not set: using development secrets. Set them before deploying.");
  }
  const db = await connectDatabase();

  // Demo data is only ever written to the throwaway local database. A real database (MongoDB Atlas,
  // configured with MONGODB_URI) is never seeded automatically; use your own seed script for it.
  if (db.memory && config.seedOnEmpty && (await UserModel.estimatedDocumentCount()) === 0) {
    logger.info("Empty local database: seeding demo data…");
    await seedDemoData();
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
