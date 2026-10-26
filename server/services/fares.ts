import { Types } from "mongoose";
import type { CapStatus } from "../../shared/constants";
import { capStatusFor, formatRwf } from "../../shared/money";
import { badRequest } from "../lib/errors";
import { slugify } from "../lib/crypto";
import { type FareCapDoc, FareCapModel, LocationModel, RouteModel, TripModel } from "../models";
import { ensureLookups, findLocation, invalidateLookups, loc, op } from "./lookup";
import { notifyAdmins, notifyOperatorStaff } from "./notify";
import { getSettings } from "./settings";

// RURA fare caps. A cap applies to a pair of locations in both directions; where RURA publishes
// several caps for the same pair depending on the road (e.g. "Kamembe via Huye"), the route's
// stops pick the matching one.

type Oid = Types.ObjectId | string;

export async function findCap(originId: Oid, destinationId: Oid, viaIds: Oid[] = []): Promise<FareCapDoc | null> {
  const o = new Types.ObjectId(originId.toString());
  const d = new Types.ObjectId(destinationId.toString());
  const caps = await FareCapModel.find({
    $or: [
      { originId: o, destinationId: d },
      { originId: d, destinationId: o },
    ],
  });
  if (caps.length === 0) return null;
  const via = new Set(viaIds.map((v) => v.toString()));
  const exactVia = caps.find((c) => c.viaId && via.has(c.viaId.toString()));
  if (exactVia) return exactVia;
  const direct = caps.find((c) => !c.viaId);
  if (direct) return direct;
  // Road not specified: use the most permissive published cap for the pair.
  return caps.reduce((max, c) => (c.capRwf > max.capRwf ? c : max));
}

export async function capForRoute(route: {
  originId: Oid;
  destinationId: Oid;
  viaIds?: Oid[] | null;
  priceRwf: number;
}): Promise<{ capRwf: number | null; capStatus: CapStatus }> {
  const cap = await findCap(route.originId, route.destinationId, route.viaIds ?? []);
  const capRwf = cap?.capRwf ?? null;
  return { capRwf, capStatus: capStatusFor(route.priceRwf, capRwf) };
}

/** Rejects the price when the platform blocks above-cap fares. Returns the computed cap otherwise. */
export async function assertPriceAllowed(route: {
  originId: Oid;
  destinationId: Oid;
  viaIds?: Oid[] | null;
  priceRwf: number;
}): Promise<{ capRwf: number | null; capStatus: CapStatus }> {
  const result = await capForRoute(route);
  const settings = await getSettings();
  if (result.capStatus === "above_cap" && settings.fareCapEnforcement === "block") {
    throw badRequest("FARE_ABOVE_CAP", { capRwf: result.capRwf });
  }
  return result;
}

/** Recomputes cap snapshots for a route and its future trips; alerts admins on new violations. */
export async function refreshRouteCap(routeId: Oid, alert = true): Promise<void> {
  const route = await RouteModel.findById(routeId);
  if (!route) return;
  const before = route.capStatus;
  const { capRwf, capStatus } = await capForRoute(route);
  route.capRwf = capRwf;
  route.capStatus = capStatus;
  await route.save();
  await TripModel.updateMany(
    { routeId: route._id, departureAt: { $gt: new Date() }, status: "scheduled" },
    { $set: { capRwf } },
  );
  if (alert && capStatus === "above_cap" && before !== "above_cap" && capRwf != null) {
    await ensureLookups();
    const routeName = `${loc(route.originId).name} → ${loc(route.destinationId).name}`;
    const vars = { route: routeName, price: formatRwf(route.priceRwf), cap: formatRwf(capRwf), operator: op(route.operatorId).name };
    await notifyAdmins("farecap.violation", { title: "notifications.capViolationTitle", body: "notifications.capViolationBody" }, vars, {
      routeId: route._id.toString(),
    });
    await notifyOperatorStaff(
      route.operatorId,
      "farecap.violation",
      { title: "notifications.capViolationTitle", body: "notifications.capViolationBody" },
      vars,
      { routeId: route._id.toString() },
    );
  }
}

export async function refreshCapsForPair(originId: Oid, destinationId: Oid): Promise<void> {
  const routes = await RouteModel.find(
    {
      $or: [
        { originId, destinationId },
        { originId: destinationId, destinationId: originId },
      ],
    },
    { _id: 1 },
  ).lean();
  for (const r of routes) await refreshRouteCap(r._id);
}

export async function refreshAllRouteCaps(): Promise<void> {
  const routes = await RouteModel.find({}, { _id: 1 }).lean();
  for (const r of routes) await refreshRouteCap(r._id, false);
}

// ── CSV import (manual fallback when RURA data can't be fetched automatically) ──

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === "," || ch === ";") {
      out.push(cur.trim());
      cur = "";
    } else cur += ch;
  }
  out.push(cur.trim());
  return out;
}

async function resolveOrCreateLocation(name: string) {
  const existing =
    (await findLocation(slugify(name))) ??
    (await LocationModel.findOne({ aliases: name.trim().toUpperCase() }).lean().then((l) => (l ? { id: l._id.toString() } : null)));
  if (existing) return new Types.ObjectId(existing.id);
  const pretty = name
    .trim()
    .toLowerCase()
    .replace(/\b\p{L}/gu, (c) => c.toUpperCase());
  const created = await LocationModel.create({
    name: pretty,
    slug: slugify(pretty),
    aliases: [name.trim().toUpperCase()],
    isStation: false,
  });
  invalidateLookups();
  return created._id;
}

export async function importCapsCsv(text: string): Promise<{ imported: number; errors: string[] }> {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== "");
  if (lines.length === 0) return { imported: 0, errors: ["Empty file"] };
  const header = parseCsvLine(lines[0]).map((h) => h.toLowerCase());
  const col = (name: string) => header.indexOf(name);
  const iOrigin = col("origin");
  const iDest = col("destination");
  const iCap = col("cap_rwf") >= 0 ? col("cap_rwf") : col("cap");
  if (iOrigin < 0 || iDest < 0 || iCap < 0) {
    return { imported: 0, errors: ["Header must include origin, destination and cap_rwf"] };
  }
  const iVia = col("via");
  const iFrom = col("effective_from");
  const iDistance = col("distance_km");
  let imported = 0;
  const errors: string[] = [];
  const touched = new Set<string>();

  for (let n = 1; n < lines.length; n++) {
    const cells = parseCsvLine(lines[n]);
    const cap = Number(String(cells[iCap] ?? "").replace(/[^\d.]/g, ""));
    if (!cells[iOrigin] || !cells[iDest] || !Number.isFinite(cap) || cap <= 0) {
      errors.push(`Line ${n + 1}: missing origin, destination or cap`);
      continue;
    }
    const originId = await resolveOrCreateLocation(cells[iOrigin]);
    const destinationId = await resolveOrCreateLocation(cells[iDest]);
    const viaId = iVia >= 0 && cells[iVia] ? await resolveOrCreateLocation(cells[iVia]) : null;
    const effectiveFrom = iFrom >= 0 && cells[iFrom] ? new Date(cells[iFrom]) : new Date();
    const distanceKm = iDistance >= 0 && cells[iDistance] ? Number(cells[iDistance]) : null;
    await FareCapModel.updateOne(
      { originId, destinationId, viaId },
      {
        $set: {
          capRwf: Math.round(cap),
          effectiveFrom: Number.isNaN(effectiveFrom.getTime()) ? new Date() : effectiveFrom,
          distanceKm: Number.isFinite(distanceKm) ? distanceKm : null,
          source: "import",
        },
      },
      { upsert: true },
    );
    touched.add(`${originId}|${destinationId}`);
    imported++;
  }
  for (const pair of touched) {
    const [o, d] = pair.split("|");
    await refreshCapsForPair(o, d);
  }
  return { imported, errors };
}
