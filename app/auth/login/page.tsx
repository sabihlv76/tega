"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { Mail, Smartphone } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Alert, PageLoader } from "@/components/ui/feedback";
import { Field, Input, PhoneInput } from "@/components/ui/form";
import { apiFetch } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { errorMessage } from "@/lib/errors";
import { useT } from "@/lib/i18n";
import { saveOtpFlow } from "@/lib/otp-flow";
import { homeForRole, safeNextPath } from "@/lib/utils";
import type { OtpRequestResponse, PublicConfigDTO } from "@/shared/types";

function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-5" aria-hidden>
      <path fill="#EA4335" d="M12 10.2v3.9h5.5c-.2 1.3-1.6 3.9-5.5 3.9-3.3 0-6-2.8-6-6.1s2.7-6.1 6-6.1c1.9 0 3.2.8 3.9 1.5l2.7-2.6C16.9 3.1 14.7 2 12 2 6.5 2 2 6.5 2 12s4.5 10 10 10c5.8 0 9.6-4.1 9.6-9.8 0-.7-.1-1.2-.2-1.7H12z" />
    </svg>
  );
}

function Login() {
  const t = useT();
  const router = useRouter();
  const params = useSearchParams();
  const { user, status } = useAuth();
  const next = safeNextPath(params.get("next"));
  const oauthError = params.get("error");
  const [channel, setChannel] = useState<"sms" | "email">("sms");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");

  const config = useQuery({ queryKey: ["config"], queryFn: () => apiFetch<PublicConfigDTO>("/config"), staleTime: 300_000 });

  // Already signed in: go where the user was heading.
  useEffect(() => {
    if (status === "authenticated" && user) router.replace(next ?? homeForRole(user.role));
  }, [status, user, next, router]);

  const request = useMutation({
    mutationFn: () =>
      apiFetch<OtpRequestResponse>("/auth/otp/request", {
        method: "POST",
        body: channel === "sms" ? { channel, phone } : { channel, email },
      }),
    onSuccess: (res) => {
      saveOtpFlow({ channel, target: channel === "sms" ? phone : email, destination: res.destination, devCode: res.devCode, next });
      router.push("/auth/verify");
    },
  });

  return (
    <div>
      <h1 className="text-3xl font-bold tracking-tight">{t("auth.loginTitle")}</h1>
      <p className="mt-2 text-[15px] text-muted">{t("auth.loginSubtitle")}</p>

      {oauthError ? (
        <Alert tone="error" className="mt-6" title={t(`errors.${oauthError}`)} />
      ) : null}

      <form
        className="mt-8 space-y-5"
        onSubmit={(e) => {
          e.preventDefault();
          request.mutate();
        }}
      >
        {channel === "sms" ? (
          <Field label={t("auth.phoneLabel")} error={request.error ? errorMessage(request.error, t) : undefined}>
            {(p) => (
              <PhoneInput
                {...p}
                value={phone}
                onChange={(e) => setPhone(e.target.value.replace(/[^\d\s]/g, ""))}
                placeholder={t("auth.phonePlaceholder")}
                autoFocus
                className="h-13"
              />
            )}
          </Field>
        ) : (
          <Field label={t("auth.emailLabel")} error={request.error ? errorMessage(request.error, t) : undefined}>
            {(p) => (
              <Input
                {...p}
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder={t("auth.emailPlaceholder")}
                autoFocus
              />
            )}
          </Field>
        )}
        <Button type="submit" size="xl" block loading={request.isPending} disabled={channel === "sms" ? phone.replace(/\D/g, "").length < 9 : !email.includes("@")}>
          {t("auth.sendCode")}
        </Button>
      </form>

      {config.data?.emailOtpEnabled !== false ? (
        <Button
          variant="ghost"
          block
          className="mt-3"
          onClick={() => {
            setChannel(channel === "sms" ? "email" : "sms");
            request.reset();
          }}
        >
          {channel === "sms" ? <Mail aria-hidden /> : <Smartphone aria-hidden />}
          {channel === "sms" ? t("auth.useEmail") : t("auth.usePhone")}
        </Button>
      ) : null}

      {config.data?.googleEnabled ? (
        <>
          <div className="my-6 flex items-center gap-3 text-sm text-faint">
            <span className="h-px flex-1 bg-line" />
            {t("common.or")}
            <span className="h-px flex-1 bg-line" />
          </div>
          <Button
            variant="outline"
            size="lg"
            block
            onClick={() => {
              window.location.href = `/api/v1/auth/google/start?next=${encodeURIComponent(next ?? "/")}`;
            }}
          >
            <GoogleIcon />
            {t("auth.continueWithGoogle")}
          </Button>
        </>
      ) : null}

      <p className="mt-8 text-sm text-muted">{t("auth.staffHint")}</p>
      <p className="mt-3 text-sm text-muted">
        <Link href="/terms" className="underline underline-offset-4">
          {t("auth.agreement")}
        </Link>
      </p>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<PageLoader />}>
      <Login />
    </Suspense>
  );
}
