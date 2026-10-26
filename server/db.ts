import fs from "node:fs";
import path from "node:path";
import mongoose from "mongoose";
import { config } from "./config";
import { errorFields, logger } from "./lib/logger";

export interface DatabaseHandle {
  uri: string;
  memory: boolean;
  stop: () => Promise<void>;
}

mongoose.set("strictQuery", true);

interface MemoryServer {
  getUri(): string;
  stop(options?: { doCleanup?: boolean; force?: boolean }): Promise<boolean>;
}

/**
 * Starts a local MongoDB through mongodb-memory-server (dev dependency).
 * `persistDir` keeps data between restarts; omit it for throwaway test databases.
 */
export async function startMemoryMongo(persistDir?: string): Promise<MemoryServer> {
  const { MongoMemoryServer } = await import("mongodb-memory-server");
  const dbPath = path.resolve(persistDir ?? path.join(".data", `mongo-test-${process.pid}-${Date.now()}`));
  fs.mkdirSync(dbPath, { recursive: true });
  let lastError: unknown;
  // A previous dev process may still be releasing the data files right after a restart.
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      return await MongoMemoryServer.create({
        instance: {
          dbPath,
          storageEngine: "wiredTiger",
          launchTimeout: 60_000,
          // Keep the local database light: development laptops often have 4 GB of RAM.
          args: ["--wiredTigerCacheSizeGB", "0.25", "--setParameter", "diagnosticDataCollectionEnabled=false"],
        },
      });
    } catch (err) {
      lastError = err;
      logger.warn(`Local MongoDB failed to start (attempt ${attempt}/4), retrying…`, errorFields(err));
      await new Promise((r) => setTimeout(r, attempt * 1500));
    }
  }
  throw lastError;
}

function databaseInUri(uri: string): boolean {
  const withoutQuery = uri.split("?")[0];
  const afterHosts = withoutQuery.replace(/^mongodb(\+srv)?:\/\/[^/]+/, "");
  return afterHosts.replace(/^\//, "").length > 0;
}

export async function connectDatabase(): Promise<DatabaseHandle> {
  let uri = config.mongoUri;
  let memory: MemoryServer | null = null;

  if (!uri) {
    if (config.isProd) throw new Error("MONGODB_URI is required in production");
    memory = await startMemoryMongo(path.join(".data", "mongo"));
    uri = `${memory.getUri()}fika`;
    logger.info(`Using local MongoDB (data in .data/mongo): ${uri}`);
  }

  await mongoose.connect(uri, {
    // Atlas URIs often omit the database name; default to "fika" instead of MongoDB's "test".
    dbName: config.mongoDbName ?? (databaseInUri(uri) ? undefined : "fika"),
    autoIndex: !config.isProd,
    serverSelectionTimeoutMS: 15_000,
  });
  logger.info("Connected to MongoDB", { db: mongoose.connection.name });

  return {
    uri,
    memory: !!memory,
    stop: async () => {
      await mongoose.disconnect();
      if (memory) await memory.stop({ doCleanup: false });
    },
  };
}

/** Creates every index declared on the models (used by migrations and tests). */
export async function syncAllIndexes(): Promise<void> {
  for (const model of Object.values(mongoose.models)) {
    await model.createIndexes();
  }
}
