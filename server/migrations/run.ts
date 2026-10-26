import { connectDatabase } from "../db";
import { errorFields, logger } from "../lib/logger";
import { MigrationModel } from "../models";
import { migrations } from "./index";

async function main() {
  const direction = process.argv[2] === "down" ? "down" : "up";
  const db = await connectDatabase();
  try {
    const applied = new Set((await MigrationModel.find({}).lean()).map((m) => m.name));
    if (direction === "up") {
      for (const m of migrations) {
        if (applied.has(m.name)) continue;
        logger.info(`Applying ${m.name}…`);
        await m.up();
        await MigrationModel.create({ name: m.name });
      }
      logger.info("Migrations up to date");
    } else {
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
