"use client";

import { useMutation } from "@tanstack/react-query";
import { CheckCircle2 } from "lucide-react";
import { useEffect, useState } from "react";
import { FlowHeader, StickyAction } from "@/components/passenger/shell";
import { LocationSelect } from "@/components/portal/location-select";
import { Button, ButtonLink } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/feedback";
import { Field, Input, PhoneInput } from "@/components/ui/form";
import { ApiError, apiFetch } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { errorMessage } from "@/lib/errors";
import { useT } from "@/lib/i18n";
import { formatPhone, normalizeRwPhone } from "@/shared/money";

// "Partner with FIKA": bus companies apply here and an admin approves them after checking the RURA
// licence (Admin → Operators). The contact phone becomes the operator owner's sign-in number. The
// licence is optional because pending operators can also upload it later from their portal.

const LICENCE_TYPES = ["application/pdf", "image/jpeg", "image/png", "image/webp"];
const MAX_LICENCE_BYTES = 10 * 1024 * 1024;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type FormField =
  | "companyName"
  | "registrationNumber"
  | "contactName"
  | "contactPhone"
  | "contactEmail"
  | "headquarters";

export default function PartnerApplyPage() {
  const t = useT();
  const { user } = useAuth();
  const [form, setForm] = useState<Record<FormField, string>>({
    companyName: "",
    registrationNumber: "",
    contactName: "",
    contactPhone: "",
    contactEmail: "",
    headquarters: "",
  });
  const [licence, setLicence] = useState<File | null>(null);
  const [touched, setTouched] = useState(false);

  // Signed-in passengers usually apply for their own company: start from their details.
  useEffect(() => {
    if (!user) return;
    setForm((f) => ({
      ...f,
      contactName: f.contactName || user.name || "",
      contactPhone: f.contactPhone || (user.phone ?? "").replace("+250", ""),
      contactEmail: f.contactEmail || user.email || "",
    }));
  }, [user]);

  const phone = normalizeRwPhone(form.contactPhone);
  const email = form.contactEmail.trim();
  const missing = {
    companyName: form.companyName.trim().length < 2,
    registrationNumber: form.registrationNumber.trim().length < 3,
    contactName: form.contactName.trim().length < 2,
  };
  const licenceError = !licence
    ? null
    : !LICENCE_TYPES.includes(licence.type)
      ? t("errors.FILE_TYPE")
      : licence.size > MAX_LICENCE_BYTES
        ? t("errors.FILE_TOO_LARGE")
        : null;
  const valid =
    !Object.values(missing).some(Boolean) && !!phone && (!email || EMAIL.test(email)) && !licenceError;

  const apply = useMutation({
    mutationFn: () => {
      const data = new FormData();
      for (const [key, value] of Object.entries(form)) if (value.trim()) data.set(key, value.trim());
      if (phone) data.set("contactPhone", phone);
      if (licence) data.set("licence", licence);
      return apiFetch<{ ok: true; operatorId: string }>("/operators/apply", { method: "POST", form: data });
    },
  });

  const update = (key: FormField, value: string) => {
    setForm((f) => ({ ...f, [key]: value }));
    if (apply.isError) apply.reset();
  };

  // Errors the API attaches to one field (e.g. a licence number or phone already registered) are
  // shown under that field; anything else below the form.
  const serverField = apply.error instanceof ApiError ? apply.error.field : undefined;
  const serverError = apply.error ? errorMessage(apply.error, t) : null;
  const fieldError = (name: FormField, clientError: string | null = null) =>
    (touched && clientError) || (serverField === name ? serverError : null) || undefined;
  const generalError = serverError && !(serverField && serverField in form) ? serverError : null;

  if (apply.isSuccess) {
    return (
      <div className="min-h-dvh">
        <FlowHeader title={t("partner.title")} />
        <EmptyState
          className="py-20"
          icon={<CheckCircle2 className="size-6" />}
          title={t("partner.submittedTitle")}
          body={t("partner.submittedBody", { phone: formatPhone(phone) })}
          action={<ButtonLink href="/">{t("common.continue")}</ButtonLink>}
        />
      </div>
    );
  }

  return (
    <div className="min-h-dvh pb-32">
      <FlowHeader title={t("partner.title")} />
      <main className="space-y-6 px-6 py-6">
        <p className="text-[15px] text-muted">{t("partner.subtitle")}</p>

        <section className="space-y-4">
          <Field label={t("partner.companyName")} error={fieldError("companyName")}>
            {(p) => (
              <Input
                {...p}
                value={form.companyName}
                onChange={(e) => update("companyName", e.target.value)}
                autoComplete="organization"
                aria-invalid={p["aria-invalid"] || (touched && missing.companyName) || undefined}
              />
            )}
          </Field>
          <Field label={t("partner.registration")} error={fieldError("registrationNumber")}>
            {(p) => (
              <Input
                {...p}
                value={form.registrationNumber}
                onChange={(e) => update("registrationNumber", e.target.value.toUpperCase())}
                autoCapitalize="characters"
                aria-invalid={p["aria-invalid"] || (touched && missing.registrationNumber) || undefined}
              />
            )}
          </Field>
          <Field
            label={t("partner.headquarters")}
            optional={t("common.optional")}
            error={fieldError("headquarters")}
          >
            {(p) => (
              <LocationSelect
                {...p}
                stationsOnly
                value={form.headquarters}
                onChange={(id) => update("headquarters", id)}
              />
            )}
          </Field>
        </section>

        <section className="space-y-4">
          <Field label={t("partner.contactName")} error={fieldError("contactName")}>
            {(p) => (
              <Input
                {...p}
                value={form.contactName}
                onChange={(e) => update("contactName", e.target.value)}
                autoComplete="name"
                placeholder={t("auth.namePlaceholder")}
                aria-invalid={p["aria-invalid"] || (touched && missing.contactName) || undefined}
              />
            )}
          </Field>
          <Field
            label={t("partner.contactPhone")}
            error={fieldError("contactPhone", phone ? null : t("errors.PHONE_INVALID"))}
          >
            {(p) => (
              <PhoneInput
                {...p}
                value={form.contactPhone}
                onChange={(e) => update("contactPhone", e.target.value)}
                placeholder={t("auth.phonePlaceholder")}
              />
            )}
          </Field>
          <Field
            label={t("partner.contactEmail")}
            optional={t("common.optional")}
            error={fieldError("contactEmail", email && !EMAIL.test(email) ? t("errors.EMAIL_INVALID") : null)}
          >
            {(p) => (
              <Input
                {...p}
                type="email"
                value={form.contactEmail}
                onChange={(e) => update("contactEmail", e.target.value)}
                autoComplete="email"
                placeholder={t("auth.emailPlaceholder")}
              />
            )}
          </Field>
          <Field
            label={t("partner.licence")}
            optional={t("common.optional")}
            error={licenceError ?? undefined}
          >
            {(p) => (
              <input
                {...p}
                type="file"
                accept={LICENCE_TYPES.join(",")}
                onChange={(e) => {
                  setLicence(e.target.files?.[0] ?? null);
                  if (apply.isError) apply.reset();
                }}
                className="block w-full text-sm file:mr-3 file:rounded-input file:border-0 file:bg-subtle file:px-3 file:py-2 file:text-sm file:font-medium"
              />
            )}
          </Field>
        </section>

        {touched && !valid ? <p className="text-sm text-error-ink">{t("errors.VALIDATION_ERROR")}</p> : null}
        {generalError ? (
          <p className="text-sm text-error-ink" role="alert">
            {generalError}
          </p>
        ) : null}
      </main>

      <StickyAction>
        <Button
          size="xl"
          block
          loading={apply.isPending}
          onClick={() => {
            setTouched(true);
            if (valid) apply.mutate();
          }}
        >
          {t("partner.submit")}
        </Button>
      </StickyAction>
    </div>
  );
}
