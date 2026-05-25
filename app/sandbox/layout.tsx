import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Sandbox",
  robots: { index: false, follow: false },
};

/**
 * Isolated preview shell — covers app nav so sandboxes render full-screen.
 * Delete app/sandbox/ + sandbox/ to remove all sandbox routes.
 */
export default function SandboxLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <link
        rel="stylesheet"
        href="https://fonts.googleapis.com/css2?family=Sora:wght@400;600;700;800&display=swap"
      />
      <div className="fixed inset-0 z-[100] overflow-auto bg-stone-950">{children}</div>
    </>
  );
}
