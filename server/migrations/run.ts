import { connectDatabase } from "../db";
import { errorFields, logger } from "../lib/logger";
import { MigrationModel } from "../models";
import { migrateUp, migrations } from "./index";

async function main() {
  const direction = process.argv[2] === "down" ? "down" : "up";
  const db = await connectDatabase();
  try {
    if (direction === "up") {
      await migrateUp();
      logger.info("Migrations up to date");
    } else {
      const applied = new Set((await MigrationModel.find({}).lean()).map((m) => m.name));
      const last = [...migrations].reverse().find((m) => applied.has(m.name));
      if (!last) {
        logger.info("Nothing to roll back");
        return;
      }
      logger.info(`Rolling back ${last.name}…`);
      await last.down();
      await MigrationModel.deleteOne({ name: last.name });
    }
  } finally {
    await db.stop();
  }
}

main().catch((err) => {
  logger.error("Migration failed", errorFields(err));
  process.exit(1);
});
