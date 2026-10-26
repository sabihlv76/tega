import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

export function TableCard({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("overflow-hidden rounded-card border border-line bg-paper", className)} {...props} />;
}

export function Table({ className, ...props }: ComponentProps<"table">) {
  return (
    <div className="overflow-x-auto">
      <table className={cn("w-full border-collapse text-left text-[15px]", className)} {...props} />
    </div>
  );
}

export function Th({ className, ...props }: ComponentProps<"th">) {
  return (
    <th
      scope="col"
      className={cn("whitespace-nowrap border-b border-line px-5 py-3 text-sm font-medium text-muted", className)}
      {...props}
    />
  );
}

export function Td({ className, ...props }: ComponentProps<"td">) {
  return <td className={cn("border-b border-line px-5 py-4 align-middle last:border-r-0", className)} {...props} />;
}

export function Tr({ className, ...props }: ComponentProps<"tr">) {
  return <tr className={cn("last:[&>td]:border-b-0 hover:bg-canvas/60", className)} {...props} />;
}
