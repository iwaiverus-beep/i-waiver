import type { Metadata } from "next";
import { Inter, Source_Serif_4 } from "next/font/google";
import "./globals.css";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { PreviewProvider } from "@/components/PreviewGate";
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
        <PreviewProvider>
          <Header />
          <main className="flex-1">{children}</main>
          <Footer />
        </PreviewProvider>
      </body>
    </html>
  );
}
