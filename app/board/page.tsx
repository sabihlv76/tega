"use client";

import { useQuery } from "@tanstack/react-query";
import { ChevronRight, MonitorPlay } from "lucide-react";
import Link from "next/link";
import { Logo } from "@/components/brand";
import { EmptyState, PageLoader } from "@/components/ui/feedback";
import { apiFetch } from "@/lib/api";
import { useT } from "@/lib/i18n";
import type { LocationDTO } from "@/shared/types";

export default function BoardIndexPage() {
  const t = useT();
  const { data, isLoading } = useQuery({ queryKey: ["stations"], queryFn: () => apiFetch<LocationDTO[]>("/stations"), staleTime: 300_000 });
  return (
    <main className="mx-auto min-h-dvh max-w-xl px-4 py-8">
      <Logo />
      <h1 className="mt-8 text-2xl font-bold tracking-tight">{t("station.board.title")}</h1>
      <p className="mt-1 text-muted">{t("station.board.pickStation")}</p>
      {isLoading ? (
        <PageLoader />
      ) : !data?.length ? (
        <EmptyState icon={<MonitorPlay className="size-5" />} title={t("common.noResults")} />
      ) : (
        <ul className="mt-6 divide-y divide-line rounded-card border border-line bg-paper">
          {data.map((s) => (
            <li key={s.id}>
              <Link href={`/board/${s.slug}`} className="flex items-center gap-3 px-4 py-4 hover:bg-canvas">
                <MonitorPlay className="size-5 text-muted" aria-hidden />
                <span className="flex-1 font-medium">{s.name}</span>
                <ChevronRight className="size-4 text-muted" aria-hidden />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
