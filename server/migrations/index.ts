import mongoose from "mongoose";
import { syncAllIndexes } from "../db";
import { FareCapModel, LocationModel } from "../models";
import { importRuraRegistry } from "../seed/rura";
import { refreshAllRouteCaps } from "../services/fares";

// Versioned, reversible database migrations. Applied names are stored in the `migrations`
// collection; `npm run db:migrate` applies pending ones in order, `npm run db:rollback` reverts
// the most recent one. Deployments run migrations before starting the new API version.

export interface Migration {
  name: string;
  up: () => Promise<void>;
  down: () => Promise<void>;
}

export const migrations: Migration[] = [
  {
    name: "001-create-indexes",
    up: async () => {
      await syncAllIndexes();
    },
    down: async () => {
      // Indexes are derived from the models; dropping them is never needed for a rollback.
    },
  },
  {
    name: "002-rura-fare-registry",
    up: async () => {
      await importRuraRegistry();
      await refreshAllRouteCaps();
    },
    down: async () => {
      await FareCapModel.deleteMany({ source: "rura_registry" });
    },
  },
  {
    name: "003-users-email-partial-index",
    // The original MongoDB script used a plain unique index on users.email, which rejects a second
    // user without an email (phone-only and USSD users). Replace it with a partial unique index.
    up: async () => {
      const users = mongoose.connection.collection("users");
      const indexes = await users.indexes().catch(() => []);
      for (const idx of indexes) {
        if (idx.key && Object.keys(idx.key).join() === "email" && idx.unique && !idx.partialFilterExpression && idx.name) {
          await users.dropIndex(idx.name);
        }
      }
      await syncAllIndexes();
    },
    down: async () => {},
  },
  {
    name: "004-location-stations-flag",
    up: async () => {
      await LocationModel.updateMany({ isStation: { $exists: false } }, { $set: { isStation: false } });
    },
    down: async () => {},
  },
];
