"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { DocumentList, DocumentUpload } from "@/components/portal/documents";
import { LocationSelect } from "@/components/portal/location-select";
import { StatusBadge } from "@/components/status";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader, PageHeader } from "@/components/ui/card";
import { ConfirmDialog, Dialog } from "@/components/ui/dialog";
import { Alert, Badge, PageLoader } from "@/components/ui/feedback";
import { Field, Input, PhoneInput } from "@/components/ui/form";
import { apiFetch } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { errorMessage, toastError } from "@/lib/errors";
import { useI18n } from "@/lib/i18n";
import { formatPhone } from "@/shared/money";
import type { OperatorDTO, UserDTO } from "@/shared/types";

const localPhone = (e164: string | null | undefined) => (e164 ?? "").replace(/^[+]250/, "");
const onlyDigits = (value: string) => value.replace(/[^0-9]/g, "");

function useSaveSettings() {
  const { t } = useI18n();
  const { reload } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: Record<string, unknown>) => apiFetch<OperatorDTO>("/operator/settings", { method: "PATCH", body }),
    onSuccess: (data) => {
      queryClient.setQueryData(["operator", "me"], data);
      toast.success(t("operator.settings.saved"));
      void reload();
    },
  });
}

function CompanyCard({ operator, canEdit }: { operator: OperatorDTO; canEdit: boolean }) {
  const { t } = useI18n();
  const save = useSaveSettings();
  const [form, setForm] = useState({ name: "", contactPhone: "", contactEmail: "", headquartersId: "" });
  useEffect(() => {
    setForm({
      name: operator.name,
      contactPhone: localPhone(operator.contactPhone),
      contactEmail: operator.contactEmail ?? "",
      headquartersId: operator.headquarters?.id ?? "",
    });
  }, [operator]);
  const set = (key: keyof typeof form, value: string) => setForm((f) => ({ ...f, [key]: value }));
  return (
    <Card>
      <CardHeader title={t("operator.settings.company")} subtitle={t("operator.settings.commissionLine", { rate: Math.round(operator.commissionRate * 1000) / 10 })} />
      <CardBody className="space-y-4">
        <Field label={t("operator.settings.companyName")}>
          {(p) => <Input {...p} value={form.name} disabled={!canEdit} onChange={(e) => set("name", e.target.value)} />}
        </Field>
        <Field label={t("operator.settings.registration")}>
          {(p) => <Input {...p} value={operator.registrationNumber} disabled />}
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t("operator.settings.contactPhone")}>
            {(p) => <PhoneInput {...p} value={form.contactPhone} disabled={!canEdit} onChange={(e) => set("contactPhone", onlyDigits(e.target.value))} />}
          </Field>
          <Field label={t("operator.settings.contactEmail")} optional={t("common.optional")}>
            {(p) => <Input {...p} type="email" value={form.contactEmail} disabled={!canEdit} onChange={(e) => set("contactEmail", e.target.value)} />}
          </Field>
        </div>
        <Field label={t("operator.settings.headquarters")}>
          {(p) => <LocationSelect {...p} stationsOnly disabled={!canEdit} value={form.headquartersId} onChange={(v) => set("headquartersId", v)} />}
        </Field>
        {save.error ? <p className="text-sm text-error-ink">{errorMessage(save.error, t)}</p> : null}
        {canEdit ? (
          <Button
            loading={save.isPending}
            disabled={form.name.trim().length < 2}
            onClick={() => save.mutate({ ...form, headquartersId: form.headquartersId || null })}
          >
            {t("common.save")}
          </Button>
        ) : null}
      </CardBody>
    </Card>
  );
}

function PolicyCard({ operator, canEdit }: { operator: OperatorDTO; canEdit: boolean }) {
  const { t } = useI18n();
  const save = useSaveSettings();
  const [hours, setHours] = useState(String(operator.cancellationHours));
  useEffect(() => setHours(String(operator.cancellationHours)), [operator.cancellationHours]);
  return (
    <Card>
      <CardHeader title={t("operator.settings.policy")} />
      <CardBody className="space-y-4">
        <Field label={t("operator.settings.cancellationHours")}>
          {(p) => <Input {...p} inputMode="numeric" className="w-32" value={hours} disabled={!canEdit} onChange={(e) => setHours(onlyDigits(e.target.value).slice(0, 2))} />}
        </Field>
        {canEdit ? (
          <Button
            loading={save.isPending}
            disabled={hours === "" || Number(hours) > 72 || Number(hours) === operator.cancellationHours}
            onClick={() => save.mutate({ cancellationHours: Number(hours) })}
          >
            {t("common.save")}
          </Button>
        ) : null}
      </CardBody>
    </Card>
  );
}

function BankCard({ operator, canEdit }: { operator: OperatorDTO; canEdit: boolean }) {
  const { t } = useI18n();
  const save = useSaveSettings();
  const [bank, setBank] = useState({ bankName: "", accountName: "", accountNumber: "" });
  useEffect(() => {
    setBank({ bankName: operator.bankAccount?.bankName ?? "", accountName: operator.bankAccount?.accountName ?? "", accountNumber: "" });
  }, [operator.bankAccount]);
  const set = (key: keyof typeof bank, value: string) => setBank((b) => ({ ...b, [key]: value }));
  const valid = bank.bankName.trim().length >= 2 && bank.accountName.trim().length >= 2 && bank.accountNumber.trim().length >= 4;
  return (
    <Card>
      <CardHeader title={t("operator.settings.bank")} subtitle={operator.bankAccount ? undefined : t("operator.settings.noBank")} />
      <CardBody className="space-y-4">
        <Field label={t("operator.settings.bankName")}>
          {(p) => <Input {...p} value={bank.bankName} disabled={!canEdit} onChange={(e) => set("bankName", e.target.value)} placeholder="Bank of Kigali" />}
        </Field>
        <Field label={t("operator.settings.accountName")}>
          {(p) => <Input {...p} value={bank.accountName} disabled={!canEdit} onChange={(e) => set("accountName", e.target.value)} />}
        </Field>
        <Field
          label={t("operator.settings.accountNumber")}
          hint={operator.bankAccount ? t("operator.settings.currentAccount", { account: operator.bankAccount.accountNumberMasked }) : undefined}
        >
          {(p) => <Input {...p} value={bank.accountNumber} disabled={!canEdit} autoComplete="off" onChange={(e) => set("accountNumber", e.target.value)} />}
        </Field>
        {save.error ? <p className="text-sm text-error-ink">{errorMessage(save.error, t)}</p> : null}
        {canEdit ? (
          <Button loading={save.isPending} disabled={!valid} onClick={() => save.mutate({ bankAccount: bank })}>
            {t("common.save")}
          </Button>
        ) : null}
      </CardBody>
    </Card>
  );
}

function TeamCard({ canEdit }: { canEdit: boolean }) {
  const { t } = useI18n();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const staff = useQuery({ queryKey: ["operator", "staff"], queryFn: () => apiFetch<UserDTO[]>("/operator/staff") });
  const [open, setOpen] = useState(false);
  const [member, setMember] = useState({ name: "", phone: "", email: "" });
  const [removing, setRemoving] = useState<UserDTO | null>(null);
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ["operator", "staff"] });
  const add = useMutation({
    mutationFn: () => apiFetch<UserDTO>("/operator/staff", { method: "POST", body: member }),
    onSuccess: () => {
      toast.success(t("operator.settings.memberAdded"));
      setOpen(false);
      setMember({ name: "", phone: "", email: "" });
      refresh();
    },
  });
  const remove = useMutation({
    mutationFn: (u: UserDTO) => apiFetch(`/operator/staff/${u.id}`, { method: "DELETE" }),
    onSuccess: () => {
      setRemoving(null);
      refresh();
    },
    onError: (err) => toastError(err, t),
  });
  return (
    <Card>
      <CardHeader
        title={t("operator.settings.team")}
        action={
          canEdit ? (
            <Button variant="outline" onClick={() => setOpen(true)}>
              <Plus aria-hidden />
              {t("operator.settings.addMember")}
            </Button>
          ) : null
        }
      />
      <CardBody>
        {staff.isLoading ? (
          <PageLoader />
        ) : (
          <ul className="divide-y divide-line">
            {(staff.data ?? []).map((u) => (
              <li key={u.id} className="flex flex-wrap items-center gap-3 py-3">
                <Avatar name={u.name} />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{u.name ?? formatPhone(u.phone)}</p>
                  <p className="truncate text-sm text-muted tabular">{[formatPhone(u.phone), u.email].filter(Boolean).join(" · ")}</p>
                </div>
                <Badge tone={u.isOperatorOwner ? "dark" : "neutral"}>
                  {u.isOperatorOwner ? t("operator.settings.owner") : t("operator.settings.staff")}
                </Badge>
                {u.status !== "active" ? <StatusBadge kind="user" status={u.status} /> : null}
                {canEdit && !u.isOperatorOwner && u.id !== user?.id ? (
                  <Button variant="ghost" size="iconSm" aria-label={t("operator.settings.removeMember")} onClick={() => setRemoving(u)}>
                    <Trash2 aria-hidden />
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </CardBody>
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title={t("operator.settings.addMember")}
        footer={
          <Button loading={add.isPending} disabled={member.name.trim().length < 2 || member.phone.length < 9} onClick={() => add.mutate()}>
            {t("common.add")}
          </Button>
        }
      >
        <div className="space-y-4">
          <Field label={t("common.name")}>
            {(p) => <Input {...p} value={member.name} onChange={(e) => setMember((m) => ({ ...m, name: e.target.value }))} />}
          </Field>
          <Field label={t("common.phone")}>
            {(p) => <PhoneInput {...p} value={member.phone} onChange={(e) => setMember((m) => ({ ...m, phone: onlyDigits(e.target.value) }))} />}
          </Field>
          <Field label={t("common.email")} optional={t("common.optional")}>
            {(p) => <Input {...p} type="email" value={member.email} onChange={(e) => setMember((m) => ({ ...m, email: e.target.value }))} />}
          </Field>
          {add.error ? <p className="text-sm text-error-ink">{errorMessage(add.error, t)}</p> : null}
        </div>
      </Dialog>
      <ConfirmDialog
        open={!!removing}
        onOpenChange={(o) => !o && setRemoving(null)}
        title={t("operator.settings.removeMember")}
        body={t("operator.settings.removeMemberBody", { name: removing?.name ?? formatPhone(removing?.phone) })}
        confirmLabel={t("common.remove")}
        danger
        loading={remove.isPending}
        onConfirm={() => removing && remove.mutate(removing)}
      />
    </Card>
  );
}

export default function OperatorSettingsPage() {
  const { t } = useI18n();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const operator = useQuery({ queryKey: ["operator", "me"], queryFn: () => apiFetch<OperatorDTO>("/operator/me") });
  if (operator.isLoading || !operator.data) return <PageLoader />;
  const o = operator.data;
  const writable = o.status !== "suspended" && o.status !== "rejected";
  const canEdit = !!user?.isOperatorOwner && writable;

  return (
    <div className="space-y-6">
      <PageHeader title={t("operator.settings.title")} subtitle={o.name} actions={<StatusBadge kind="operator" status={o.status} />} />
      {!user?.isOperatorOwner ? <Alert tone="info" title={t("operator.settings.ownerOnly")} /> : null}
      {o.statusReason && o.status !== "approved" ? <Alert tone="warning" title={o.statusReason} /> : null}
      <div className="grid items-start gap-6 xl:grid-cols-2">
        <div className="space-y-6">
          <CompanyCard operator={o} canEdit={canEdit} />
          <PolicyCard operator={o} canEdit={canEdit} />
        </div>
        <div className="space-y-6">
          <BankCard operator={o} canEdit={canEdit} />
          <Card>
            <CardHeader title={t("operator.settings.documents")} />
            <CardBody className="space-y-4">
              <DocumentList documents={o.documents} />
              {writable ? (
                <DocumentUpload
                  endpoint="/operator/documents"
                  types={["rura_licence", "tax_clearance", "insurance", "other"]}
                  onUploaded={() => void queryClient.invalidateQueries({ queryKey: ["operator", "me"] })}
                />
              ) : null}
            </CardBody>
          </Card>
        </div>
      </div>
      <TeamCard canEdit={canEdit} />
    </div>
  );
}
