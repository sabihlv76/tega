"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Download, ReceiptText } from "lucide-react";
import { useState } from "react";
import { StatusBadge } from "@/components/status";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/card";
import { EmptyState, PageLoader } from "@/components/ui/feedback";
import { Input, Select } from "@/components/ui/form";
import { Chips } from "@/components/ui/segmented";
import { Table, TableCard, Td, Th, Tr } from "@/components/ui/table";
import { apiFetch, downloadFile } from "@/lib/api";
import { toastError } from "@/lib/errors";
import { formatDateTime } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import { useSocketEvent } from "@/lib/socket";
import { formatPhone, formatRwf } from "@/shared/money";
import { formatClock, kigaliDate } from "@/shared/time";
import type { ManifestBookingDTO, StationTripDTO } from "@/shared/types";

const FILTERS = ["all", "confirmed", "pending_payment", "checked_in", "cancelled"] as const;
type Filter = (typeof FILTERS)[number];

export default function OperatorBookingsPage() {
  const { t, locale } = useI18n();
  const queryClient = useQueryClient();
  const [date, setDate] = useState(kigaliDate());
  const [status, setStatus] = useState<Filter>("all");
  const [tripId, setTripId] = useState("");
  const [exporting, setExporting] = useState(false);

  const trips = useQuery({
    queryKey: ["operator", "trips", date],
    queryFn: () => apiFetch<StationTripDTO[]>("/operator/trips", { query: { date } }),
  });
  const bookings = useQuery({
    queryKey: ["operator", "bookings", date, status, tripId],
    queryFn: () => apiFetch<ManifestBookingDTO[]>("/operator/bookings", { query: { date, status, tripId } }),
  });
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ["operator", "bookings"] });
  useSocketEvent("booking.created", refresh);
  useSocketEvent("checkin.created", refresh);

  const exportCsv = async () => {
    setExporting(true);
    try {
      await downloadFile("/operator/bookings.csv", `fika-bookings-${date}.csv`, { date });
    } catch (err) {
      toastError(err, t);
    } finally {
      setExporting(false);
    }
  };

  const rows = bookings.data ?? [];
  const sold = rows.filter((b) => b.status === "confirmed" || b.status === "completed");
  const places = sold.reduce((sum, b) => sum + b.places, 0);
  const amount = sold.reduce((sum, b) => sum + b.totalAmount, 0);

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("operator.bookings.title")}
        subtitle={t("operator.bookings.subtitle")}
        actions={
          <>
            <Input
              type="date"
              value={date}
              onChange={(e) => {
                if (!e.target.value) return;
                setDate(e.target.value);
                setTripId("");
              }}
              aria-label={t("common.date")}
              className="h-12 w-44"
            />
            <Button size="lg" variant="outline" loading={exporting} onClick={() => void exportCsv()}>
              <Download aria-hidden />
              {t("common.export")}
            </Button>
          </>
        }
      />

      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <Chips
          label={t("common.filter")}
          value={status}
          onChange={setStatus}
          options={FILTERS.map((f) => ({ value: f, label: t(`operator.bookings.filters.${f}`) }))}
        />
        <div className="w-full lg:w-72">
          <Select value={tripId} onChange={(e) => setTripId(e.target.value)} aria-label={t("operator.bookings.columns.trip")}>
            <option value="">{t("operator.bookings.allTrips")}</option>
            {(trips.data ?? []).map((trip) => (
              <option key={trip.id} value={trip.id}>
                {formatClock(trip.departureAt)} · {trip.origin.name} → {trip.destination.name} · {trip.plateNumber}
              </option>
            ))}
          </Select>
        </div>
      </div>

      {rows.length > 0 ? (
        <p className="text-sm text-muted">
          {t("common.places", { count: places })} · <span className="font-semibold text-ink tabular">{formatRwf(amount)}</span>
        </p>
      ) : null}

      <TableCard>
        {bookings.isLoading ? (
          <PageLoader />
        ) : rows.length === 0 ? (
          <EmptyState icon={<ReceiptText className="size-5" />} title={t("operator.bookings.empty")} />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>{t("operator.bookings.columns.reference")}</Th>
                <Th>{t("operator.bookings.columns.traveler")}</Th>
                <Th>{t("operator.bookings.columns.trip")}</Th>
                <Th className="text-right">{t("operator.bookings.columns.places")}</Th>
                <Th className="text-right">{t("operator.bookings.columns.amount")}</Th>
                <Th>{t("operator.bookings.columns.payment")}</Th>
                <Th>{t("operator.bookings.columns.status")}</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((b) => (
                <Tr key={b.id}>
                  <Td>
                    <p className="font-mono text-sm font-semibold">{b.reference}</p>
                    <p className="text-xs text-muted">{formatDateTime(b.createdAt, locale)}</p>
                  </Td>
                  <Td>
                    <p className="font-medium">{b.travelerName}</p>
                    <p className="text-sm text-muted tabular">{formatPhone(b.travelerPhone)}</p>
                  </Td>
                  <Td>
                    <p className="font-medium">
                      <span className="tabular">{formatClock(b.trip.departureAt)}</span> · {b.trip.origin.name} → {b.trip.destination.name}
                    </p>
                    <p className="font-mono text-xs text-muted">{b.trip.plateNumber}</p>
                  </Td>
                  <Td className="text-right tabular">{b.places}</Td>
                  <Td className="text-right font-semibold tabular">{formatRwf(b.totalAmount)}</Td>
                  <Td>
                    <StatusBadge kind="payment" status={b.paymentStatus} />
                  </Td>
                  <Td>
                    <div className="flex flex-col items-start gap-1">
                      <StatusBadge kind="booking" status={b.status} />
                      {b.checkedInAt ? (
                        <span className="inline-flex items-center gap-1 text-xs font-medium text-success-ink">
                          <CheckCircle2 className="size-3.5" aria-hidden />
                          {t("operator.bookings.checkedIn")}
                        </span>
                      ) : null}
                    </div>
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
