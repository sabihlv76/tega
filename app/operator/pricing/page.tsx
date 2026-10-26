"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Route as RouteIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { StatusBadge } from "@/components/status";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader, PageHeader } from "@/components/ui/card";
import { Alert, EmptyState, PageLoader } from "@/components/ui/feedback";
import { Field, Input, Switch } from "@/components/ui/form";
import { Table, TableCard, Td, Th, Tr } from "@/components/ui/table";
import { apiFetch } from "@/lib/api";
import { usePublicConfig } from "@/lib/config";
import { errorMessage } from "@/lib/errors";
import { useI18n } from "@/lib/i18n";
import { capStatusFor, formatRwf, parcelPrice } from "@/shared/money";
import type { OperatorDTO, RouteDTO } from "@/shared/types";

const EXAMPLE_KG = 5;
const digits = (value: string) => value.replace(/[^0-9]/g, "").slice(0, 6);

export default function PricingPage() {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const config = usePublicConfig();
  const routes = useQuery({ queryKey: ["operator", "routes"], queryFn: () => apiFetch<RouteDTO[]>("/operator/routes") });
  const operator = useQuery({ queryKey: ["operator", "me"], queryFn: () => apiFetch<OperatorDTO>("/operator/me") });
  const [prices, setPrices] = useState<Record<string, string>>({});
  const [parcel, setParcel] = useState({ enabled: false, perKg: "", minimum: "" });

  useEffect(() => {
    if (routes.data) setPrices(Object.fromEntries(routes.data.map((r) => [r.id, String(r.priceRwf)])));
  }, [routes.data]);
  useEffect(() => {
    if (!operator.data) return;
    const p = operator.data.parcelPricing;
    setParcel({ enabled: p.enabled, perKg: String(p.perKg), minimum: String(p.minimum) });
  }, [operator.data]);

  const priceOf = (r: RouteDTO) => Number(prices[r.id] ?? r.priceRwf) || 0;
  const changed = (routes.data ?? []).filter((r) => priceOf(r) !== r.priceRwf);
  const blockMode = config.data?.fareCapEnforcement === "block";
  const blocked = blockMode ? changed.filter((r) => capStatusFor(priceOf(r), r.capRwf) === "above_cap") : [];
  const invalid = changed.some((r) => priceOf(r) <= 0);
  const current = operator.data?.parcelPricing;
  const parcelChanged =
    !!current &&
    (parcel.enabled !== current.enabled || Number(parcel.perKg) !== current.perKg || Number(parcel.minimum) !== current.minimum);
  const dirty = changed.length > 0 || parcelChanged;

  const save = useMutation({
    mutationFn: () =>
      apiFetch("/operator/pricing", {
        method: "PATCH",
        body: {
          routes: changed.map((r) => ({ id: r.id, priceRwf: priceOf(r) })),
          parcelPricing: parcelChanged
            ? { enabled: parcel.enabled, perKg: Number(parcel.perKg) || 0, minimum: Number(parcel.minimum) || 0 }
            : undefined,
        },
      }),
    onSuccess: () => {
      toast.success(t("operator.pricing.saved"));
      void queryClient.invalidateQueries({ queryKey: ["operator"] });
    },
  });

  if (routes.isLoading || operator.isLoading) return <PageLoader />;

  const perKg = Number(parcel.perKg) || 0;
  const minimum = Number(parcel.minimum) || 0;

  return (
    <div className="space-y-8">
      <PageHeader
        title={t("operator.pricing.title")}
        subtitle={t("operator.pricing.subtitle")}
        actions={
          <Button size="lg" disabled={!dirty || invalid || blocked.length > 0} loading={save.isPending} onClick={() => save.mutate()}>
            {t("common.save")}
          </Button>
        }
      />

      {blocked.length > 0 ? (
        <Alert tone="error" title={t("operator.routes.priceBlocked", { cap: blocked.map((r) => formatRwf(r.capRwf ?? 0)).join(", ") })} />
      ) : null}
      {save.error ? <Alert tone="error" title={errorMessage(save.error, t)} /> : null}

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">{t("operator.pricing.routePrices")}</h2>
        <TableCard>
          {!routes.data?.length ? (
            <EmptyState icon={<RouteIcon className="size-5" />} title={t("operator.routes.empty")} />
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>{t("operator.routes.columns.route")}</Th>
                  <Th className="text-right">{t("operator.pricing.ruraCap")}</Th>
                  <Th>{t("operator.routes.priceRwf")}</Th>
                  <Th>{t("common.status")}</Th>
                </tr>
              </thead>
              <tbody>
                {routes.data.map((r) => {
                  const price = priceOf(r);
                  const diff = r.capRwf === null ? null : r.capRwf - price;
                  return (
                    <Tr key={r.id}>
                      <Td>
                        <p className="font-medium">
                          {r.origin.name} → {r.destination.name}
                        </p>
                        {r.via.length ? (
                          <p className="text-sm text-muted">{t("common.via", { stops: r.via.map((v) => v.name).join(", ") })}</p>
                        ) : null}
                      </Td>
                      <Td className="text-right tabular">{r.capRwf === null ? "-" : formatRwf(r.capRwf)}</Td>
                      <Td>
                        <div className="flex items-center gap-2">
                          <Input
                            inputMode="numeric"
                            value={prices[r.id] ?? ""}
                            onChange={(e) => setPrices((p) => ({ ...p, [r.id]: digits(e.target.value) }))}
                            aria-label={`${t("operator.routes.priceRwf")} · ${r.origin.name} → ${r.destination.name}`}
                            className="h-10 w-32 tabular"
                          />
                          {diff !== null && price > 0 ? (
                            <span className={diff >= 0 ? "text-sm text-success-ink" : "text-sm font-medium text-warning-ink"}>
                              {diff >= 0
                                ? t("operator.pricing.underCap", { amount: formatRwf(diff) })
                                : t("operator.pricing.overCap", { amount: formatRwf(-diff) })}
                            </span>
                          ) : null}
                        </div>
                      </Td>
                      <Td>
                        <StatusBadge kind="cap" status={capStatusFor(price, r.capRwf)} />
                      </Td>
                    </Tr>
                  );
                })}
              </tbody>
            </Table>
          )}
        </TableCard>
      </section>

      <Card>
        <CardHeader title={t("operator.pricing.parcelPricing")} />
        <CardBody className="space-y-4">
          <Switch label={t("operator.pricing.acceptParcels")} checked={parcel.enabled} onChange={(enabled) => setParcel((p) => ({ ...p, enabled }))} />
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t("operator.pricing.perKg")}>
              {(p) => (
                <Input
                  {...p}
                  inputMode="numeric"
                  disabled={!parcel.enabled}
                  value={parcel.perKg}
                  onChange={(e) => setParcel((s) => ({ ...s, perKg: digits(e.target.value) }))}
                />
              )}
            </Field>
            <Field label={t("operator.pricing.minimum")}>
              {(p) => (
                <Input
                  {...p}
                  inputMode="numeric"
                  disabled={!parcel.enabled}
                  value={parcel.minimum}
                  onChange={(e) => setParcel((s) => ({ ...s, minimum: digits(e.target.value) }))}
                />
              )}
            </Field>
          </div>
          {parcel.enabled && perKg > 0 ? (
            <p className="text-sm text-muted">
              {t("operator.pricing.example", { kg: EXAMPLE_KG, price: formatRwf(parcelPrice(EXAMPLE_KG, perKg, minimum)) })}
            </p>
          ) : null}
        </CardBody>
      </Card>
    </div>
  );
}
