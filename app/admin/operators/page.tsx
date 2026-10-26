"use client";

import { useQuery } from "@tanstack/react-query";
import { Building2, ChevronRight } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { StatusBadge } from "@/components/status";
import { Avatar } from "@/components/ui/avatar";
import { PageHeader } from "@/components/ui/card";
import { EmptyState, PageLoader } from "@/components/ui/feedback";
import { Chips } from "@/components/ui/segmented";
import { Table, TableCard, Td, Th, Tr } from "@/components/ui/table";
import { apiFetch } from "@/lib/api";
import { formatDate } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import { formatPhone } from "@/shared/money";
import type { OperatorDTO } from "@/shared/types";

const FILTERS = ["all", "pending", "approved", "suspended", "rejected"] as const;
type Filter = (typeof FILTERS)[number];

export default function AdminOperatorsPage() {
  const { t, locale } = useI18n();
  const [status, setStatus] = useState<Filter>("all");
  const { data, isLoading } = useQuery({
    queryKey: ["admin", "operators", status],
    queryFn: () => apiFetch<OperatorDTO[]>("/admin/operators", { query: { status } }),
  });

  return (
    <div className="space-y-6">
      <PageHeader title={t("admin.operators.title")} subtitle={t("admin.operators.subtitle")} />
      <Chips
        label={t("common.filter")}
        value={status}
        onChange={setStatus}
        options={FILTERS.map((f) => ({ value: f, label: t(`admin.operators.filters.${f}`) }))}
      />
      <TableCard>
        {isLoading ? (
          <PageLoader />
        ) : !data?.length ? (
          <EmptyState icon={<Building2 className="size-5" />} title={t("admin.operators.empty")} />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>{t("admin.operators.columns.operator")}</Th>
                <Th>{t("admin.operators.columns.licence")}</Th>
                <Th>{t("admin.operators.columns.contact")}</Th>
                <Th>{t("admin.operators.columns.status")}</Th>
                <Th>{t("admin.operators.columns.joined")}</Th>
                <Th>
                  <span className="sr-only">{t("common.view")}</span>
                </Th>
              </tr>
            </thead>
            <tbody>
              {data.map((o) => (
                <Tr key={o.id}>
                  <Td>
                    <Link href={`/admin/operators/${o.id}`} className="flex items-center gap-3 font-medium hover:underline">
                      <Avatar name={o.name} className="size-9" />
                      {o.name}
                    </Link>
                  </Td>
                  <Td className="font-mono text-sm">{o.registrationNumber}</Td>
                  <Td>
                    <p className="text-sm tabular">{formatPhone(o.contactPhone)}</p>
                    {o.contactEmail ? <p className="text-sm text-muted">{o.contactEmail}</p> : null}
                  </Td>
                  <Td>
                    <StatusBadge kind="operator" status={o.status} />
                  </Td>
                  <Td className="whitespace-nowrap text-sm text-muted">{formatDate(o.createdAt, locale)}</Td>
                  <Td className="text-right">
                    <Link href={`/admin/operators/${o.id}`} aria-label={`${t("common.view")} ${o.name}`} className="inline-flex text-muted hover:text-ink">
                      <ChevronRight className="size-5" aria-hidden />
                    </Link>
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </TableCard>
    </div>
  );
}
