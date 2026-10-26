"use client";

import { useLocations } from "@/components/location-picker";
import { Select } from "@/components/ui/form";
import { useT } from "@/lib/i18n";

/** Native select of locations (bus parks first) for staff forms. */
export function LocationSelect({
  value,
  onChange,
  stationsOnly,
  exclude,
  placeholder,
  ...props
}: {
  value: string;
  onChange: (id: string) => void;
  stationsOnly?: boolean;
  exclude?: string[];
  placeholder?: string;
  disabled?: boolean;
  id?: string;
  "aria-invalid"?: boolean;
  "aria-describedby"?: string;
}) {
  const t = useT();
  const { data } = useLocations();
  const list = (data ?? []).filter((l) => l.active && (!stationsOnly || l.isStation) && !exclude?.includes(l.id));
  const stations = list.filter((l) => l.isStation);
  const others = list.filter((l) => !l.isStation);
  return (
    <Select value={value} onChange={(e) => onChange(e.target.value)} {...props}>
      <option value="">{placeholder ?? t("common.selectPlaceholder")}</option>
      <optgroup label={t("home.stations")}>
        {stations.map((l) => (
          <option key={l.id} value={l.id}>
            {l.name}
          </option>
        ))}
      </optgroup>
      {others.length ? (
        <optgroup label={t("home.otherStops")}>
          {others.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </optgroup>
      ) : null}
    </Select>
  );
}
