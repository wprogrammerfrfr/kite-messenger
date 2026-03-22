import Link from "next/link";

export default function OfflinePage() {
  return (
    <div className="flex min-h-[100dvh] flex-col items-center justify-center gap-4 bg-black px-6 text-center text-white">
      <p className="text-lg font-semibold text-[#FF4500]">Kite</p>
      <h1 className="text-xl font-medium">You&apos;re offline</h1>
      <p className="max-w-sm text-sm text-white/70">
        Open the app again when you have a connection. Cached pages and your last messages may
        still be available from the chat screen.
      </p>
      <Link
        href="/chat"
        className="rounded-xl bg-[#FF4500] px-5 py-2.5 text-sm font-semibold text-black"
      >
        Try chat (cached)
      </Link>
    </div>
  );
}
