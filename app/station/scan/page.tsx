"use client";

import { Keyboard } from "lucide-react";
import { useState } from "react";
import { CheckInResultCard, useCheckIn } from "@/components/station/checkin";
import { QrScanner } from "@/components/station/qr-scanner";
import { Button, ButtonLink } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/card";
import { Alert, Spinner } from "@/components/ui/feedback";
import { errorMessage } from "@/lib/errors";
import { useI18n } from "@/lib/i18n";
import type { CheckInResultDTO } from "@/shared/types";

export default function ScanPage() {
  const { t } = useI18n();
  const checkIn = useCheckIn();
  const [code, setCode] = useState<string | null>(null);
  const [result, setResult] = useState<CheckInResultDTO | null>(null);

  const run = (value: string, collectCash = false) => {
    setCode(value);
    checkIn.mutate({ code: value, collectCash }, { onSuccess: setResult });
  };
  const reset = () => {
    setResult(null);
    setCode(null);
    checkIn.reset();
  };
  const paused = !!result || checkIn.isPending || checkIn.isError;

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <PageHeader
        title={t("station.scanner.title")}
        subtitle={t("station.scanner.hint")}
        actions={
          <ButtonLink href="/station/checkin" variant="outline">
            <Keyboard aria-hidden />
            {t("station.scanner.useManual")}
          </ButtonLink>
        }
      />
      <QrScanner
        paused={paused}
        onDetect={(value) => {
          if (!paused) run(value);
        }}
      />
      {checkIn.isPending && !result ? (
        <div className="flex justify-center">
          <Spinner label={t("station.scanner.checking")} />
        </div>
      ) : null}
      {checkIn.isError ? (
        <Alert
          tone="error"
          title={errorMessage(checkIn.error, t)}
          action={
            <Button size="sm" variant="outline" onClick={reset}>
              {t("common.retry")}
            </Button>
          }
        />
      ) : null}
      {result ? (
        <CheckInResultCard
          result={result}
          collecting={checkIn.isPending}
          onCollectCash={() => {
            if (code) run(code, true);
          }}
          onNext={reset}
        />
      ) : null}
    </div>
  );
}
