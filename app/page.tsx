import "@/components/kite-studio/welcome-scoped.css";
import type { Metadata } from "next";
import { Suspense } from "react";
import WelcomePage from "@/components/WelcomePage";

const homeDescription =
  "The world's first browser-based loopstation and real-time musical collaboration platform for live P2P jam sessions.";

export const metadata: Metadata = {
  title: "Welcome",
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
    <Suspense fallback={<WelcomePageFallback />}>
      <WelcomePage />
    </Suspense>
  );
}
