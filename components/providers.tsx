"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { type ReactNode, useState } from "react";
import { Toaster } from "sonner";
import { ApiError } from "@/lib/api";
import { AuthProvider } from "@/lib/auth";
import { I18nProvider } from "@/lib/i18n";
import type { Locale } from "@/shared/constants";
import type { Messages } from "@/shared/i18n";

export function Providers({ locale, messages, children }: { locale: Locale; messages: Messages; children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 15_000,
            refetchOnWindowFocus: true,
            retry: (count, err) => !(err instanceof ApiError && err.status >= 400 && err.status < 500) && count < 2,
          },
        },
      }),
  );
  return (
    <QueryClientProvider client={queryClient}>
      <I18nProvider initialLocale={locale} initialMessages={messages}>
        <AuthProvider>
          {children}
          <Toaster position="top-center" richColors closeButton toastOptions={{ className: "font-sans" }} />
        </AuthProvider>
      </I18nProvider>
    </QueryClientProvider>
  );
}
