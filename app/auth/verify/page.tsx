"use client";

import { useMutation } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { OtpInput } from "@/components/ui/form";
import { apiFetch } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { errorMessage } from "@/lib/errors";
import { useT } from "@/lib/i18n";
import { clearOtpFlow, type OtpFlow, readOtpFlow, saveOtpFlow } from "@/lib/otp-flow";
import { homeForRole } from "@/lib/utils";
import type { AuthResponse, OtpRequestResponse } from "@/shared/types";

const RESEND_SECONDS = 30;

export default function VerifyPage() {
  const t = useT();
  const router = useRouter();
  const { signIn } = useAuth();
  const [flow, setFlow] = useState<OtpFlow | null>(null);
  const [code, setCode] = useState("");
  const [seconds, setSeconds] = useState(RESEND_SECONDS);

  useEffect(() => {
    const f = readOtpFlow();
    if (!f) router.replace("/auth/login");
    else setFlow(f);
  }, [router]);

  useEffect(() => {
    if (seconds <= 0) return;
    const timer = setTimeout(() => setSeconds((s) => s - 1), 1000);
    return () => clearTimeout(timer);
  }, [seconds]);

  const verify = useMutation({
    mutationFn: (value: string) =>
      apiFetch<AuthResponse>("/auth/otp/verify", {
        method: "POST",
        body: flow?.channel === "sms" ? { channel: "sms", phone: flow.target, code: value } : { channel: "email", email: flow?.target, code: value },
      }),
    onSuccess: (res) => {
      signIn(res);
      clearOtpFlow();
      const destination = flow?.next ?? homeForRole(res.user.role);
      if (res.isNewUser || !res.user.name) router.replace(`/auth/welcome?next=${encodeURIComponent(destination)}`);
      else router.replace(destination);
    },
    onError: () => setCode(""),
  });

  const resend = useMutation({
    mutationFn: () =>
      apiFetch<OtpRequestResponse>("/auth/otp/request", {
        method: "POST",
        body: flow?.channel === "sms" ? { channel: "sms", phone: flow.target } : { channel: "email", email: flow?.target },
      }),
    onSuccess: (res) => {
      if (flow) {
        const updated = { ...flow, devCode: res.devCode, destination: res.destination };
        saveOtpFlow(updated);
        setFlow(updated);
      }
      setSeconds(RESEND_SECONDS);
    },
  });

  if (!flow) return null;

  return (
    <div>
      <h1 className="text-3xl font-bold tracking-tight">{t("auth.verifyTitle")}</h1>
      <p className="mt-2 text-[15px] text-muted">
        {t("auth.verifySubtitle", { destination: flow.destination })}{" "}
        <button type="button" className="font-semibold text-ink underline underline-offset-4" onClick={() => router.replace("/auth/login")}>
          {t("auth.changeDestination")}
        </button>
      </p>

      <form
        className="mt-8 space-y-6"
        onSubmit={(e) => {
          e.preventDefault();
          if (code.length === 6) verify.mutate(code);
        }}
      >
        <OtpInput
          value={code}
          label={t("auth.codeLabel")}
          autoFocus
          disabled={verify.isPending}
          onChange={(value) => {
            setCode(value);
            if (value.length === 6) verify.mutate(value);
          }}
        />
        {verify.error ? (
          <p className="text-sm text-error-ink" role="alert">
            {errorMessage(verify.error, t)}
          </p>
        ) : null}
        {flow.devCode ? (
          <p className="rounded-card bg-warning-soft px-3 py-2 text-sm text-warning-ink">{t("auth.devCodeHint", { code: flow.devCode })}</p>
        ) : null}
        <Button type="submit" size="xl" block loading={verify.isPending} disabled={code.length !== 6}>
          {t("auth.verify")}
        </Button>
      </form>

      <div className="mt-6 text-center text-sm">
        {seconds > 0 ? (
          <span className="text-muted">{t("auth.resendIn", { seconds })}</span>
        ) : (
          <Button variant="link" onClick={() => resend.mutate()} loading={resend.isPending}>
            {t("auth.resend")}
          </Button>
        )}
        {resend.error ? <p className="mt-2 text-error-ink">{errorMessage(resend.error, t)}</p> : null}
      </div>
    </div>
  );
}
