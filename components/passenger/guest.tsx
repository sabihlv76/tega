"use client";

import { LogIn } from "lucide-react";
import { usePathname } from "next/navigation";
import { ButtonLink } from "@/components/ui/button";
import { useT } from "@/lib/i18n";

/** Shown on passenger tabs that need an account (My trips, Profile) when nobody is signed in. */
export function GuestPrompt() {
  const t = useT();
  const pathname = usePathname();
  return (
    <div className="mt-10 rounded-2xl border border-line p-8 text-center">
      <LogIn className="mx-auto size-9 text-muted" aria-hidden />
      <h2 className="mt-4 text-xl font-semibold">{t("profile.guestTitle")}</h2>
      <p className="mt-1 text-[15px] text-muted">{t("profile.guestBody")}</p>
      <ButtonLink href={`/auth/login?next=${encodeURIComponent(pathname)}`} size="lg" className="mt-6">
        {t("common.signIn")}
      </ButtonLink>
    </div>
  );
}
