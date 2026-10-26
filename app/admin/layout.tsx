"use client";

import { Building2, FileSpreadsheet, Gauge, LayoutGrid, Route, Settings, TrendingUp, Users } from "lucide-react";
import type { ReactNode } from "react";
import { PortalShell } from "@/components/portal/shell";
import { RoleGate } from "@/components/role-gate";
import { useAuth } from "@/lib/auth";
import { useT } from "@/lib/i18n";

function AdminFrame({ children }: { children: ReactNode }) {
  const t = useT();
  const { user } = useAuth();
  const items = [
    { href: "/admin", label: t("admin.nav.dashboard"), icon: LayoutGrid },
    { href: "/admin/operators", label: t("admin.nav.operators"), icon: Building2 },
    { href: "/admin/routes", label: t("admin.nav.routes"), icon: Route },
    { href: "/admin/fare-caps", label: t("admin.nav.fareCaps"), icon: Gauge },
    { href: "/admin/users", label: t("admin.nav.users"), icon: Users },
    { href: "/admin/revenue", label: t("admin.nav.revenue"), icon: TrendingUp },
    { href: "/admin/reports", label: t("admin.nav.reports"), icon: FileSpreadsheet },
  ];
  return (
    <PortalShell
      brandLabel={t("portal.adminName")}
      root="/admin"
      items={items}
      settings={{ href: "/admin/settings", label: t("admin.nav.settings"), icon: Settings }}
      orgName="FIKA"
      orgSubtitle={user?.name ?? undefined}
    >
      {children}
    </PortalShell>
  );
}

export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <RoleGate roles={["admin"]}>
      <AdminFrame>{children}</AdminFrame>
    </RoleGate>
  );
}
