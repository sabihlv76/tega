"use client";

import { Keyboard, LayoutGrid, MonitorPlay, Package, ScanLine } from "lucide-react";
import type { ReactNode } from "react";
import { PortalShell } from "@/components/portal/shell";
import { RoleGate } from "@/components/role-gate";
import { Alert } from "@/components/ui/feedback";
import { useAuth } from "@/lib/auth";
import { useT } from "@/lib/i18n";

function StationFrame({ children }: { children: ReactNode }) {
  const t = useT();
  const { user } = useAuth();
  const items = [
    { href: "/station", label: t("station.nav.dashboard"), icon: LayoutGrid },
    { href: "/station/scan", label: t("station.nav.scan"), icon: ScanLine },
    { href: "/station/checkin", label: t("station.nav.checkin"), icon: Keyboard },
    { href: "/station/parcels", label: t("station.nav.parcels"), icon: Package },
    { href: "/station/board", label: t("station.nav.board"), icon: MonitorPlay },
  ];
  return (
    <PortalShell
      brandLabel={t("portal.stationName")}
      root="/station"
      items={items}
      orgName={user?.station?.name ?? "FIKA"}
      orgSubtitle={user?.name ?? undefined}
    >
      {user?.station ? children : <Alert tone="warning" title={t("station.noStation")} />}
    </PortalShell>
  );
}

export default function StationLayout({ children }: { children: ReactNode }) {
  return (
    <RoleGate roles={["station"]}>
      <StationFrame>{children}</StationFrame>
    </RoleGate>
  );
}
