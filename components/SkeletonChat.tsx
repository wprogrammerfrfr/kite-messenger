"use client";

export function SkeletonChat() {
  return (
    <div className="relative flex h-full flex-col overflow-hidden">
      <div className="shrink-0 border-b border-white/10 px-3 py-3 backdrop-blur-sm">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-full bg-white/10 animate-pulse" />
          <div className="flex-1">
            <div className="h-4 w-32 rounded bg-white/10 animate-pulse" />
            <div className="mt-2 h-3 w-24 rounded bg-white/10 animate-pulse" />
          </div>
          <div className="h-10 w-10 rounded-full bg-white/10 animate-pulse" />
        </div>
      </div>

      <div className="flex min-h-0 flex-1 overflow-hidden">
        {/* Sidebar skeleton */}
        <div className="w-72 hidden lg:block border-r border-white/10 p-3">
          <div className="mb-4 h-4 w-24 rounded bg-white/10 animate-pulse" />
          <div className="space-y-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="rounded-2xl bg-white/5 p-3">
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 rounded-full bg-white/10 animate-pulse" />
                  <div className="flex-1">
                    <div className="h-3 w-28 rounded bg-white/10 animate-pulse" />
                    <div className="mt-2 h-3 w-20 rounded bg-white/10 animate-pulse" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Main skeleton */}
        <div className="flex-1 overflow-hidden p-3 sm:p-4">
          <div className="space-y-3">
            {Array.from({ length: 8 }).map((_, i) => (
              <div
                key={i}
                className={`rounded-2xl bg-white/5 p-4 ${i % 2 === 0 ? "w-[92%]" : "w-[74%] ml-auto"}`}
              >
                <div className="h-3 w-full rounded bg-white/10 animate-pulse" />
                <div className="mt-2 h-3 w-2/3 rounded bg-white/10 animate-pulse" />
                <div className="mt-2 h-3 w-1/2 rounded bg-white/10 animate-pulse" />
              </div>
            ))}
          </div>

          {/* Input skeleton */}
          <div className="mt-4 rounded-2xl border border-white/10 bg-white/5 p-3">
            <div className="h-10 rounded-xl bg-white/10 animate-pulse" />
            <div className="mt-3 flex gap-3">
              <div className="h-9 w-9 rounded-full bg-white/10 animate-pulse" />
              <div className="h-9 w-28 rounded-xl bg-white/10 animate-pulse" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

