import { cn, initials } from "@/lib/utils";

export function Avatar({ name, className, inverse }: { name: string | null | undefined; className?: string; inverse?: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex size-10 shrink-0 items-center justify-center rounded-full text-sm font-semibold",
        inverse ? "bg-white/15 text-white" : "bg-ink text-white",
        className,
      )}
      aria-hidden
    >
      {initials(name)}
    </span>
  );
}
