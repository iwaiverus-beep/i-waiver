import type { MetadataRoute } from "next";
import { BRAND } from "@/lib/brand";

/**
 * What the phone reads when someone adds this to their home screen.
 *
 * `start_url` is /assets rather than /: someone who installed this is a lender,
 * and a lender opening the app wants the things they lend — the screen every
 * loan starts from — not the marketing page that persuaded them to install it.
 * Signed-out visitors get bounced to /login by the middleware, which is the
 * right landing anyway.
 *
 * The same destination signing in uses. An installed app that opens somewhere
 * other than where signing in lands is two front doors into one product.
 *
 * Maskable icons are separate entries rather than a `purpose: "any maskable"` on
 * one. Android crops maskable icons to the launcher's shape, and a mark drawn
 * edge to edge loses its corners — so the maskable pair carries its own padding
 * and the plain pair does not.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: `${BRAND.name} — ${BRAND.tagline}`,
    short_name: BRAND.name,
    description:
      "Lend your gear on a signed agreement instead of a handshake, with cover for the loan period built into the same signature.",
    start_url: "/assets",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#FAF9F6",
    theme_color: "#0B1622",
    categories: ["business", "productivity", "finance"],
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      {
        src: "/icon-192-maskable.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "maskable",
      },
      {
        src: "/icon-512-maskable.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
    // Long-pressing the installed icon offers these.
    shortcuts: [
      {
        name: "Lend something",
        short_name: "Lend",
        url: "/agreements/new",
        icons: [{ src: "/icon-192.png", sizes: "192x192" }],
      },
      {
        name: "Things you lend",
        short_name: "Items",
        url: "/assets",
        icons: [{ src: "/icon-192.png", sizes: "192x192" }],
      },
    ],
  };
}
