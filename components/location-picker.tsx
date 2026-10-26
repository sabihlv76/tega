"use client";

import { useQuery } from "@tanstack/react-query";
import { Bus, MapPin, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { apiFetch } from "@/lib/api";
import { useT } from "@/lib/i18n";
import type { LocationDTO, LocationLite } from "@/shared/types";
import { Dialog } from "./ui/dialog";
import { EmptyState, Spinner } from "./ui/feedback";

export function useLocations() {
  return useQuery({
    queryKey: ["locations"],
    queryFn: () => apiFetch<LocationDTO[]>("/locations"),
    staleTime: 10 * 60_000,
  });
}

function normalise(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

/** Bottom-sheet picker for bus parks and stops, with search (old names like "Butare" also match). */
export function LocationPicker({
  open,
  onOpenChange,
  title,
  onSelect,
  exclude,
  stationsOnly,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  onSelect: (location: LocationLite) => void;
  exclude?: string | null;
  stationsOnly?: boolean;
}) {
  const t = useT();
  const { data, isLoading } = useLocations();
  const [query, setQuery] = useState("");

  const { stations, others } = useMemo(() => {
    const q = normalise(query.trim());
    const list = (data ?? []).filter(
      (l) =>
        l.active &&
        l.id !== exclude &&
        (!stationsOnly || l.isStation) &&
        (!q || normalise(l.name).includes(q) || l.aliases.some((a) => normalise(a).includes(q))),
    );
    return { stations: list.filter((l) => l.isStation), others: list.filter((l) => !l.isStation).slice(0, q ? 40 : 25) };
  }, [data, query, exclude, stationsOnly]);

  const pick = (l: LocationDTO) => {
    onSelect({ id: l.id, slug: l.slug, name: l.name });
    onOpenChange(false);
    setQuery("");
  };

  const row = (l: LocationDTO, icon: React.ReactNode) => (
    <li key={l.id}>
      <button
        type="button"
        onClick={() => pick(l)}
        className="flex w-full items-center gap-3 rounded-card px-2 py-3 text-left hover:bg-subtle"
      >
        <span className="flex size-9 shrink-0 items-center justify-center rounded-card bg-subtle text-ink">{icon}</span>
        <span className="min-w-0">
          <span className="block truncate text-[15px] font-medium">{l.name}</span>
          {l.district ? <span className="block truncate text-sm text-muted">{l.district}</span> : null}
        </span>
      </button>
    </li>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={title} side="sheet">
      <div className="relative mb-3">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden />
        <input
          // biome-ignore lint/a11y/noAutofocus: the picker exists to search
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("home.searchLocation")}
          aria-label={t("home.searchLocation")}
          className="h-12 w-full rounded-card bg-canvas pl-9 pr-3 text-[15px] placeholder:text-faint focus:outline-none focus:ring-2 focus:ring-black/10"
        />
      </div>
      {isLoading ? (
        <div className="py-8 text-center">
          <Spinner />
        </div>
      ) : stations.length + others.length === 0 ? (
        <EmptyState icon={<MapPin className="size-5" />} title={t("home.noLocations")} />
      ) : (
        <div className="space-y-4">
          {stations.length ? (
            <section>
              <h3 className="px-2 pb-1 text-xs font-semibold uppercase tracking-wide text-muted">{t("home.stations")}</h3>
              <ul>{stations.map((l) => row(l, <Bus className="size-4" aria-hidden />))}</ul>
            </section>
          ) : null}
          {others.length ? (
            <section>
              <h3 className="px-2 pb-1 text-xs font-semibold uppercase tracking-wide text-muted">{t("home.otherStops")}</h3>
              <ul>{others.map((l) => row(l, <MapPin className="size-4" aria-hidden />))}</ul>
            </section>
          ) : null}
        </div>
      )}
    </Dialog>
  );
}
