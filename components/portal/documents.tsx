"use client";

import { useMutation } from "@tanstack/react-query";
import { FileText, Upload } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/feedback";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/form";
import { apiFetch, openProtectedFile } from "@/lib/api";
import { errorMessage, toastError } from "@/lib/errors";
import { formatDate } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import { DOCUMENT_TYPES, type DocumentType } from "@/shared/constants";
import type { FileRef } from "@/shared/types";

export function DocumentList({ documents, onVerify }: { documents: FileRef[]; onVerify?: (doc: FileRef) => void }) {
  const { t, locale } = useI18n();
  if (!documents.length) return <p className="text-sm text-muted">{t("admin.operators.noDocuments")}</p>;
  return (
    <ul className="divide-y divide-line rounded-card border border-line">
      {documents.map((d) => (
        <li key={d.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
          <FileText className="size-5 text-muted" aria-hidden />
          <div className="min-w-0 flex-1">
            <button
              type="button"
              className="truncate text-left font-medium underline-offset-4 hover:underline"
              onClick={() => void openProtectedFile(d.id).catch((err) => toastError(err, t))}
            >
              {t(`operator.documents.${d.type}`)}
            </button>
            <p className="truncate text-sm text-muted">
              {d.filename}
              {d.expiresAt ? ` · ${t("operator.vehicles.expires", { date: formatDate(d.expiresAt, locale) })}` : ""}
            </p>
          </div>
          {d.verified ? <Badge tone="success">{t("operator.vehicles.verified")}</Badge> : <Badge tone="warning">{t("operator.vehicles.unverified")}</Badge>}
          {onVerify && !d.verified ? (
            <Button size="sm" variant="outline" onClick={() => onVerify(d)}>
              {t("admin.operators.verify")}
            </Button>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

export function DocumentUpload({
  endpoint,
  types = DOCUMENT_TYPES,
  onUploaded,
}: {
  endpoint: string;
  types?: readonly DocumentType[];
  onUploaded: () => void;
}) {
  const { t } = useI18n();
  const [type, setType] = useState<DocumentType>(types[0]);
  const [expiresAt, setExpiresAt] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const upload = useMutation({
    mutationFn: () => {
      const form = new FormData();
      form.set("type", type);
      if (expiresAt) form.set("expiresAt", expiresAt);
      if (file) form.set("file", file);
      return apiFetch(endpoint, { method: "POST", form });
    },
    onSuccess: () => {
      toast.success(t("common.saved"));
      setFile(null);
      setExpiresAt("");
      onUploaded();
    },
  });
  return (
    <div className="space-y-3 rounded-card border border-dashed border-line p-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t("operator.vehicles.documentType")}>
          {(p) => (
            <Select {...p} value={type} onChange={(e) => setType(e.target.value as DocumentType)}>
              {types.map((d) => (
                <option key={d} value={d}>
                  {t(`operator.documents.${d}`)}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label={t("operator.vehicles.expiresOn")} optional={t("common.optional")}>
          {(p) => <Input {...p} type="date" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} />}
        </Field>
      </div>
      <input
        type="file"
        accept="application/pdf,image/jpeg,image/png,image/webp"
        onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        aria-label={t("operator.vehicles.upload")}
        className="block w-full text-sm file:mr-3 file:rounded-input file:border-0 file:bg-subtle file:px-3 file:py-2 file:text-sm file:font-medium"
      />
      {upload.error ? <p className="text-sm text-error-ink">{errorMessage(upload.error, t)}</p> : null}
      <Button size="sm" disabled={!file} loading={upload.isPending} onClick={() => upload.mutate()}>
        <Upload aria-hidden />
        {t("operator.vehicles.upload")}
      </Button>
    </div>
  );
}
