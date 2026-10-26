import type { MetadataRoute } from "next";

// Installable PWA (no offline mode required by the FIKA spec).
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "FIKA · Bus tickets & parcels",
    short_name: "FIKA",
    description: "Book intercity buses, pay with mobile money, track trips and send parcels across Rwanda.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#ffffff",
    theme_color: "#000000",
    categories: ["travel", "transportation"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
