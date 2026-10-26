import type { Metadata, Viewport } from "next";
import { Space_Grotesk } from "next/font/google";
import { Providers } from "@/components/providers";
import { requestLocale } from "@/lib/server";
import { catalogs } from "@/shared/i18n/catalog";
import "./globals.css";

const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-space-grotesk",
  display: "swap",
});

export const metadata: Metadata = {
  title: { default: "FIKA · Bus tickets & parcels in Rwanda", template: "%s · FIKA" },
  description:
    "Book intercity bus tickets, pay with MTN MoMo or Airtel Money, show your QR ticket at the station and send parcels across Rwanda.",
  applicationName: "FIKA",
  appleWebApp: { capable: true, title: "FIKA", statusBarStyle: "default" },
  formatDetection: { telephone: false },
  icons: {
    icon: [
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180" }],
  },
};

export const viewport: Viewport = {
  themeColor: "#000000",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await requestLocale();

  return (
    <html lang={locale} className={spaceGrotesk.variable}>
      <body className="min-h-dvh">
        <Providers locale={locale} messages={catalogs[locale]}>
          {children}
        </Providers>
      </body>
    </html>
  );
}
