"use client";

import { Maximize2 } from "lucide-react";
import { useParams } from "next/navigation";
import { DepartureBoard } from "@/components/board";
import { useT } from "@/lib/i18n";

export default function PublicBoardPage() {
  const t = useT();
  const { station } = useParams<{ station: string }>();
  return (
    <main className="min-h-dvh bg-ink px-4 py-6 sm:px-10 sm:py-10">
      <DepartureBoard station={station} variant="dark" />
      <button
        type="button"
        onClick={() => void document.documentElement.requestFullscreen?.().catch(() => undefined)}
        className="fixed bottom-4 right-4 flex size-11 items-center justify-center rounded-card text-neutral-500 hover:bg-white/10 hover:text-white"
      >
        <Maximize2 className="size-5" aria-hidden />
        <span className="sr-only">{t("station.board.fullscreen")}</span>
      </button>
    </main>
  );
}
