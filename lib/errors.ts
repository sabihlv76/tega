"use client";

import { toast } from "sonner";
import type { Translator } from "@/shared/i18n";
import { ApiError } from "./api";

/** Human message for an API error, in the current language. */
export function errorMessage(err: unknown, t: Translator): string {
  if (err instanceof ApiError) {
    const key = `errors.${err.code}`;
    const translated = t(key);
    return translated === key ? err.message || t("common.somethingWrong") : translated;
  }
  return t("common.somethingWrong");
}

export function toastError(err: unknown, t: Translator): void {
  toast.error(errorMessage(err, t));
}
