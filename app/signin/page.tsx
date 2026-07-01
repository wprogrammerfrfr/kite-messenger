import "@/components/kite-studio/auth-scoped.css";
import type { Metadata } from "next";
import { Suspense } from "react";
import SignInPage from "@/components/SignInPage";

export const metadata: Metadata = {
  title: "Sign in",
  description: "Sign in or create a Kite Studio account to host and join P2P jam sessions.",
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
