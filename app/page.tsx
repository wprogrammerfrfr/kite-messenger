import "@/components/kite-studio/landing-scoped.css";
import type { Metadata } from "next";
import { Suspense } from "react";
import WelcomePage from "@/components/WelcomePage";

const homeDescription =
  "The world's first web-based P2P jamming session and 4-track loopstation.";

const siteUrl = "https://kitestudiopro.vercel.app/";

const websiteJsonLd = {
  "@context": "https://schema.org",
  "@type": "WebSite",
  name: "Kite Studio",
  alternateName: ["Kite", "kitestudiopro.vercel.app"],
  url: siteUrl,
  description: homeDescription,
};

export const metadata: Metadata = {
  description: homeDescription,
  openGraph: {
    title: "Kite Studio",
    description: homeDescription,
    url: "/",
    type: "website",
    images: [
      {
        url: "/kite-mobile-icon.svg",
        width: 512,
        height: 512,
        alt: "Kite Studio",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Kite Studio",
    description: homeDescription,
    images: ["/kite-mobile-icon.svg"],
  },
};

function WelcomePageFallback() {
  return (
    <div
      className="min-h-screen bg-black"
      aria-busy="true"
      aria-label="Loading"
    />
  );
}

export default function Home() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(websiteJsonLd) }}
      />
      <Suspense fallback={<WelcomePageFallback />}>
        <WelcomePage />
      </Suspense>
    </>
  );
}
