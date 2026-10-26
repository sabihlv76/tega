"use client";

import { Maximize2 } from "lucide-react";
import { DepartureBoard } from "@/components/board";
import { ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useAuth } from "@/lib/auth";
import { useT } from "@/lib/i18n";

export default function StationBoardPage() {
  const t = useT();
  const { user } = useAuth();
  if (!user?.station) return null;
  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <ButtonLink href={`/board/${user.station.slug}`} target="_blank" rel="noopener" variant="outline">
          <Maximize2 aria-hidden />
          {t("station.board.fullscreen")}
        </ButtonLink>
      </div>
      <Card className="p-5 sm:p-8">
        <DepartureBoard station={user.station.id} variant="light" />
      </Card>
    </div>
  );
}
