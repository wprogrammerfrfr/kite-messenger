import type { Metadata, Viewport } from "next";
import "./globals.css";
import { cookies } from "next/headers";
import { ThemeProvider } from "@/components/theme-provider";
import { ResilienceProvider } from "@/components/resilience-provider";
import { InstallPromptProvider } from "@/components/install-prompt-provider";
import GlobalNavShell from "@/components/GlobalNavShell";

const siteTitle = "Kite Studio";
const siteDescription =
  "The world's first web-based P2P jamming session and 4-track loopstation.";

function resolveMetadataBase(): URL {
  const fromEnv =
    process.env.NEXT_PUBLIC_SITE_URL?.trim() ||
    process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (fromEnv) {
    return new URL(fromEnv.replace(/\/$/, ""));
  }
  if (process.env.NODE_ENV === "production") {
    return new URL("https://kitestudiopro.vercel.app");
  }
  return new URL("http://localhost:3000");
}

export const metadata: Metadata = {
  metadataBase: resolveMetadataBase(),
  title: {
    default: siteTitle,
    template: "%s | Kite Studio",
  },
  description: siteDescription,
  applicationName: siteTitle,
  authors: [{ name: siteTitle }],
  creator: siteTitle,
  publisher: siteTitle,
  keywords: [
    "online jamming",
    "browser musical studio",
    "browser-based loopstation",
    "4-track loopstation",
    "web-based P2P jam",
    "looper",
    "real-time musical collaboration",
    "P2P jam room",
    "WebRTC music studio",
  ],
  icons: {
    icon: [
      { url: "/icons/icon-192x192.png", sizes: "192x192", type: "image/png" },
      { url: "/kite-mobile-icon.svg", type: "image/svg+xml" },
    ],
    shortcut: "/icons/icon-192x192.png",
    apple: "/icons/icon-192x192.png",
  },
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: siteTitle,
  },
  alternates: {
    canonical: "/",
  },
  openGraph: {
    title: siteTitle,
    description: siteDescription,
    siteName: "Kite Studio",
    type: "website",
    locale: "en_US",
    images: ["/kite-mobile-icon.svg"],
  },
  twitter: {
    card: "summary_large_image",
    title: siteTitle,
    description: siteDescription,
    images: ["/kite-mobile-icon.svg"],
  },
  verification: {
    google: "7RlP5LNx-aByYJiLZaYOIDdfKaSKfXsz-chWX62AUyY",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#000000",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const cookieStore = cookies();
  const lang = (cookieStore.get("nexus-lang")?.value as string | undefined) ?? "en";
  const isRtl = lang === "fa" || lang === "ar";
  const htmlLang = lang === "kr" ? "ko" : lang === "tr" ? "tr" : lang;

  return (
    <html
      lang={htmlLang}
      dir={isRtl ? "rtl" : "ltr"}
      className="dark"
      suppressHydrationWarning
    >
      <body className="bg-stone-50 text-stone-900 dark:bg-black dark:text-white">
        <ThemeProvider>
          <InstallPromptProvider>
            <ResilienceProvider>
              <GlobalNavShell>{children}</GlobalNavShell>
            </ResilienceProvider>
          </InstallPromptProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
