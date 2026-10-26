import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

export function initials(name: string | null | undefined): string {
  if (!name) return "•";
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : "")).toUpperCase() || "•";
}

/** Next.js navigation targets for each staff role. */
export function homeForRole(role: string | undefined): string {
  switch (role) {
    case "admin":
      return "/admin";
    case "operator":
      return "/operator";
    case "station":
      return "/station";
    default:
      return "/";
  }
}

export function safeNextPath(value: string | null | undefined): string | null {
  return value && /^\/(?!\/)/.test(value) ? value : null;
}
