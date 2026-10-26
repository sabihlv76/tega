"use client";

import { useMutation } from "@tanstack/react-query";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { PageLoader } from "@/components/ui/feedback";
import { Field, Input, Select } from "@/components/ui/form";
import { apiFetch } from "@/lib/api";
import { useAuth, useRequireAuth } from "@/lib/auth";
import { errorMessage } from "@/lib/errors";
import { useI18n } from "@/lib/i18n";
import { safeNextPath } from "@/lib/utils";
import { type Locale, LOCALE_LABELS, LOCALES } from "@/shared/constants";
import type { UserDTO } from "@/shared/types";

function Welcome() {
  const { t, locale, setLocale } = useI18n();
  const router = useRouter();
  const params = useSearchParams();
  const next = safeNextPath(params.get("next")) ?? "/";
  const { ready, user } = useRequireAuth();
  const { setUser } = useAuth();
  const [name, setName] = useState("");
  const [language, setLanguage] = useState<Locale>(locale);

  useEffect(() => {
    if (user?.name) setName(user.name);
  }, [user]);

  const save = useMutation({
    mutationFn: () => apiFetch<UserDTO>("/me", { method: "PATCH", body: { name: name.trim(), language } }),
    onSuccess: async (u) => {
      setUser(u);
      await setLocale(language);
      router.replace(next);
    },
  });

  if (!ready) return <PageLoader />;

  return (
    <div>
      <h1 className="text-3xl font-bold tracking-tight">{t("auth.welcomeTitle")}</h1>
      <p className="mt-2 text-[15px] text-muted">{t("auth.welcomeSubtitle")}</p>
      <form
        className="mt-8 space-y-5"
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim().length >= 2) save.mutate();
        }}
      >
        <Field label={t("auth.nameLabel")} error={save.error ? errorMessage(save.error, t) : undefined}>
          {(p) => (
            <Input {...p} value={name} onChange={(e) => setName(e.target.value)} placeholder={t("auth.namePlaceholder")} autoComplete="name" autoFocus />
          )}
        </Field>
        <Field label={t("auth.preferredLanguage")}>
          {(p) => (
            <Select {...p} value={language} onChange={(e) => setLanguage(e.target.value as Locale)}>
              {LOCALES.map((l) => (
                <option key={l} value={l}>
                  {LOCALE_LABELS[l].native}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Button type="submit" size="xl" block loading={save.isPending} disabled={name.trim().length < 2}>
          {t("auth.getStarted")}
        </Button>
      </form>
    </div>
  );
}

export default function WelcomePage() {
  return (
    <Suspense fallback={<PageLoader />}>
      <Welcome />
    </Suspense>
  );
}
