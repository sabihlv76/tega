import Link from "next/link";
import { cn } from "@/lib/utils";

export function BoltMark({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex size-8 items-center justify-center rounded-[8px] bg-ink text-white", className)} aria-hidden>
      <svg viewBox="0 0 24 24" className="size-[60%]" fill="currentColor">
        <path d="M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z" />
      </svg>
    </span>
  );
}

export function Logo({ href = "/", className, label }: { href?: string; className?: string; label?: string }) {
  return (
    <Link href={href} className={cn("inline-flex items-center gap-2.5", className)} aria-label="FIKA home">
      <BoltMark />
      <span className="text-xl font-bold tracking-tight">FIKA</span>
      {label ? <span className="text-xs font-medium uppercase tracking-[0.18em] text-muted">{label}</span> : null}
    </Link>
  );
}
