"use client";

import { Banknote, Bus, CalendarCheck, Clock, LayoutGrid, Package, Route, Settings, TrendingUp } from "lucide-react";
import type { ReactNode } from "react";
import { PortalShell } from "@/components/portal/shell";
import { RoleGate } from "@/components/role-gate";
import { useAuth } from "@/lib/auth";
import { useT } from "@/lib/i18n";

function OperatorFrame({ children }: { children: ReactNode }) {
  const t = useT();
  const { user } = useAuth();
  const status = user?.operator?.status;
  const items = [
    { href: "/operator", label: t("operator.nav.dashboard"), icon: LayoutGrid },
    { href: "/operator/routes", label: t("operator.nav.routes"), icon: Route },
    { href: "/operator/vehicles", label: t("operator.nav.vehicles"), icon: Bus },
    { href: "/operator/schedule", label: t("operator.nav.schedule"), icon: Clock },
    { href: "/operator/bookings", label: t("operator.nav.bookings"), icon: CalendarCheck },
    { href: "/operator/parcels", label: t("operator.nav.parcels"), icon: Package },
    { href: "/operator/pricing", label: t("operator.nav.pricing"), icon: Banknote },
    { href: "/operator/revenue", label: t("operator.nav.revenue"), icon: TrendingUp },
  ];
  const banner =
    status === "pending" ? (
      <div className="border-b border-amber-200 bg-warning-soft px-4 py-3 text-sm sm:px-6 lg:px-10">
        <strong className="font-semibold text-warning-ink">{t("portal.pendingApprovalTitle")}.</strong>{" "}
        <span className="text-muted">{t("portal.pendingApprovalBody")}</span>
      </div>
    ) : status === "suspended" || status === "rejected" ? (
      <div className="border-b border-red-200 bg-error-soft px-4 py-3 text-sm sm:px-6 lg:px-10">
        <strong className="font-semibold text-error-ink">{t("portal.suspendedTitle")}.</strong>{" "}
        <span className="text-muted">{t("portal.suspendedBody")}</span>
      </div>
    ) : null;
  return (
    <PortalShell
      brandLabel={t("portal.operatorName")}
      root="/operator"
      items={items}
      settings={{ href: "/operator/settings", label: t("operator.nav.settings"), icon: Settings }}
      orgName={user?.operator?.name ?? "—"}
      orgSubtitle={user?.name ?? undefined}
      banner={banner}
    >
      {children}
    </PortalShell>
  );
}

export default function OperatorLayout({ children }: { children: ReactNode }) {
  return (
    <RoleGate roles={["operator"]}>
      <OperatorFrame>{children}</OperatorFrame>
    </RoleGate>
  );
}
