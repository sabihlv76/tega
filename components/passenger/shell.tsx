"use client";

import { ArrowLeft, Bell, Home, Package, ReceiptText, User } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Logo } from "@/components/brand";
import { LanguageSwitcher } from "@/components/language-switcher";
import { apiFetch } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useT } from "@/lib/i18n";
import { useSocketEvent } from "@/lib/socket";
import { cn } from "@/lib/utils";
import type { NotificationDTO } from "@/shared/types";

const NAV = [
  { href: "/", key: "nav.home", icon: Home },
  { href: "/bookings", key: "nav.bookings", icon: ReceiptText },
  { href: "/parcels", key: "nav.parcel", icon: Package },
  { href: "/profile", key: "nav.profile", icon: User },
] as const;

function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

function NotificationsBell() {
  const t = useT();
  const { status } = useAuth();
  const { data, refetch } = useQuery({
    queryKey: ["notifications"],
    queryFn: () => apiFetch<NotificationDTO[]>("/me/notifications"),
    enabled: status === "authenticated",
  });
  useSocketEvent("notification.new", () => void refetch(), status === "authenticated");
  if (status !== "authenticated") return null;
  const unread = (data ?? []).filter((n) => !n.readAt).length;
  return (
    <Link
      href="/notifications"
      aria-label={t("common.notifications")}
      className="relative flex size-10 items-center justify-center rounded-full hover:bg-subtle"
    >
      <Bell className="size-5" aria-hidden />
      {unread > 0 ? <span className="absolute right-2 top-2 size-2.5 rounded-full border-2 border-paper bg-error" /> : null}
    </Link>
  );
}

/** Top-level passenger screens: logo header + bottom tab bar (Home · Bookings · Parcel · Profile). */
export function PassengerShell({ children, hideHeader }: { children: ReactNode; hideHeader?: boolean }) {
  const t = useT();
  const pathname = usePathname();
  return (
    <div className="flex min-h-dvh flex-col">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-card focus:bg-ink focus:px-3 focus:py-2 focus:text-white">
        {t("nav.skipToContent")}
      </a>
      {hideHeader ? null : (
        <header className="flex items-center justify-between px-6 pb-2 pt-5">
          <Logo />
          <div className="flex items-center gap-1">
            <NotificationsBell />
            <LanguageSwitcher />
          </div>
        </header>
      )}
      <main id="main" className="flex-1 px-6 pb-28">
        {children}
      </main>
      <nav
        aria-label="Main"
        className="fixed inset-x-0 bottom-0 z-40 mx-auto max-w-xl border-t border-line bg-paper/95 backdrop-blur safe-bottom"
      >
        <ul className="grid grid-cols-4">
          {NAV.map(({ href, key, icon: Icon }) => {
            const active = isActive(pathname, href);
            return (
              <li key={href}>
                <Link
                  href={href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "flex flex-col items-center gap-1 py-3 text-xs font-medium transition-colors",
                    active ? "text-ink" : "text-faint hover:text-muted",
                  )}
                >
                  <Icon className="size-6" strokeWidth={active ? 2.2 : 1.8} aria-hidden />
                  {t(key)}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </div>
  );
}

/** Sub-screen header with a back arrow, as in the booking flow designs. */
export function FlowHeader({
  title,
  subtitle,
  backHref,
  action,
  className,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  backHref?: string;
  action?: ReactNode;
  className?: string;
}) {
  const t = useT();
  const router = useRouter();
  return (
    <header className={cn("sticky top-0 z-30 flex items-center gap-3 border-b border-line bg-paper/95 px-4 py-3 backdrop-blur", className)}>
      <button
        type="button"
        onClick={() => (backHref ? router.push(backHref) : router.back())}
        aria-label={t("common.back")}
        className="flex size-10 shrink-0 items-center justify-center rounded-full hover:bg-subtle"
      >
        <ArrowLeft className="size-6" aria-hidden />
      </button>
      <div className="min-w-0 flex-1">
        <h1 className="truncate text-lg font-semibold">{title}</h1>
        {subtitle ? <p className="truncate text-sm text-muted">{subtitle}</p> : null}
      </div>
      {action}
    </header>
  );
}

/** Sticky bottom action area for flow screens ("Continue to payment", "Pay 3,500 RWF"). */
export function StickyAction({ children }: { children: ReactNode }) {
  return (
    <div className="fixed inset-x-0 bottom-0 z-30 mx-auto max-w-xl border-t border-line bg-paper px-6 pb-4 pt-3 safe-bottom">
      {children}
    </div>
  );
}

/** Small uppercase section label ("TRAVELER DETAILS", "POPULAR ROUTES"). */
export function SectionLabel({ children, className }: { children: ReactNode; className?: string }) {
  return <h2 className={cn("mb-3 text-sm font-semibold uppercase tracking-wide text-faint", className)}>{children}</h2>;
}
