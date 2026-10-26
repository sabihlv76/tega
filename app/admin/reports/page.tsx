"use client";

import { Download, FileSpreadsheet } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, PageHeader } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/form";
import { downloadFile } from "@/lib/api";
import { toastError } from "@/lib/errors";
import { useI18n } from "@/lib/i18n";
import { addDays, kigaliDate } from "@/shared/time";

const TYPES = ["bookings", "payments", "parcels", "operators", "payouts", "fareCaps"] as const;
type ReportType = (typeof TYPES)[number];
/** Reports that are snapshots rather than activity in a date range. */
const UNDATED: ReportType[] = ["operators", "fareCaps"];

export default function ReportsPage() {
  const { t } = useI18n();
  const today = kigaliDate();
  const [from, setFrom] = useState(addDays(today, -29));
  const [to, setTo] = useState(today);
  const [busy, setBusy] = useState<ReportType | null>(null);
  const invalidRange = from > to;

  const download = async (type: ReportType) => {
    setBusy(type);
    try {
      const dated = !UNDATED.includes(type);
      await downloadFile(`/admin/reports/${type}`, dated ? `fika-${type}-${from}-${to}.csv` : `fika-${type}-${today}.csv`, dated ? { from, to } : undefined);
    } catch (err) {
      toastError(err, t);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader title={t("admin.reports.title")} subtitle={t("admin.reports.subtitle")} />
      <Card className="flex flex-wrap items-end gap-4 p-5">
        <Field label={t("admin.reports.from")}>
          {(p) => <Input {...p} type="date" value={from} max={to} onChange={(e) => e.target.value && setFrom(e.target.value)} className="w-44" />}
        </Field>
        <Field label={t("admin.reports.to")}>
          {(p) => <Input {...p} type="date" value={to} min={from} max={today} onChange={(e) => e.target.value && setTo(e.target.value)} className="w-44" />}
        </Field>
      </Card>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {TYPES.map((type) => (
          <Card key={type} className="flex flex-col p-5">
            <div className="flex items-center gap-3">
              <span className="flex size-10 items-center justify-center rounded-card bg-subtle">
                <FileSpreadsheet className="size-5" aria-hidden />
              </span>
              <h2 className="text-lg font-semibold">{t(`admin.reports.types.${type}`)}</h2>
            </div>
            <p className="mt-3 flex-1 text-sm text-muted">{t(`admin.reports.descriptions.${type}`)}</p>
            <Button
              className="mt-5 self-start"
              variant="outline"
              loading={busy === type}
              disabled={invalidRange && !UNDATED.includes(type)}
              onClick={() => void download(type)}
            >
              <Download aria-hidden />
              {t("admin.reports.download")}
            </Button>
          </Card>
        ))}
      </div>
    </div>
  );
}
