import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/utils";

export function Card({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("rounded-card border border-line bg-paper", className)} {...props} />;
}

export function CardHeader({
  title,
  subtitle,
  action,
  className,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex items-start justify-between gap-3 px-5 pt-5", className)}>
      <div className="min-w-0">
        <h2 className="text-lg font-semibold">{title}</h2>
        {subtitle ? <p className="mt-0.5 text-sm text-muted">{subtitle}</p> : null}
      </div>
      {action}
    </div>
  );
}

export function CardBody({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("p-5", className)} {...props} />;
}

/** Dashboard metric tile. `highlight` renders the black hero variant from the FIKA designs. */
export function StatCard({
  label,
  value,
  hint,
  hintTone = "muted",
  highlight,
  icon,
}: {
  label: ReactNode;
  value: ReactNode;
  hint?: ReactNode;
  hintTone?: "muted" | "success" | "warning" | "error";
  highlight?: boolean;
  icon?: ReactNode;
}) {
  const tone = {
    muted: highlight ? "text-neutral-300" : "text-muted",
    success: highlight ? "text-green-400" : "text-success-ink",
    warning: highlight ? "text-amber-300" : "text-warning-ink",
    error: highlight ? "text-red-300" : "text-error-ink",
  }[hintTone];
  return (
    <div className={cn("rounded-card border p-5", highlight ? "border-ink bg-ink text-white" : "border-line bg-paper")}>
      <div className="flex items-center justify-between gap-2">
        <p className={cn("text-sm", highlight ? "text-neutral-300" : "text-muted")}>{label}</p>
        {icon ? <span className={highlight ? "text-neutral-400" : "text-faint"}>{icon}</span> : null}
      </div>
      <p className="mt-2 text-3xl font-bold tracking-tight tabular">{value}</p>
      {hint ? <p className={cn("mt-1 text-sm", tone)}>{hint}</p> : null}
    </div>
  );
}

export function PageHeader({
  title,
  subtitle,
  actions,
  className,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-wrap items-end justify-between gap-4", className)}>
      <div className="min-w-0">
        <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
        {subtitle ? <p className="mt-1 text-[15px] text-muted">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}
