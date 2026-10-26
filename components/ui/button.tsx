import { cva, type VariantProps } from "class-variance-authority";
import { Loader2 } from "lucide-react";
import Link from "next/link";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

export const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap font-medium transition-colors select-none disabled:opacity-50 disabled:pointer-events-none [&_svg]:size-5 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        primary: "bg-ink text-white hover:bg-neutral-800 active:bg-neutral-900",
        secondary: "bg-subtle text-ink hover:bg-neutral-200",
        outline: "border border-line bg-paper text-ink hover:bg-subtle",
        ghost: "text-ink hover:bg-subtle",
        danger: "bg-error-ink text-white hover:bg-red-800",
        success: "bg-success text-ink hover:bg-green-400",
        inverse: "bg-paper text-ink hover:bg-neutral-100",
        link: "text-ink underline-offset-4 hover:underline px-0 h-auto",
      },
      size: {
        sm: "h-8 px-3 text-sm rounded-input [&_svg]:size-4",
        md: "h-10 px-4 text-sm rounded-card",
        lg: "h-12 px-5 text-base rounded-card",
        xl: "h-14 px-6 text-lg font-semibold rounded-full",
        icon: "size-10 rounded-card",
        iconSm: "size-8 rounded-input [&_svg]:size-4",
      },
      block: { true: "w-full" },
    },
    defaultVariants: { variant: "primary", size: "md" },
  },
);

type ButtonProps = ComponentProps<"button"> & VariantProps<typeof buttonVariants> & { loading?: boolean };

export function Button({ className, variant, size, block, loading, disabled, children, type = "button", ...props }: ButtonProps) {
  return (
    <button
      type={type}
      className={cn(buttonVariants({ variant, size, block }), className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading ? <Loader2 className="animate-spin" aria-hidden /> : null}
      {children}
    </button>
  );
}

type ButtonLinkProps = ComponentProps<typeof Link> & VariantProps<typeof buttonVariants>;

export function ButtonLink({ className, variant, size, block, ...props }: ButtonLinkProps) {
  return <Link className={cn(buttonVariants({ variant, size, block }), className)} {...props} />;
}
