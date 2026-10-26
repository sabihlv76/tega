"use client";

import { useMutation } from "@tanstack/react-query";
import { Briefcase, ChevronRight, FileText, LogOut, Mail, Pencil, Phone } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { LanguageSwitcher } from "@/components/language-switcher";
import { GuestPrompt } from "@/components/passenger/guest";
import { PassengerShell, SectionLabel } from "@/components/passenger/shell";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { PageLoader } from "@/components/ui/feedback";
import { Field, Input, OtpInput, Switch } from "@/components/ui/form";
import { apiFetch } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { errorMessage, toastError } from "@/lib/errors";
import { useT } from "@/lib/i18n";
import { homeForRole } from "@/lib/utils";
import { formatPhone } from "@/shared/money";
import type { NotificationPrefs, OtpRequestResponse, UserDTO } from "@/shared/types";

function ContactDialog({
  channel,
  open,
  onOpenChange,
}: {
  channel: "sms" | "email";
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useT();
  const { setUser } = useAuth();
  const [value, setValue] = useState("");
  const [code, setCode] = useState("");
  const [sent, setSent] = useState<OtpRequestResponse | null>(null);

  const request = useMutation({
    mutationFn: () => apiFetch<OtpRequestResponse>("/me/contact/request", { method: "POST", body: { channel, value } }),
    onSuccess: setSent,
  });
  const verify = useMutation({
    mutationFn: () => apiFetch<UserDTO>("/me/contact/verify", { method: "POST", body: { channel, value, code } }),
    onSuccess: (user) => {
      setUser(user);
      toast.success(t("profile.updated"));
      onOpenChange(false);
      setSent(null);
      setValue("");
      setCode("");
    },
  });
  const error = request.error ?? verify.error;

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={channel === "sms" ? t("profile.phone") : t("profile.email")}
      side="sheet"
      size="sm"
      footer={
        sent ? (
          <Button block loading={verify.isPending} disabled={code.length !== 6} onClick={() => verify.mutate()}>
            {t("auth.verify")}
          </Button>
        ) : (
          <Button block loading={request.isPending} disabled={!value.trim()} onClick={() => request.mutate()}>
            {t("auth.sendCode")}
          </Button>
        )
      }
    >
      {sent ? (
        <div className="space-y-4">
          <p className="text-[15px] text-muted">{t("auth.verifySubtitle", { destination: sent.destination })}</p>
          <OtpInput value={code} onChange={setCode} label={t("auth.codeLabel")} autoFocus />
          {sent.devCode ? <p className="text-sm text-muted">{t("auth.devCodeHint", { code: sent.devCode })}</p> : null}
        </div>
      ) : (
        <Field label={channel === "sms" ? t("auth.phoneLabel") : t("auth.emailLabel")}>
          {(p) => (
            <Input
              {...p}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              type={channel === "sms" ? "tel" : "email"}
              placeholder={channel === "sms" ? "078 812 3456" : t("auth.emailPlaceholder")}
            />
          )}
        </Field>
      )}
      {error ? (
        <p className="mt-3 text-sm text-error-ink" role="alert">
          {errorMessage(error, t)}
        </p>
      ) : null}
    </Dialog>
  );
}

export default function ProfilePage() {
  const t = useT();
  const router = useRouter();
  const { user, status, setUser, signOut } = useAuth();
  const [name, setName] = useState("");
  const [editingName, setEditingName] = useState(false);
  const [contact, setContact] = useState<"sms" | "email" | null>(null);

  useEffect(() => {
    if (user) setName(user.name ?? "");
  }, [user]);

  const update = useMutation({
    mutationFn: (body: { name?: string; notificationPrefs?: Partial<NotificationPrefs> }) =>
      apiFetch<UserDTO>("/me", { method: "PATCH", body }),
    onSuccess: (u) => {
      setUser(u);
      toast.success(t("profile.updated"));
      setEditingName(false);
    },
    onError: (err) => toastError(err, t),
  });

  if (status === "loading") {
    return (
      <PassengerShell>
        <PageLoader />
      </PassengerShell>
    );
  }
  if (!user) {
    return (
      <PassengerShell>
        <h1 className="mb-5 mt-4 text-3xl font-bold tracking-tight">{t("profile.title")}</h1>
        <GuestPrompt />
      </PassengerShell>
    );
  }

  const prefs = user.notificationPrefs;
  const staffPortal = user.role !== "passenger" ? homeForRole(user.role) : null;

  return (
    <PassengerShell>
      <h1 className="mb-6 mt-4 text-3xl font-bold tracking-tight">{t("profile.title")}</h1>

      <section className="flex items-center gap-4">
        <Avatar name={user.name} className="size-16 text-xl" />
        <div className="min-w-0 flex-1">
          {editingName ? (
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (name.trim().length >= 2) update.mutate({ name: name.trim() });
              }}
            >
              <Input value={name} onChange={(e) => setName(e.target.value)} aria-label={t("profile.name")} autoFocus />
              <Button type="submit" loading={update.isPending}>
                {t("common.save")}
              </Button>
            </form>
          ) : (
            <div className="flex items-center gap-2">
              <p className="truncate text-xl font-semibold">{user.name ?? "—"}</p>
              <Button variant="ghost" size="iconSm" aria-label={t("profile.editProfile")} onClick={() => setEditingName(true)}>
                <Pencil aria-hidden />
              </Button>
            </div>
          )}
          <p className="text-sm text-muted">{t(`statuses.role.${user.role}`)}</p>
        </div>
      </section>

      <section className="mt-8">
        <SectionLabel>{t("profile.personal")}</SectionLabel>
        <div className="divide-y divide-line rounded-2xl bg-canvas">
          <button type="button" onClick={() => setContact("sms")} className="flex w-full items-center gap-4 px-5 py-4 text-left">
            <Phone className="size-5 text-muted" aria-hidden />
            <span className="min-w-0 flex-1">
              <span className="block text-sm text-faint">{t("profile.phone")}</span>
              <span className="block truncate text-[17px]">{formatPhone(user.phone) || "—"}</span>
            </span>
            <ChevronRight className="size-5 text-faint" aria-hidden />
          </button>
          <button type="button" onClick={() => setContact("email")} className="flex w-full items-center gap-4 px-5 py-4 text-left">
            <Mail className="size-5 text-muted" aria-hidden />
            <span className="min-w-0 flex-1">
              <span className="block text-sm text-faint">{t("profile.email")}</span>
              <span className="block truncate text-[17px]">{user.email ?? "—"}</span>
            </span>
            <ChevronRight className="size-5 text-faint" aria-hidden />
          </button>
          <div className="flex items-center justify-between gap-4 px-5 py-3">
            <span className="text-[17px]">{t("profile.language")}</span>
            <LanguageSwitcher />
          </div>
        </div>
      </section>

      <section className="mt-8">
        <SectionLabel>{t("profile.notificationChannels")}</SectionLabel>
        <div className="divide-y divide-line rounded-2xl bg-canvas px-5">
          <Switch label={t("profile.sms")} checked={prefs.sms} onChange={(v) => update.mutate({ notificationPrefs: { sms: v } })} />
          <Switch label={t("profile.emailChannel")} checked={prefs.email} onChange={(v) => update.mutate({ notificationPrefs: { email: v } })} />
          <Switch label={t("profile.inApp")} checked={prefs.inApp} onChange={(v) => update.mutate({ notificationPrefs: { inApp: v } })} />
        </div>
      </section>

      <section className="mt-8 space-y-2">
        {staffPortal ? (
          <Link href={staffPortal} className="flex items-center gap-4 rounded-2xl bg-ink px-5 py-4 text-white">
            <Briefcase className="size-5" aria-hidden />
            <span className="flex-1 font-semibold">
              {t("profile.openPortal", { portal: t(`profile.portals.${user.role as "operator" | "station" | "admin"}`) })}
            </span>
            <ChevronRight className="size-5" aria-hidden />
          </Link>
        ) : (
          <Link href="/partners/apply" className="flex items-center gap-4 rounded-2xl border border-line px-5 py-4">
            <Briefcase className="size-5 text-muted" aria-hidden />
            <span className="flex-1">{t("profile.partner")}</span>
            <ChevronRight className="size-5 text-faint" aria-hidden />
          </Link>
        )}
        <Link href="/terms" className="flex items-center gap-4 rounded-2xl border border-line px-5 py-4">
          <FileText className="size-5 text-muted" aria-hidden />
          <span className="flex-1">{t("terms.title")}</span>
          <ChevronRight className="size-5 text-faint" aria-hidden />
        </Link>
        <Button
          variant="ghost"
          size="lg"
          block
          className="mt-2 text-error-ink"
          onClick={async () => {
            await signOut();
            router.push("/");
          }}
        >
          <LogOut aria-hidden />
          {t("profile.signOut")}
        </Button>
      </section>

      <ContactDialog channel={contact ?? "sms"} open={contact !== null} onOpenChange={(open) => !open && setContact(null)} />
    </PassengerShell>
  );
}
