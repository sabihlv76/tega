"use client";

import { Package, Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { type FormEvent, useRef, useState } from "react";
import { CheckInResultCard, useCheckIn } from "@/components/station/checkin";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader, PageHeader } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/form";
import { errorMessage } from "@/lib/errors";
import { useI18n } from "@/lib/i18n";
import type { CheckInResultDTO } from "@/shared/types";

/** Accepts "fp 1234 abcd", "FP-1234ABCD" or just the 8 characters. */
function normalizeParcelCode(input: string): string | null {
  const v = input.toUpperCase().replace(/[^0-9A-Z]/g, "");
  const body = v.startsWith("FP") ? v.slice(2) : v;
  return body.length === 8 ? `FP-${body}` : null;
}

export default function ManualCheckInPage() {
  const { t } = useI18n();
  const router = useRouter();
  const checkIn = useCheckIn();
  const inputRef = useRef<HTMLInputElement>(null);
  const [reference, setReference] = useState("");
  const [result, setResult] = useState<CheckInResultDTO | null>(null);
  const [parcelCode, setParcelCode] = useState("");
  const code = reference.trim();

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (code.length < 5) return;
    setResult(null);
    checkIn.mutate({ code }, { onSuccess: setResult });
  };
  const reset = () => {
    setResult(null);
    setReference("");
    checkIn.reset();
    inputRef.current?.focus();
  };
  const parcel = normalizeParcelCode(parcelCode);

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <PageHeader title={t("station.manual.title")} subtitle={t("station.manual.subtitle")} />
      <Card>
        <CardBody>
          <form onSubmit={submit} className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <Field label={t("station.manual.referenceLabel")} className="flex-1">
              {(p) => (
                <Input
                  {...p}
                  ref={inputRef}
                  value={reference}
                  onChange={(e) => setReference(e.target.value.toUpperCase())}
                  placeholder={t("station.manual.referencePlaceholder")}
                  className="h-12 font-mono text-lg uppercase"
                  autoComplete="off"
                  autoCapitalize="characters"
                  spellCheck={false}
                />
              )}
            </Field>
            <Button type="submit" size="lg" loading={checkIn.isPending && !result} disabled={code.length < 5}>
              <Search aria-hidden />
              {t("station.manual.check")}
            </Button>
          </form>
          {checkIn.isError ? <p className="mt-3 text-sm text-error-ink">{errorMessage(checkIn.error, t)}</p> : null}
        </CardBody>
      </Card>

      {result ? (
        <CheckInResultCard
          result={result}
          collecting={checkIn.isPending}
          onCollectCash={() => checkIn.mutate({ code, collectCash: true }, { onSuccess: setResult })}
          onNext={reset}
          nextLabel={t("station.manual.nextTicket")}
        />
      ) : null}

      <Card>
        <CardHeader title={t("station.manual.parcelTitle")} />
        <CardBody>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (parcel) router.push(`/station/parcels?code=${encodeURIComponent(parcel)}`);
            }}
            className="flex flex-col gap-3 sm:flex-row sm:items-end"
          >
            <Field label={t("station.manual.parcelLabel")} className="flex-1">
              {(p) => (
                <Input
                  {...p}
                  value={parcelCode}
                  onChange={(e) => setParcelCode(e.target.value.toUpperCase())}
                  placeholder="FP-XXXXXXXX"
                  className="h-12 font-mono text-lg uppercase"
                  autoComplete="off"
                  spellCheck={false}
                />
              )}
            </Field>
            <Button type="submit" size="lg" variant="outline" disabled={!parcel}>
              <Package aria-hidden />
              {t("station.manual.findParcel")}
            </Button>
          </form>
        </CardBody>
      </Card>
    </div>
  );
}
