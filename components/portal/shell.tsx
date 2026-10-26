"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { LucideIcon } from "lucide-react";
import { Bell, LogOut, Menu as MenuIcon, Smartphone, X } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Dialog as D } from "radix-ui";
import { type ReactNode, useState } from "react";
import { LanguageSwitcher } from "@/components/language-switcher";
import { Avatar } from "@/components/ui/avatar";
import { Menu, MenuItem, MenuLabel } from "@/components/ui/menu";
import { apiFetch } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { relativeTime } from "@/lib/format";
import { useT } from "@/lib/i18n";
import { useSocketEvent } from "@/lib/socket";
import { cn } from "@/lib/utils";
import type { NotificationDTO } from "@/shared/types";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
}

function isActive(pathname: string, href: string, root: string): boolean {
  return href === root ? pathname === root : pathname === href || pathname.startsWith(`${href}/`);
}

function SidebarNav({
  brandLabel,
  items,
  settings,
  root,
  footer,
  onNavigate,
}: {
  brandLabel: string;
  items: NavItem[];
  settings?: NavItem;
  root: string;
  footer: ReactNode;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const link = (item: NavItem) => {
    const active = isActive(pathname, item.href, root);
    const Icon = item.icon;
    return (
      <li key={item.href}>
        <Link
          href={item.href}
          onClick={onNavigate}
          aria-current={active ? "page" : undefined}
          className={cn(
            "flex items-center gap-3 rounded-card px-4 py-3 text-[15px] transition-colors",
            active ? "bg-white/12 font-medium text-white" : "text-neutral-400 hover:bg-white/5 hover:text-white",
          )}
        >
          <Icon className="size-5" aria-hidden />
          {item.label}
        </Link>
      </li>
    );
  };
  return (
    <div className="flex h-full flex-col bg-ink text-white">
      <div className="px-6 pb-6 pt-7">
        <Link href={root} onClick={onNavigate} className="block">
          <span className="block text-2xl font-bold tracking-tight">FIKA</span>
          <span className="block text-xs font-medium uppercase tracking-[0.2em] text-neutral-400">{brandLabel}</span>
        </Link>
      </div>
      <nav className="flex-1 overflow-y-auto px-3" aria-label={brandLabel}>
        <ul className="space-y-1">{items.map(link)}</ul>
      </nav>
      <div className="px-3 pb-3">{settings ? <ul>{link(settings)}</ul> : null}</div>
      <div className="mx-6 border-t border-white/10 py-4">{footer}</div>
    </div>
  );
}

function StaffNotifications() {
  const t = useT();
  const queryClient = useQueryClient();
  const { data } = useQuery({ queryKey: ["notifications"], queryFn: () => apiFetch<NotificationDTO[]>("/me/notifications") });
  useSocketEvent<NotificationDTO>("notification.new", () => void queryClient.invalidateQueries({ queryKey: ["notifications"] }));
  const unread = (data ?? []).filter((n) => !n.readAt);
  return (
    <Menu
      trigger={
        <button
          type="button"
          aria-label={t("common.notifications")}
          className="relative flex size-10 items-center justify-center rounded-card border border-line bg-paper hover:bg-subtle"
          onClick={() => {
            if (unread.length) void apiFetch("/me/notifications/read", { method: "POST", body: {} }).then(() => queryClient.invalidateQueries({ queryKey: ["notifications"] }));
          }}
        >
          <Bell className="size-5" aria-hidden />
          {unread.length ? <span className="absolute right-2 top-2 size-2 rounded-full bg-error" /> : null}
        </button>
      }
    >
      <MenuLabel>{t("common.notifications")}</MenuLabel>
      <div className="max-h-80 w-80 overflow-y-auto">
        {(data ?? []).slice(0, 12).map((n) => (
          <div key={n.id} className="border-b border-line px-3 py-2.5 last:border-b-0">
            <p className="text-sm font-semibold">{n.title}</p>
            <p className="text-sm text-muted">{n.body}</p>
            <p className="mt-0.5 text-xs text-faint">{relativeTime(n.createdAt, t)}</p>
          </div>
        ))}
        {!data?.length ? <p className="px-3 py-4 text-sm text-muted">{t("notificationsPage.empty")}</p> : null}
      </div>
    </Menu>
  );
}

/** Operator portal and admin dashboard frame (desktop sidebar 240px, drawer on smaller screens). */
export function PortalShell({
  brandLabel,
  root,
  items,
  settings,
  orgName,
  orgSubtitle,
  banner,
  children,
}: {
  brandLabel: string;
  root: string;
  items: NavItem[];
  settings?: NavItem;
  orgName: string;
  orgSubtitle?: string;
  banner?: ReactNode;
  children: ReactNode;
}) {
  const t = useT();
  const router = useRouter();
  const { user, signOut } = useAuth();
  const [drawer, setDrawer] = useState(false);

  const footer = (
    <div className="flex items-center gap-3">
      <Avatar name={orgName} inverse />
      <div className="min-w-0">
        <p className="truncate text-[15px] font-semibold">{orgName}</p>
        {orgSubtitle ? <p className="truncate text-sm text-neutral-400">{orgSubtitle}</p> : null}
      </div>
    </div>
  );

  return (
    <div className="min-h-dvh bg-canvas">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 lg:block">
        <SidebarNav brandLabel={brandLabel} items={items} settings={settings} root={root} footer={footer} />
      </aside>

      <D.Root open={drawer} onOpenChange={setDrawer}>
        <D.Portal>
          <D.Overlay className="fixed inset-0 z-40 bg-black/40 lg:hidden" />
          <D.Content className="fixed inset-y-0 left-0 z-50 w-72 max-w-[85vw] focus:outline-none lg:hidden">
            <D.Title className="sr-only">{brandLabel}</D.Title>
            <D.Description className="sr-only">{brandLabel}</D.Description>
            <SidebarNav brandLabel={brandLabel} items={items} settings={settings} root={root} footer={footer} onNavigate={() => setDrawer(false)} />
            <D.Close className="absolute right-3 top-6 flex size-9 items-center justify-center rounded-card text-white hover:bg-white/10" aria-label={t("nav.closeMenu")}>
              <X className="size-5" aria-hidden />
            </D.Close>
          </D.Content>
        </D.Portal>
      </D.Root>

      <div className="lg:pl-60">
        <header className="sticky top-0 z-20 flex h-16 items-center justify-between gap-3 border-b border-line bg-paper/95 px-4 backdrop-blur sm:px-6 lg:px-10">
          <div className="flex items-center gap-3">
            <button
              type="button"
              className="flex size-10 items-center justify-center rounded-card hover:bg-subtle lg:hidden"
              onClick={() => setDrawer(true)}
              aria-label={t("nav.openMenu")}
            >
              <MenuIcon className="size-5" aria-hidden />
            </button>
            <span className="font-semibold lg:hidden">FIKA</span>
          </div>
          <div className="flex items-center gap-2">
            <StaffNotifications />
            <LanguageSwitcher />
            <Menu
              trigger={
                <button type="button" className="rounded-full" aria-label={user?.name ?? t("nav.profile")}>
                  <Avatar name={user?.name} />
                </button>
              }
            >
              <MenuLabel>{user?.name ?? user?.phone ?? ""}</MenuLabel>
              <MenuItem onSelect={() => router.push("/")} icon={<Smartphone aria-hidden />}>
                {t("portal.openApp")}
              </MenuItem>
              <MenuItem
                danger
                icon={<LogOut aria-hidden />}
                onSelect={async () => {
                  await signOut();
                  router.push("/auth/login");
                }}
              >
                {t("common.signOut")}
              </MenuItem>
            </Menu>
          </div>
        </header>
        {banner}
        <main id="main" className="mx-auto max-w-[1440px] px-4 py-8 sm:px-6 lg:px-10">
          {children}
        </main>
      </div>
    </div>
  );
}
