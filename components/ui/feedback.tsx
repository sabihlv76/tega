import { AlertTriangle, CheckCircle2, Info, Loader2, XCircle } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/utils";

export type Tone = "neutral" | "success" | "warning" | "error" | "info" | "dark";

const badgeTones: Record<Tone, string> = {
  neutral: "bg-subtle text-muted",
  success: "bg-success-soft text-success-ink",
  warning: "bg-warning-soft text-warning-ink",
  error: "bg-error-soft text-error-ink",
  info: "bg-sky-50 text-sky-800",
  dark: "bg-ink text-white",
};

export function Badge({ tone = "neutral", className, ...props }: ComponentProps<"span"> & { tone?: Tone }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 whitespace-nowrap rounded-tag px-2 py-0.5 text-xs font-semibold",
        badgeTones[tone],
        className,
      )}
      {...props}
    />
  );
}

/** Coloured dot + text, as used for "12 places left" in the designs. */
export function Dot({ tone = "success", children }: { tone?: Exclude<Tone, "dark" | "info">; children: ReactNode }) {
  const colors = {
    neutral: ["bg-faint", "text-muted"],
    success: ["bg-success", "text-success-ink"],
    warning: ["bg-warning", "text-warning-ink"],
    error: ["bg-error", "text-error-ink"],
  }[tone];
  return (
    <span className={cn("inline-flex items-center gap-2 text-sm font-medium", colors[1])}>
      <span className={cn("size-2 rounded-full", colors[0])} aria-hidden />
      {children}
    </span>
  );
}

export function Spinner({ className, label }: { className?: string; label?: string }) {
  return (
    <span role="status" className="inline-flex items-center gap-2 text-muted">
      <Loader2 className={cn("size-5 animate-spin", className)} aria-hidden />
      {label ? <span className="text-sm">{label}</span> : <span className="sr-only">Loading</span>}
    </span>
  );
}

export function PageLoader({ label }: { label?: string }) {
  return (
    <div className="flex min-h-[40vh] items-center justify-center">
      <Spinner label={label} />
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded-card bg-subtle", className)} aria-hidden />;
}

export function EmptyState({
  icon,
  title,
  body,
  action,
  className,
}: {
  icon?: ReactNode;
  title: ReactNode;
  body?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center justify-center px-6 py-12 text-center", className)}>
      {icon ? <div className="mb-3 flex size-12 items-center justify-center rounded-full bg-subtle text-muted">{icon}</div> : null}
      <p className="text-[15px] font-semibold">{title}</p>
      {body ? <p className="mt-1 max-w-sm text-sm text-muted">{body}</p> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

const alertTones = {
  info: { box: "border-line bg-paper", icon: <Info className="size-5 text-ink" aria-hidden /> },
  success: { box: "border-green-200 bg-success-soft", icon: <CheckCircle2 className="size-5 text-success-ink" aria-hidden /> },
  warning: { box: "border-amber-200 bg-warning-soft", icon: <AlertTriangle className="size-5 text-warning-ink" aria-hidden /> },
  error: { box: "border-red-200 bg-error-soft", icon: <XCircle className="size-5 text-error-ink" aria-hidden /> },
};

export function Alert({
  tone = "info",
  title,
  children,
  action,
  className,
}: {
  tone?: keyof typeof alertTones;
  title?: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  const t = alertTones[tone];
  return (
    <div className={cn("flex items-start gap-3 rounded-card border p-4", t.box, className)} role={tone === "error" ? "alert" : "status"}>
      <span className="mt-0.5 shrink-0">{t.icon}</span>
      <div className="min-w-0 flex-1">
        {title ? <p className="font-semibold">{title}</p> : null}
        {children ? <div className="text-sm text-muted">{children}</div> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}
