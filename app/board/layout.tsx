import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Departures",
  description: "Live departures from FIKA bus parks across Rwanda.",
};

export const viewport: Viewport = { themeColor: "#000000" };

export default function BoardLayout({ children }: { children: ReactNode }) {
  return children;
}
