import mongoose from "mongoose";
import { connectDatabase } from "../db";
import { errorFields, logger } from "../lib/logger";
import { UserModel } from "../models";
import { seedDemoData } from "./seed";

// npm run db:seed            → seeds an empty database
// npm run db:seed -- --reset → drops the database first (development only)
// npm run db:seed -- --force → allow seeding while a live SMS provider is configured

async function main() {
  const reset = process.argv.includes("--reset");
  const force = process.argv.includes("--force");
  const db = await connectDatabase();
  try {
    if (reset) {
      if (process.env.NODE_ENV === "production") throw new Error("--reset is not allowed in production");
      await mongoose.connection.dropDatabase();
      logger.info("Database dropped");
    }
    if ((await UserModel.estimatedDocumentCount()) > 0) {
      logger.warn("Database is not empty; nothing seeded. Use --reset to start over.");
      return;
    }
    await seedDemoData({ force });
  } finally {
    await db.stop();
  }
}

main().catch((err) => {
  logger.error("Seed failed", errorFields(err));
  process.exit(1);
});
