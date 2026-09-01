import type { Metadata, Viewport } from "next";
import { Inter, Source_Serif_4 } from "next/font/google";
import "./globals.css";
import { PreviewProvider } from "@/components/PreviewGate";
import { ServiceWorker } from "@/components/ServiceWorker";
import { InstallPrompt } from "@/components/InstallPrompt";
import { BRAND } from "@/lib/brand";

const sans = Inter({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});

const serif = Source_Serif_4({
  subsets: ["latin"],
  variable: "--font-serif",
  display: "swap",
});

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#FAF9F6" },
    { media: "(prefers-color-scheme: dark)", color: "#0B1622" },
  ],
  width: "device-width",
  initialScale: 1,
  // Not locked: pinch-zoom is an accessibility affordance, and a signer squinting
  // at a release clause is exactly who needs it.
  viewportFit: "cover",
};

export const metadata: Metadata = {
  metadataBase: new URL(`https://${BRAND.domain}`),
  title: {
    default: `${BRAND.name} — ${BRAND.tagline}`,
    template: `%s — ${BRAND.name}`,
  },
  description:
    "Lend your gear on a signed agreement instead of a handshake. Both parties sign, everyone keeps a record that holds up, and cover for the loan is part of what they sign.",
  openGraph: {
    title: `${BRAND.name} — ${BRAND.tagline}`,
    description:
      "A signed agreement and cover for the loan period, in one signature.",
    url: `https://${BRAND.domain}`,
    siteName: BRAND.name,
    type: "website",
  },
  appleWebApp: {
    capable: true,
    title: BRAND.name,
    statusBarStyle: "default",
  },
  icons: {
    icon: [{ url: "/favicon-32.png", sizes: "32x32", type: "image/png" }],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180" }],
  },
  // Unlisted while this is a preview. `noindex` is the directive that actually
  // removes a page from results — robots.txt only asks a crawler not to fetch,
  // and a URL that is linked from anywhere can still be indexed without ever
  // being crawled. app/robots.ts says the same thing to well-behaved bots.
  //
  // This makes the site undiscoverable, not private: anyone holding the URL can
  // open it. That is the intended trade for now. Flip both back when launching.
  robots: {
    index: false,
    follow: false,
    nocache: true,
    googleBot: { index: false, follow: false, noimageindex: true },
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${sans.variable} ${serif.variable}`}>
      <body className="flex min-h-screen flex-col font-sans">
        {/*
          No header, no footer, no <main>. Which chrome wraps a page is decided
          one level down, by the route group it sits in: app/(marketing) puts the
          public masthead and the four-column footer around it, app/(app) puts the
          signed-in shell around it. Everything that has to be true of every page
          regardless — fonts, the preview gate, the service worker — stays here.
        */}
        <PreviewProvider>
          {children}
          <InstallPrompt />
          <ServiceWorker />
        </PreviewProvider>
      </body>
    </html>
  );
}
