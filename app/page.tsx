import type { Metadata } from "next";
import WelcomePage from "@/components/WelcomePage";

const homeDescription =
  "Kite — secure messaging with E2EE, EN/FA/AR support, and support mode. Tap Get Started to join.";

export const metadata: Metadata = {
  title: "Welcome",
  description: homeDescription,
  openGraph: {
    title: "Kite | Welcome",
    description: homeDescription,
    url: "/",
    type: "website",
    images: [
      {
        url: "/kite-mobile-icon.png",
        width: 512,
        height: 512,
        alt: "Kite",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Kite | Welcome",
    description: homeDescription,
    images: ["/kite-mobile-icon.png"],
  },
};

export default function Home() {
  return <WelcomePage />;
}
