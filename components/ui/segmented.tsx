"use client";

import { cn } from "@/lib/utils";

/** Filter chips ("All · Morning · Afternoon · Evening"). */
export function Chips<T extends string>({
  options,
  value,
  onChange,
  label,
  className,
  size = "md",
}: {
  options: { value: T; label: string; count?: number }[];
  value: T;
  onChange: (value: T) => void;
  label: string;
  className?: string;
  size?: "sm" | "md";
}) {
  return (
    <div role="radiogroup" aria-label={label} className={cn("flex gap-2 overflow-x-auto scrollbar-none", className)}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          // biome-ignore lint/a11y/useSemanticElements: chip styling needs a button with radio semantics
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(o.value)}
            className={cn(
              "shrink-0 whitespace-nowrap rounded-full border font-medium transition-colors",
              size === "sm" ? "px-3 py-1 text-sm" : "px-4 py-2 text-[15px]",
              active ? "border-ink bg-ink text-white" : "border-line bg-paper text-ink hover:bg-subtle",
            )}
          >
            {o.label}
            {o.count !== undefined ? <span className={cn("ml-1.5", active ? "text-neutral-300" : "text-muted")}>{o.count}</span> : null}
          </button>
        );
      })}
    </div>
  );
}

/** Compact segmented control (Week · Month · Year). */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  label: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-card border border-line bg-paper p-1">
      {options.map((o) => (
        // biome-ignore lint/a11y/useSemanticElements: segmented control
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          onClick={() => onChange(o.value)}
          className={cn(
            "rounded-input px-4 py-1.5 text-sm font-medium transition-colors",
            o.value === value ? "bg-ink text-white" : "text-muted hover:text-ink",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
