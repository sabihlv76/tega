"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { MoreVertical, Pencil, Plus, Search, UserCheck, UserX, Users } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { LocationSelect } from "@/components/portal/location-select";
import { StatusBadge } from "@/components/status";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { EmptyState, PageLoader } from "@/components/ui/feedback";
import { Field, Input, PhoneInput, Select } from "@/components/ui/form";
import { Menu, MenuItem } from "@/components/ui/menu";
import { Chips } from "@/components/ui/segmented";
import { Table, TableCard, Td, Th, Tr } from "@/components/ui/table";
import { apiFetch } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { errorMessage, toastError } from "@/lib/errors";
import { formatDate, relativeTime } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import { LOCALE_LABELS, LOCALES, type Locale, type Role } from "@/shared/constants";
import { formatPhone } from "@/shared/money";
import type { AdminUserDTO, OperatorDTO, Paginated } from "@/shared/types";

const FILTERS = ["all", "passenger", "operator", "station", "admin"] as const;
type Filter = (typeof FILTERS)[number];

function StaffDialog({ user, open, onOpenChange }: { user: AdminUserDTO | null; open: boolean; onOpenChange: (o: boolean) => void }) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const [form, setForm] = useState({ name: "", phone: "", email: "", role: "station" as Role, operatorId: "", stationId: "", language: "en" as Locale });
  const operators = useQuery({
    queryKey: ["admin", "operators", "all"],
    queryFn: () => apiFetch<OperatorDTO[]>("/admin/operators", { query: { status: "all" } }),
    enabled: open,
  });
  useEffect(() => {
    if (!open) return;
    setForm({
      name: user?.name ?? "",
      phone: "",
      email: "",
      role: user?.role ?? "station",
      operatorId: user?.operator?.id ?? "",
      stationId: user?.station?.id ?? "",
      language: user?.language ?? "en",
    });
  }, [open, user]);
  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) => setForm((f) => ({ ...f, [key]: value }));
  const save = useMutation({
    mutationFn: () => {
      const assignment = {
        operatorId: form.role === "operator" ? form.operatorId : undefined,
        stationId: form.role === "station" ? form.stationId : undefined,
      };
      return user
        ? apiFetch(`/admin/users/${user.id}`, { method: "PATCH", body: { name: form.name, role: form.role, ...assignment } })
        : apiFetch("/admin/users", {
            method: "POST",
            body: { name: form.name, phone: form.phone, email: form.email, role: form.role, language: form.language, ...assignment },
          });
    },
    onSuccess: () => {
      toast.success(user ? t("admin.users.updated") : t("admin.users.created"));
      void queryClient.invalidateQueries({ queryKey: ["admin", "users"] });
      onOpenChange(false);
    },
  });
  const roles: Role[] = user ? ["passenger", "operator", "station", "admin"] : ["operator", "station", "admin"];
  const valid =
    form.name.trim().length >= 2 &&
    (user || form.phone.length >= 9 || form.email.includes("@")) &&
    (form.role !== "operator" || !!form.operatorId) &&
    (form.role !== "station" || !!form.stationId);

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={user ? t("common.edit") : t("admin.users.addStaff")}
      description={user ? [formatPhone(user.phone), user.email].filter(Boolean).join(" · ") : undefined}
      footer={
        <Button loading={save.isPending} disabled={!valid} onClick={() => save.mutate()}>
          {t("common.save")}
        </Button>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t("common.name")} className="sm:col-span-2">
          {(p) => <Input {...p} value={form.name} onChange={(e) => set("name", e.target.value)} />}
        </Field>
        {user ? null : (
          <>
            <Field label={t("common.phone")}>
              {(p) => <PhoneInput {...p} value={form.phone} onChange={(e) => set("phone", e.target.value.replace(/[^0-9]/g, ""))} />}
            </Field>
            <Field label={t("common.email")} optional={t("common.optional")}>
              {(p) => <Input {...p} type="email" value={form.email} onChange={(e) => set("email", e.target.value)} />}
            </Field>
          </>
        )}
        <Field label={t("admin.users.role")}>
          {(p) => (
            <Select {...p} value={form.role} onChange={(e) => set("role", e.target.value as Role)}>
              {roles.map((r) => (
                <option key={r} value={r}>
                  {t(`statuses.role.${r}`)}
                </option>
              ))}
            </Select>
          )}
        </Field>
        {user ? null : (
          <Field label={t("common.language")}>
            {(p) => (
              <Select {...p} value={form.language} onChange={(e) => set("language", e.target.value as Locale)}>
                {LOCALES.map((l) => (
                  <option key={l} value={l}>
                    {LOCALE_LABELS[l].native}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        )}
        {form.role === "operator" ? (
          <Field label={t("admin.users.operator")} className="sm:col-span-2">
            {(p) => (
              <Select {...p} value={form.operatorId} onChange={(e) => set("operatorId", e.target.value)}>
                <option value="">{t("common.selectPlaceholder")}</option>
                {(operators.data ?? []).map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        ) : null}
        {form.role === "station" ? (
          <Field label={t("admin.users.station")} className="sm:col-span-2">
            {(p) => <LocationSelect {...p} stationsOnly value={form.stationId} onChange={(v) => set("stationId", v)} />}
          </Field>
        ) : null}
      </div>
      {save.error ? <p className="mt-4 text-sm text-error-ink">{errorMessage(save.error, t)}</p> : null}
    </Dialog>
  );
}

export default function AdminUsersPage() {
  const { t, locale } = useI18n();
  const { user: me } = useAuth();
  const queryClient = useQueryClient();
  const [role, setRole] = useState<Filter>("all");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<AdminUserDTO | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const { data, isLoading } = useQuery({
    queryKey: ["admin", "users", role, q.trim(), page],
    queryFn: () => apiFetch<Paginated<AdminUserDTO>>("/admin/users", { query: { role, q: q.trim() || undefined, page } }),
    placeholderData: (previous) => previous,
  });
  const setStatus = useMutation({
    mutationFn: ({ user, status }: { user: AdminUserDTO; status: "active" | "suspended" }) =>
      apiFetch(`/admin/users/${user.id}`, { method: "PATCH", body: { status } }),
    onSuccess: () => {
      toast.success(t("admin.users.updated"));
      void queryClient.invalidateQueries({ queryKey: ["admin", "users"] });
    },
    onError: (err) => toastError(err, t),
  });
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("admin.users.title")}
        subtitle={t("admin.users.subtitle")}
        actions={
          <Button
            size="lg"
            onClick={() => {
              setEditing(null);
              setDialogOpen(true);
            }}
          >
            <Plus aria-hidden />
            {t("admin.users.addStaff")}
          </Button>
        }
      />
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <Chips
          label={t("common.filter")}
          value={role}
          onChange={(v) => {
            setRole(v);
            setPage(1);
          }}
          options={FILTERS.map((f) => ({ value: f, label: t(`admin.users.filters.${f}`) }))}
        />
        <div className="relative w-full lg:w-80">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden />
          <Input
            type="search"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setPage(1);
            }}
            placeholder={t("admin.users.searchPlaceholder")}
            aria-label={t("common.search")}
            className="pl-9"
          />
        </div>
      </div>

      <TableCard>
        {isLoading ? (
          <PageLoader />
        ) : !data?.items.length ? (
          <EmptyState icon={<Users className="size-5" />} title={t("admin.users.empty")} />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>{t("admin.users.columns.user")}</Th>
                <Th>{t("admin.users.columns.contact")}</Th>
                <Th>{t("admin.users.columns.role")}</Th>
                <Th>{t("admin.users.columns.status")}</Th>
                <Th>{t("admin.users.columns.joined")}</Th>
                <Th>{t("admin.users.columns.lastLogin")}</Th>
                <Th>
                  <span className="sr-only">{t("common.actions")}</span>
                </Th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((u) => (
                <Tr key={u.id}>
                  <Td>
                    <div className="flex items-center gap-3">
                      <Avatar name={u.name} className="size-9" />
                      <div className="min-w-0">
                        <p className="truncate font-medium">{u.name ?? "-"}</p>
                        {u.role === "passenger" ? <p className="text-xs text-muted">{t("operator.revenue.bookingsCount", { count: u.bookings })}</p> : null}
                      </div>
                    </div>
                  </Td>
                  <Td>
                    <p className="text-sm tabular">{formatPhone(u.phone)}</p>
                    {u.email ? <p className="text-sm text-muted">{u.email}</p> : null}
                  </Td>
                  <Td>
                    <StatusBadge kind="role" status={u.role} />
                    {u.operator || u.station ? <p className="mt-1 text-xs text-muted">{u.operator?.name ?? u.station?.name}</p> : null}
                  </Td>
                  <Td>
                    <StatusBadge kind="user" status={u.status} />
                  </Td>
                  <Td className="whitespace-nowrap text-sm text-muted">{formatDate(u.createdAt, locale)}</Td>
                  <Td className="whitespace-nowrap text-sm text-muted">{u.lastLoginAt ? relativeTime(u.lastLoginAt, t) : t("common.never")}</Td>
                  <Td className="text-right">
                    {u.id === me?.id ? null : (
                      <Menu
                        trigger={
                          <Button variant="ghost" size="iconSm" aria-label={t("common.actions")}>
                            <MoreVertical aria-hidden />
                          </Button>
                        }
                      >
                        <MenuItem
                          icon={<Pencil aria-hidden />}
                          onSelect={() => {
                            setEditing(u);
                            setDialogOpen(true);
                          }}
                        >
                          {t("common.edit")}
                        </MenuItem>
                        {u.status === "suspended" ? (
                          <MenuItem icon={<UserCheck aria-hidden />} onSelect={() => setStatus.mutate({ user: u, status: "active" })}>
                            {t("admin.users.activate")}
                          </MenuItem>
                        ) : (
                          <MenuItem danger icon={<UserX aria-hidden />} onSelect={() => setStatus.mutate({ user: u, status: "suspended" })}>
                            {t("admin.users.suspend")}
                          </MenuItem>
                        )}
                      </Menu>
                    )}
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </TableCard>

      {pages > 1 ? (
        <div className="flex items-center justify-between gap-3">
          <Button variant="outline" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            {t("common.previous")}
          </Button>
          <span className="text-sm text-muted">{t("common.page", { page, pages })}</span>
          <Button variant="outline" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>
            {t("common.next")}
          </Button>
        </div>
      ) : null}

      <StaffDialog user={editing} open={dialogOpen} onOpenChange={setDialogOpen} />
    </div>
  );
}
