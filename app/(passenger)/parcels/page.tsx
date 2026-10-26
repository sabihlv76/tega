"use client";

import { useQuery } from "@tanstack/react-query";
import { ChevronRight, Package, PackagePlus, Search } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { PassengerShell, SectionLabel } from "@/components/passenger/shell";
import { StatusBadge } from "@/components/status";
import { Button } from "@/components/ui/button";
import { EmptyState, Skeleton } from "@/components/ui/feedback";
import { apiFetch } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { formatDate } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import { formatRwf } from "@/shared/money";
import type { ParcelDTO } from "@/shared/types";

export default function ParcelsPage() {
  const { t, locale } = useI18n();
  const router = useRouter();
  const { status } = useAuth();
  const [code, setCode] = useState("");
  const { data, isLoading } = useQuery({
    queryKey: ["parcels"],
    queryFn: () => apiFetch<ParcelDTO[]>("/parcels"),
    enabled: status === "authenticated",
  });

  return (
    <PassengerShell>
      <h1 className="mb-6 mt-4 text-3xl font-bold tracking-tight">{t("parcels.title")}</h1>

      <Link href="/parcels/send" className="flex items-center gap-4 rounded-2xl bg-ink p-5 text-white">
        <span className="flex size-12 items-center justify-center rounded-xl bg-white/10">
          <PackagePlus className="size-6" aria-hidden />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-lg font-semibold">{t("parcels.sendTitle")}</span>
          <span className="block text-sm text-neutral-300">{t("parcels.sendSubtitle")}</span>
        </span>
        <ChevronRight className="size-5" aria-hidden />
      </Link>

      <form
        className="mt-6"
        onSubmit={(e) => {
          e.preventDefault();
          if (code.trim()) router.push(`/parcels/track?code=${encodeURIComponent(code.trim().toUpperCase())}`);
        }}
      >
        <SectionLabel>
          <label htmlFor="track-code">{t("parcels.track")}</label>
        </SectionLabel>
        <div className="flex gap-2">
          <input
            id="track-code"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder={t("parcels.trackPlaceholder")}
            className="h-12 min-w-0 flex-1 rounded-2xl bg-canvas px-4 text-[15px] uppercase placeholder:normal-case placeholder:text-faint focus:outline-none focus:ring-2 focus:ring-black/10"
          />
          <Button type="submit" size="lg" className="rounded-2xl" aria-label={t("parcels.trackButton")}>
            <Search aria-hidden />
          </Button>
        </div>
      </form>

      {status === "authenticated" ? (
        <section className="mt-8">
          <SectionLabel>{t("parcels.myParcels")}</SectionLabel>
          {isLoading ? (
            <div className="space-y-3">
              <Skeleton className="h-20" />
              <Skeleton className="h-20" />
            </div>
          ) : !data?.length ? (
            <EmptyState icon={<Package className="size-5" />} title={t("parcels.empty")} />
          ) : (
            <ul className="space-y-3">
              {data.map((p) => (
                <li key={p.id}>
                  <Link href={`/parcels/${p.code}`} className="block rounded-2xl bg-canvas p-4 hover:bg-subtle">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-mono text-sm text-muted">{p.code}</p>
                        <p className="truncate font-semibold">
                          {p.origin.name} → {p.destination.name}
                        </p>
                        <p className="text-sm text-muted">
                          {p.receiver.name} · {formatDate(p.createdAt, locale)}
                        </p>
                      </div>
                      <div className="flex shrink-0 flex-col items-end gap-1">
                        <StatusBadge kind="parcel" status={p.status} />
                        <span className="text-sm font-semibold tabular">{formatRwf(p.priceRwf)}</span>
                      </div>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}
    </PassengerShell>
  );
}
