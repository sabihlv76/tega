import type { Types } from "mongoose";
import type { LocationDTO, LocationLite, OperatorLite } from "../../shared/types";
import { LocationModel, OperatorModel } from "../models";

// Locations (a few hundred) and operators (dozens) are read on almost every request. They are kept
// in a short-lived in-memory cache so serializers can resolve names synchronously.

type Id = Types.ObjectId | string | null | undefined;

interface Cache {
  locations: Map<string, LocationDTO>;
  operators: Map<string, OperatorLite & { status: string }>;
  at: number;
}

const TTL_MS = 30_000;
let cache: Cache | null = null;
let loading: Promise<Cache> | null = null;

async function load(): Promise<Cache> {
  const [locations, operators] = await Promise.all([
    LocationModel.find({}).lean(),
    OperatorModel.find({}, { name: 1, slug: 1, status: 1 }).lean(),
  ]);
  return {
    locations: new Map(
      locations.map((l) => [
        l._id.toString(),
        {
          id: l._id.toString(),
          slug: l.slug,
          name: l.name,
          isStation: l.isStation,
          district: l.district ?? null,
          province: l.province ?? null,
          aliases: l.aliases ?? [],
          active: l.active,
        },
      ]),
    ),
    operators: new Map(
      operators.map((o) => [o._id.toString(), { id: o._id.toString(), name: o.name, slug: o.slug, status: o.status }]),
    ),
    at: Date.now(),
  };
}

export async function ensureLookups(): Promise<void> {
  if (cache && Date.now() - cache.at < TTL_MS) return;
  loading ??= load().finally(() => {
    loading = null;
  });
  cache = await loading;
}

export function invalidateLookups(): void {
  cache = null;
}

const UNKNOWN_LOCATION: LocationLite = { id: "", slug: "", name: "—" };

export function loc(id: Id): LocationLite {
  if (!id || !cache) return UNKNOWN_LOCATION;
  const l = cache.locations.get(id.toString());
  return l ? { id: l.id, slug: l.slug, name: l.name } : UNKNOWN_LOCATION;
}

export function locOrNull(id: Id): LocationLite | null {
  return id ? loc(id) : null;
}

export function locFull(id: Id): LocationDTO | null {
  if (!id || !cache) return null;
  return cache.locations.get(id.toString()) ?? null;
}

export function allLocations(): LocationDTO[] {
  return cache ? [...cache.locations.values()] : [];
}

export function op(id: Id): OperatorLite {
  if (!id || !cache) return { id: "", name: "—", slug: "" };
  const o = cache.operators.get(id.toString());
  return o ? { id: o.id, name: o.name, slug: o.slug } : { id: id.toString(), name: "—", slug: "" };
}

/** Resolve a location by id or slug. */
export async function findLocation(idOrSlug: string): Promise<LocationDTO | null> {
  await ensureLookups();
  if (!cache) return null;
  const byId = cache.locations.get(idOrSlug);
  if (byId) return byId;
  const lower = idOrSlug.toLowerCase();
  for (const l of cache.locations.values()) if (l.slug === lower) return l;
  return null;
}
