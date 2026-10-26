"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { PackageSearch } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { ParcelTimeline } from "@/components/passenger/parcel";
import { FlowHeader } from "@/components/passenger/shell";
import { StatusBadge } from "@/components/status";
import { Button } from "@/components/ui/button";
import { EmptyState, PageLoader } from "@/components/ui/feedback";
import { apiFetch } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { useSocketEvent, useSocketRooms } from "@/lib/socket";
import type { ParcelDTO } from "@/shared/types";

function Track() {
  const t = useT();
  const router = useRouter();
  const params = useSearchParams();
  const queryClient = useQueryClient();
  const code = (params.get("code") ?? "").toUpperCase();
  const [input, setInput] = useState(code);

  const { data, isLoading, isError } = useQuery({
    queryKey: ["track", code],
    queryFn: () => apiFetch<ParcelDTO>(`/parcels/track/${encodeURIComponent(code)}`),
    enabled: /^FP-[0-9A-Z]{8}$/.test(code),
    retry: false,
  });
  useSocketRooms(data ? [`parcel:${data.code}`] : []);
  useSocketEvent<ParcelDTO>("parcel.updated", (p) => {
    if (p.code === code) queryClient.setQueryData(["track", code], p);
  });

  return (
    <div className="min-h-dvh pb-10">
      <FlowHeader title={t("parcels.track")} backHref="/parcels" />
      <main className="space-y-6 px-6 py-6">
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            router.replace(`/parcels/track?code=${encodeURIComponent(input.trim().toUpperCase())}`);
          }}
        >
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={t("parcels.trackPlaceholder")}
            aria-label={t("parcels.trackingCode")}
            className="h-12 min-w-0 flex-1 rounded-2xl bg-canvas px-4 font-mono uppercase placeholder:font-sans placeholder:normal-case placeholder:text-faint focus:outline-none focus:ring-2 focus:ring-black/10"
          />
          <Button type="submit" size="lg" className="rounded-2xl">
            {t("parcels.trackButton")}
          </Button>
        </form>

        {!code ? null : isLoading ? (
          <PageLoader />
        ) : isError || !data ? (
          <EmptyState icon={<PackageSearch className="size-5" />} title={t("parcels.notFound")} />
        ) : (
          <section className="space-y-6">
            <div className="rounded-2xl bg-canvas p-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-mono text-sm text-muted">{data.code}</p>
                  <p className="mt-1 text-lg font-semibold">
                    {data.origin.name} → {data.destination.name}
                  </p>
                  <p className="text-[15px] text-muted">
                    {data.operator.name} · {data.receiver.name}
                  </p>
                </div>
                <StatusBadge kind="parcel" status={data.status} />
              </div>
            </div>
            <div>
              <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-faint">{t("parcels.timeline")}</h2>
              <ParcelTimeline parcel={data} />
            </div>
          </section>
        )}
      </main>
    </div>
  );
}

export default function TrackPage() {
  return (
    <Suspense fallback={<PageLoader />}>
      <Track />
    </Suspense>
  );
}
