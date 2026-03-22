import type { Metadata, Viewport } from "next";
import "./globals.css";
import { cookies } from "next/headers";
import { ThemeProvider } from "@/components/theme-provider";

const siteTitle = "Kite | Secure Messaging";
const siteDescription =
  "End-to-end encrypted messaging for musicians, therapists, and those who value privacy. Built by Sammy.";

export const metadata: Metadata = {
  metadataBase: new URL(
    process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"
  ),
  title: {
    default: siteTitle,
    template: "%s | Kite",
  },
  description: siteDescription,
  icons: {
    icon: "/kite-mobile-icon.png",
    shortcut: "/kite-mobile-icon.png",
    apple: "/kite-mobile-icon.png",
  },
  openGraph: {
    title: siteTitle,
    description: siteDescription,
    siteName: "Kite",
    type: "website",
    locale: "en_US",
    images: ["/kite-mobile-icon.png"],
  },
  twitter: {
    card: "summary_large_image",
    title: siteTitle,
    description: siteDescription,
    images: ["/kite-mobile-icon.png"],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const cookieStore = cookies();
  const lang = (cookieStore.get("nexus-lang")?.value as string | undefined) ?? "en";
  const isRtl = lang === "fa" || lang === "ar";

  return (
    <html
      lang={lang}
      dir={isRtl ? "rtl" : "ltr"}
      className="dark"
      suppressHydrationWarning
    >
      <body className="bg-stone-50 text-stone-900 dark:bg-black dark:text-white">
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
