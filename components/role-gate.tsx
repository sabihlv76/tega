"use client";

import { ShieldAlert } from "lucide-react";
import type { ReactNode } from "react";
import { useAuth, useRequireAuth } from "@/lib/auth";
import { useT } from "@/lib/i18n";
import { homeForRole } from "@/lib/utils";
import type { Role } from "@/shared/constants";
import { Button, ButtonLink } from "./ui/button";
import { PageLoader } from "./ui/feedback";

/** Renders children only for signed-in users with one of `roles`; the API enforces the same rules. */
export function RoleGate({ roles, children }: { roles?: Role[]; children: ReactNode }) {
  const t = useT();
  const { signOut } = useAuth();
  const { ready, allowed, user } = useRequireAuth(roles);
  if (!ready) return <PageLoader label={t("portal.loadingPortal")} />;
  if (!allowed) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-canvas p-6">
        <div className="w-full max-w-sm rounded-card border border-line bg-paper p-8 text-center">
          <ShieldAlert className="mx-auto size-10 text-muted" aria-hidden />
          <h1 className="mt-4 text-xl font-semibold">{t("auth.noAccessTitle")}</h1>
          <p className="mt-2 text-sm text-muted">{t("auth.noAccessBody")}</p>
          <div className="mt-6 flex flex-col gap-2">
            <ButtonLink href={homeForRole(user?.role)} block>
              {t("auth.goHome")}
            </ButtonLink>
            <Button variant="outline" block onClick={() => void signOut()}>
              {t("auth.switchAccount")}
            </Button>
          </div>
        </div>
      </div>
    );
  }
  return <>{children}</>;
}
