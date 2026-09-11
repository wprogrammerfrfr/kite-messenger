import "@/components/kite-studio/auth-scoped.css";
import type { Metadata } from "next";
import { Suspense } from "react";
import SignInPage from "@/components/SignInPage";

export const metadata: Metadata = {
  title: "Sign in",
  description:
    "The world's first web-based P2P jamming session and 4-track loopstation.",
};

function SignInPageFallback() {
  return (
    <div className="min-h-screen bg-black" aria-busy="true" aria-label="Loading" />
  );
}

export default function SignInRoute() {
  return (
    <Suspense fallback={<SignInPageFallback />}>
      <SignInPage />
    </Suspense>
  );
}
