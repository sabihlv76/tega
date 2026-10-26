"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, BellRing } from "lucide-react";
import Link from "next/link";
import { FlowHeader } from "@/components/passenger/shell";
import { RoleGate } from "@/components/role-gate";
import { Button } from "@/components/ui/button";
import { EmptyState, PageLoader } from "@/components/ui/feedback";
import { apiFetch } from "@/lib/api";
import { relativeTime } from "@/lib/format";
import { useT } from "@/lib/i18n";
import { useSocketEvent } from "@/lib/socket";
import { cn } from "@/lib/utils";
import type { NotificationDTO } from "@/shared/types";

function linkFor(n: NotificationDTO): string | null {
  const data = n.data ?? {};
  if (typeof data.reference === "string") return `/tickets/${data.reference}`;
  if (typeof data.code === "string") return `/parcels/${data.code}`;
  return null;
}

function Notifications() {
  const t = useT();
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["notifications"],
    queryFn: () => apiFetch<NotificationDTO[]>("/me/notifications"),
  });
  useSocketEvent<NotificationDTO>("notification.new", (n) => {
    queryClient.setQueryData<NotificationDTO[]>(["notifications"], (old) => [n, ...(old ?? [])]);
  });
  const markAll = useMutation({
    mutationFn: () => apiFetch("/me/notifications/read", { method: "POST", body: {} }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["notifications"] }),
  });

  const unread = (data ?? []).filter((n) => !n.readAt).length;

  return (
    <div className="min-h-dvh pb-10">
      <FlowHeader
        title={t("notificationsPage.title")}
        subtitle={t("notificationsPage.subtitle")}
        action={
          unread > 0 ? (
            <Button variant="ghost" size="sm" onClick={() => markAll.mutate()} loading={markAll.isPending}>
              {t("notificationsPage.markAllRead")}
            </Button>
          ) : null
        }
      />
      <main className="px-6 py-4">
        {isLoading ? (
          <PageLoader />
        ) : !data?.length ? (
          <EmptyState icon={<Bell className="size-5" />} title={t("notificationsPage.empty")} />
        ) : (
          <>
            {unread > 0 ? (
              <p className="mb-3 flex items-center gap-2 text-sm font-medium text-muted">
                <BellRing className="size-4" aria-hidden />
                {t("notificationsPage.unread", { count: unread })}
              </p>
            ) : null}
            <ul className="divide-y divide-line">
              {data.map((n) => {
                const href = linkFor(n);
                const body = (
                  <div className="flex gap-3 py-4">
                    <span className={cn("mt-2 size-2 shrink-0 rounded-full", n.readAt ? "bg-transparent" : "bg-ink")} aria-hidden />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-3">
                        <p className="font-semibold">{n.title}</p>
                        <span className="shrink-0 text-sm text-faint">{relativeTime(n.createdAt, t)}</span>
                      </div>
                      <p className="mt-0.5 text-[15px] text-muted">{n.body}</p>
                    </div>
                  </div>
                );
                return <li key={n.id}>{href ? <Link href={href}>{body}</Link> : body}</li>;
              })}
            </ul>
          </>
        )}
      </main>
    </div>
  );
}

export default function NotificationsPage() {
  return (
    <RoleGate>
      <Notifications />
    </RoleGate>
  );
}
