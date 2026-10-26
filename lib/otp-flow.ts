"use client";

// Carries the sign-in attempt from /auth/login to /auth/verify within the tab (never persisted).

export interface OtpFlow {
  channel: "sms" | "email";
  target: string;
  destination: string;
  devCode?: string;
  next?: string | null;
}

const KEY = "fika_otp_flow";

export function saveOtpFlow(flow: OtpFlow): void {
  sessionStorage.setItem(KEY, JSON.stringify(flow));
}

export function readOtpFlow(): OtpFlow | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as OtpFlow) : null;
  } catch {
    return null;
  }
}

export function clearOtpFlow(): void {
  sessionStorage.removeItem(KEY);
}
