"use client";

import { ChevronDown, Minus, Plus } from "lucide-react";
import { type ComponentProps, type ReactNode, useId, useRef } from "react";
import { cn } from "@/lib/utils";

const control =
  "w-full rounded-input border border-line bg-paper px-3 text-[15px] text-ink placeholder:text-faint transition-colors focus:border-ink focus:outline-none focus:ring-2 focus:ring-black/10 disabled:bg-subtle disabled:text-muted aria-[invalid=true]:border-error-ink";

export function Input({ className, ...props }: ComponentProps<"input">) {
  return <input className={cn(control, "h-11", className)} {...props} />;
}

export function Textarea({ className, ...props }: ComponentProps<"textarea">) {
  return <textarea className={cn(control, "min-h-24 py-2.5", className)} {...props} />;
}

export function Select({ className, children, ...props }: ComponentProps<"select">) {
  return (
    <div className="relative">
      <select className={cn(control, "h-11 appearance-none pr-9", className)} {...props}>
        {children}
      </select>
      <ChevronDown className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden />
    </div>
  );
}

export function Label({ className, ...props }: ComponentProps<"label">) {
  // biome-ignore lint/a11y/noLabelWithoutControl: htmlFor is passed through props
  return <label className={cn("block text-sm font-medium text-ink", className)} {...props} />;
}

/** Label + control + hint/error, wired with ids for screen readers. */
export function Field({
  label,
  hint,
  error,
  children,
  className,
  optional,
}: {
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  optional?: string;
  className?: string;
  children: (props: { id: string; "aria-invalid"?: boolean; "aria-describedby"?: string }) => ReactNode;
}) {
  const id = useId();
  const describedBy = error ? `${id}-error` : hint ? `${id}-hint` : undefined;
  return (
    <div className={cn("space-y-1.5", className)}>
      <Label htmlFor={id}>
        {label}
        {optional ? <span className="ml-1 font-normal text-muted">({optional})</span> : null}
      </Label>
      {children({ id, "aria-invalid": error ? true : undefined, "aria-describedby": describedBy })}
      {error ? (
        <p id={`${id}-error`} className="text-sm text-error-ink" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="text-sm text-muted">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

export function Switch({
  checked,
  onChange,
  label,
  description,
  disabled,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: ReactNode;
  description?: ReactNode;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <div className="flex items-center justify-between gap-4 py-2">
      <div>
        <label htmlFor={id} className="text-[15px] font-medium">
          {label}
        </label>
        {description ? <p className="text-sm text-muted">{description}</p> : null}
      </div>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn(
          "relative h-7 w-12 shrink-0 rounded-full transition-colors disabled:opacity-50",
          checked ? "bg-ink" : "bg-neutral-300",
        )}
      >
        <span
          className={cn(
            "absolute top-1 size-5 rounded-full bg-white shadow transition-transform",
            checked ? "translate-x-6" : "translate-x-1",
          )}
        />
      </button>
    </div>
  );
}

/** +250 prefixed Rwandan mobile number input. */
export function PhoneInput({ className, ...props }: ComponentProps<"input">) {
  return (
    <div
      className={cn(
        "flex h-11 items-center rounded-input border border-line bg-paper focus-within:border-ink focus-within:ring-2 focus-within:ring-black/10",
        className,
      )}
    >
      <span className="border-r border-line px-3 text-[15px] text-muted tabular">+250</span>
      <input
        type="tel"
        inputMode="tel"
        autoComplete="tel-national"
        className="h-full min-w-0 flex-1 bg-transparent px-3 text-[15px] tabular placeholder:text-faint focus:outline-none"
        {...props}
      />
    </div>
  );
}

/** Six single-digit boxes with paste support and auto-advance. */
export function OtpInput({
  value,
  onChange,
  length = 6,
  disabled,
  autoFocus,
  label,
}: {
  value: string;
  onChange: (value: string) => void;
  length?: number;
  disabled?: boolean;
  autoFocus?: boolean;
  label: string;
}) {
  const refs = useRef<(HTMLInputElement | null)[]>([]);
  const digits = Array.from({ length }, (_, i) => value[i] ?? "");
  const setAt = (index: number, digit: string) => {
    const next = digits.slice();
    next[index] = digit;
    onChange(next.join("").slice(0, length));
  };
  return (
    <fieldset className="flex justify-between gap-2" aria-label={label}>
      {digits.map((d, i) => (
        <input
          key={i}
          ref={(el) => {
            refs.current[i] = el;
          }}
          value={d}
          disabled={disabled}
          // biome-ignore lint/a11y/noAutofocus: first OTP box is focused for faster sign-in
          autoFocus={autoFocus && i === 0}
          inputMode="numeric"
          autoComplete={i === 0 ? "one-time-code" : "off"}
          aria-label={`${label} ${i + 1}`}
          maxLength={length}
          className="h-14 w-full min-w-0 rounded-input border border-line bg-paper text-center text-2xl font-semibold tabular focus:border-ink focus:outline-none focus:ring-2 focus:ring-black/10"
          onChange={(e) => {
            const raw = e.target.value.replace(/\D/g, "");
            if (raw.length > 1) {
              onChange(raw.slice(0, length));
              refs.current[Math.min(raw.length, length) - 1]?.focus();
              return;
            }
            setAt(i, raw);
            if (raw && i < length - 1) refs.current[i + 1]?.focus();
          }}
          onKeyDown={(e) => {
            if (e.key === "Backspace" && !d && i > 0) refs.current[i - 1]?.focus();
            if (e.key === "ArrowLeft" && i > 0) refs.current[i - 1]?.focus();
            if (e.key === "ArrowRight" && i < length - 1) refs.current[i + 1]?.focus();
          }}
        />
      ))}
    </fieldset>
  );
}

export function Stepper({
  value,
  onChange,
  min = 1,
  max = 6,
  decreaseLabel,
  increaseLabel,
}: {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  decreaseLabel: string;
  increaseLabel: string;
}) {
  return (
    <div className="inline-flex items-center gap-3">
      <button
        type="button"
        aria-label={decreaseLabel}
        disabled={value <= min}
        onClick={() => onChange(Math.max(min, value - 1))}
        className="flex size-9 items-center justify-center rounded-full border border-line bg-paper disabled:opacity-40"
      >
        <Minus className="size-4" aria-hidden />
      </button>
      <span className="w-6 text-center text-lg font-semibold tabular" aria-live="polite">
        {value}
      </span>
      <button
        type="button"
        aria-label={increaseLabel}
        disabled={value >= max}
        onClick={() => onChange(Math.min(max, value + 1))}
        className="flex size-9 items-center justify-center rounded-full border border-line bg-paper disabled:opacity-40"
      >
        <Plus className="size-4" aria-hidden />
      </button>
    </div>
  );
}
