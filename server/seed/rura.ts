import { Types } from "mongoose";
import { slugify } from "../lib/crypto";
import { FareCapModel, LocationModel } from "../models";
import { invalidateLookups } from "../services/lookup";
import registry from "./data/rura-tariffs.json";

// Imports the RURA intercity tariff registry (537 fares on 8 corridors, carried over from the Tega
// MVP) as locations and fare caps. Names in the source contain typos and "via" variants; they are
// normalised here so "MUHANGAA" and "Muhanga" become one location.

interface RegistryCorridor {
  corridor: string;
  fares: { from: string; to: string; amount: number }[];
}

const TYPO_FIXES: Record<string, string> = {
  MUHANGAA: "MUHANGA",
  "MUHANGAVIA NGORORERO": "MUHANGA VIA NGORORERO",
  "CONGO NILE": "CONGO-NILE",
  BWEEYEE: "BWEEYEYE",
  "NYANZA (SOUTH)": "NYANZA",
};

/** Display names and search aliases for well-known places (old names help passengers search). */
const KNOWN: Record<string, { name: string; aliases: string[]; district: string; province: string; station: boolean }> = {
  NYABUGOGO: { name: "Kigali (Nyabugogo)", aliases: ["KIGALI", "NYABUGOGO"], district: "Nyarugenge", province: "Kigali City", station: true },
  MUSANZE: { name: "Musanze", aliases: ["RUHENGERI"], district: "Musanze", province: "Northern", station: true },
  HUYE: { name: "Huye", aliases: ["BUTARE"], district: "Huye", province: "Southern", station: true },
  RUBAVU: { name: "Rubavu", aliases: ["GISENYI"], district: "Rubavu", province: "Western", station: true },
  KARONGI: { name: "Karongi", aliases: ["KIBUYE"], district: "Karongi", province: "Western", station: true },
  MUHANGA: { name: "Muhanga", aliases: ["GITARAMA"], district: "Muhanga", province: "Southern", station: true },
  NYANZA: { name: "Nyanza", aliases: [], district: "Nyanza", province: "Southern", station: true },
  KAMEMBE: { name: "Rusizi (Kamembe)", aliases: ["RUSIZI", "CYANGUGU", "KAMEMBE"], district: "Rusizi", province: "Western", station: true },
  NYAGATARE: { name: "Nyagatare", aliases: [], district: "Nyagatare", province: "Eastern", station: true },
  RWAMAGANA: { name: "Rwamagana", aliases: [], district: "Rwamagana", province: "Eastern", station: true },
  KAYONZA: { name: "Kayonza", aliases: [], district: "Kayonza", province: "Eastern", station: true },
  NYAMAGABE: { name: "Nyamagabe", aliases: ["GIKONGORO"], district: "Nyamagabe", province: "Southern", station: true },
  NGOMA: { name: "Ngoma (Kibungo)", aliases: ["KIBUNGO"], district: "Ngoma", province: "Eastern", station: true },
  NYAMATA: { name: "Nyamata", aliases: ["BUGESERA"], district: "Bugesera", province: "Eastern", station: true },
  RUSUMO: { name: "Rusumo", aliases: [], district: "Kirehe", province: "Eastern", station: true },
  NGORORERO: { name: "Ngororero", aliases: [], district: "Ngororero", province: "Western", station: true },
  RUHANGO: { name: "Ruhango", aliases: [], district: "Ruhango", province: "Southern", station: true },
  NYAMASHEKE: { name: "Nyamasheke", aliases: [], district: "Nyamasheke", province: "Western", station: true },
  NYAKARAMBI: { name: "Nyakarambi (Kirehe)", aliases: ["KIREHE"], district: "Kirehe", province: "Eastern", station: true },
  "NYANZA (KICUKIRO)": { name: "Nyanza (Kicukiro)", aliases: ["KICUKIRO"], district: "Kicukiro", province: "Kigali City", station: false },
};

export function parsePlace(raw: string): { base: string; via: string | null } {
  let s = raw.trim().toUpperCase().replace(/\s+/g, " ");
  s = TYPO_FIXES[s] ?? s;
  s = s.replace(/\(\s*VIA\s+([^)]+)\)/, "VIA $1").trim();
  const m = /^(.*?)\s+VIA\s+(.+)$/.exec(s);
  const base = m ? m[1].trim() : s;
  const via = m ? m[2].trim() : null;
  return { base: TYPO_FIXES[base] ?? base, via: via ? (TYPO_FIXES[via] ?? via) : null };
}

export function displayName(key: string): string {
  if (KNOWN[key]) return KNOWN[key].name;
  return key.toLowerCase().replace(/(^|[\s(\-])(\p{L})/gu, (_m, sep: string, ch: string) => `${sep}${ch.toUpperCase()}`);
}

function cleanCorridor(name: string): string {
  return name.replace("IGYEREKEZO", "ICYEREKEZO").replace("MUHANGAG", "MUHANGA").replace(/\s+/g, " ").trim();
}

export async function importRuraRegistry(): Promise<{ locations: number; caps: number }> {
  const corridors = registry as RegistryCorridor[];
  const keys = new Set<string>();
  for (const c of corridors) {
    for (const f of c.fares) {
      for (const raw of [f.from, f.to]) {
        const { base, via } = parsePlace(raw);
        keys.add(base);
        if (via) keys.add(via);
      }
    }
  }

  const slugOf = (key: string) => slugify(key === "NYABUGOGO" ? "kigali" : key === "KAMEMBE" ? "rusizi" : displayName(key));
  await LocationModel.bulkWrite(
    [...keys].map((key) => {
      const known = KNOWN[key];
      const slug = slugOf(key);
      return {
        updateOne: {
          filter: { slug },
          update: {
            $setOnInsert: {
              name: displayName(key),
              slug,
              aliases: [...new Set([key, ...(known?.aliases ?? [])])],
              isStation: known?.station ?? false,
              district: known?.district ?? null,
              province: known?.province ?? null,
              active: true,
            },
          },
          upsert: true,
        },
      };
    }),
    { ordered: false },
  );
  const locations = await LocationModel.find({ slug: { $in: [...keys].map(slugOf) } }, { slug: 1 }).lean();
  const bySlug = new Map(locations.map((l) => [l.slug, l._id]));
  const ids = new Map<string, Types.ObjectId>();
  for (const key of keys) {
    const id = bySlug.get(slugOf(key));
    if (id) ids.set(key, id);
  }

  const ops = [];
  for (const c of corridors) {
    for (const f of c.fares) {
      const from = parsePlace(f.from);
      const to = parsePlace(f.to);
      const originId = ids.get(from.base);
      const destinationId = ids.get(to.base);
      if (!originId || !destinationId || originId.equals(destinationId)) continue;
      const viaKey = to.via ?? from.via;
      const viaId = viaKey ? (ids.get(viaKey) ?? null) : null;
      ops.push({
        updateOne: {
          filter: { originId, destinationId, viaId },
          update: {
            $set: { capRwf: f.amount, source: "rura_registry", corridor: cleanCorridor(c.corridor) },
            $setOnInsert: { effectiveFrom: new Date() },
          },
          upsert: true,
        },
      });
    }
  }
  if (ops.length) await FareCapModel.bulkWrite(ops, { ordered: false });
  invalidateLookups();
  return { locations: ids.size, caps: ops.length };
}
