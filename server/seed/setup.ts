import mongoose from "mongoose";
import { z } from "zod";
import { normalizeRwPhone } from "../../shared/money";
import { connectDatabase } from "../db";
import { errorFields, logger } from "../lib/logger";
import { qf } from "../lib/mongo";
import { migrateUp } from "../migrations";
import { FareCapModel, LocationModel, OperatorModel, UserModel } from "../models";
import { audit } from "../services/audit";

// Prepares a database with real data only: indexes, Rwanda's bus parks and stops, and the RURA
// intercity fare caps. Bus companies join through "Partner with FIKA" (/partners/apply) and admin
// approval, then add their own vehicles and routes; passengers sign up themselves. Safe to run
// again: it only adds what is missing and never deletes anything.
//
// npm run db:setup
// npm run db:setup -- --admin +250788123456 --name "Your Name"   → also creates or promotes an admin
// npm run db:setup -- --admin you@example.com --name "Your Name" → admin who signs in with an email code

type Contact = { phone: string } | { email: string };

function option(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1]?.trim();
}

function parseContact(raw: string): Contact {
  if (raw.includes("@")) {
    const email = raw.toLowerCase();
    if (z.string().email().safeParse(email).success) return { email };
  } else {
    const phone = normalizeRwPhone(raw);
    if (phone) return { phone };
  }
  throw new Error(`--admin needs a Rwandan mobile number or an email address, got "${raw}"`);
}

async function ensureAdmin(contact: Contact, name: string | undefined): Promise<void> {
  const label = "phone" in contact ? contact.phone : contact.email;
  let user = await UserModel.findOne(qf(contact));
  if (user && user.role !== "passenger" && user.role !== "admin") {
    throw new Error(
      `${label} is used by a FIKA ${user.role} account. Use another number or email for the admin.`,
    );
  }
  const action = !user ? "user.create" : user.role === "admin" ? null : "user.promote";
  user ??= new UserModel({ ...contact, language: "en" });
  user.role = "admin";
  user.status = "active";
  if (name) user.name = name;
  await user.save();
  if (action) await audit(null, action, "user", user._id, `${user.name ?? label} (admin, via db:setup)`);
  logger.info(
    action === "user.create"
      ? `Admin account created for ${label}`
      : action
        ? `${label} is now an admin`
        : `${label} is already an admin`,
  );
}

async function main() {
  const contact = process.argv.includes("--admin") ? parseContact(option("admin") ?? "") : null;
  const name = option("name");
  if (name !== undefined && (name.length < 2 || name.length > 120))
    throw new Error("--name must be 2 to 120 characters");

  const db = await connectDatabase();
  try {
    const applied = await migrateUp();
    logger.info(applied.length ? `Applied ${applied.length} migrations` : "Migrations already up to date");
    if (contact) await ensureAdmin(contact, name);

    const [locations, stations, fareCaps, operators, admins] = await Promise.all([
      LocationModel.countDocuments(),
      LocationModel.countDocuments({ isStation: true }),
      FareCapModel.countDocuments(),
      OperatorModel.countDocuments(),
      UserModel.countDocuments({ role: "admin" }),
    ]);
    logger.info(`Database "${mongoose.connection.name}" is ready`, {
      locations,
      stations,
      fareCaps,
      operators,
      admins,
    });
    if (!admins)
      logger.warn(
        'No admin account yet. Run: npm run db:setup -- --admin <your phone or email> --name "Your Name"',
      );
  } finally {
    await db.stop();
  }
}

main().catch((err) => {
  logger.error("Setup failed", errorFields(err));
  process.exit(1);
});
