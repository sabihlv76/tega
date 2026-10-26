"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect } from "react";
import { PageLoader } from "@/components/ui/feedback";
import { useAuth } from "@/lib/auth";
import { useT } from "@/lib/i18n";
import { homeForRole, safeNextPath } from "@/lib/utils";

/** Landing page after Google sign-in: the API already set the refresh cookie. */
function Complete() {
  const t = useT();
  const router = useRouter();
  const params = useSearchParams();
  const { user, status, reload } = useAuth();
  const next = safeNextPath(params.get("next"));

  // biome-ignore lint/correctness/useExhaustiveDependencies: refresh once after the OAuth redirect
  useEffect(() => {
    void reload();
  }, []);

  useEffect(() => {
    if (status === "authenticated" && user) {
      router.replace(user.name ? (next ?? homeForRole(user.role)) : `/auth/welcome?next=${encodeURIComponent(next ?? "/")}`);
    }
    if (status === "anonymous") router.replace("/auth/login?error=GOOGLE_FAILED");
  }, [status, user, next, router]);

  return <PageLoader label={t("auth.completing")} />;
}

export default function CompletePage() {
  return (
    <Suspense fallback={<PageLoader />}>
      <Complete />
    </Suspense>
  );
}
