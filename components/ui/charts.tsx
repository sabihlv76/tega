import { cn } from "@/lib/utils";

/**
 * Minimal bar chart matching the FIKA admin design: light bars with the latest period in black.
 * A visually hidden table carries the same data for screen readers.
 */
export function BarChart({
  data,
  format,
  caption,
  height = 180,
  maxLabels = 12,
}: {
  data: { label: string; value: number; display?: string }[];
  format: (value: number) => string;
  caption: string;
  height?: number;
  maxLabels?: number;
}) {
  const max = Math.max(1, ...data.map((d) => d.value));
  const every = Math.max(1, Math.ceil(data.length / maxLabels));
  return (
    <figure>
      <div className="flex items-end gap-1.5 sm:gap-2" style={{ height }} aria-hidden>
        {data.map((d, i) => {
          const last = i === data.length - 1;
          return (
            <div key={d.label} className="group relative flex h-full min-w-0 flex-1 flex-col justify-end">
              <div
                className={cn("w-full rounded-t-[4px] transition-colors", last ? "bg-ink" : "bg-subtle group-hover:bg-neutral-300")}
                style={{ height: `${Math.max(2, (d.value / max) * 100)}%` }}
              />
              <span className="pointer-events-none absolute -top-7 left-1/2 hidden -translate-x-1/2 whitespace-nowrap rounded-tag bg-ink px-1.5 py-0.5 text-xs text-white group-hover:block">
                {format(d.value)}
              </span>
            </div>
          );
        })}
      </div>
      <div className="mt-2 flex gap-1.5 sm:gap-2" aria-hidden>
        {data.map((d, i) => (
          <span
            key={d.label}
            className={cn("min-w-0 flex-1 truncate text-center text-xs", i === data.length - 1 ? "font-semibold text-ink" : "text-muted")}
          >
            {i % every === 0 || i === data.length - 1 ? (d.display ?? d.label) : ""}
          </span>
        ))}
      </div>
      <table className="sr-only">
        <caption>{caption}</caption>
        <tbody>
          {data.map((d) => (
            <tr key={d.label}>
              <th scope="row">{d.display ?? d.label}</th>
              <td>{format(d.value)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}

/** Horizontal progress bars ("Commission by operator"). */
export function HBars({ rows, format }: { rows: { label: string; value: number }[]; format: (v: number) => string }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <ul className="space-y-4">
      {rows.map((r) => (
        <li key={r.label}>
          <div className="mb-1.5 flex items-center justify-between gap-3 text-[15px]">
            <span className="truncate font-medium">{r.label}</span>
            <span className="shrink-0 font-semibold tabular">{format(r.value)}</span>
          </div>
          <div className="h-2 rounded-full bg-subtle">
            <div className="h-2 rounded-full bg-ink" style={{ width: `${(r.value / max) * 100}%` }} />
          </div>
        </li>
      ))}
    </ul>
  );
}
