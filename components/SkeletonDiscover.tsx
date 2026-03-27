"use client";

/** Matches V2 discover / inbox row cards: rounded-2xl, mb-3, orange border hint (light), animate-pulse. */
export function SkeletonDiscover({ rows = 5 }: { rows?: number }) {
  return (
    <div className="space-y-0" aria-hidden>
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          className="mb-3 rounded-2xl border border-orange-500/30 bg-stone-100/80 p-4 dark:border-none dark:bg-white/5"
        >
          <div className="flex items-start justify-between gap-2 px-2 py-1.5">
            <div className="min-w-0 flex-1 space-y-2">
              <div className="h-4 w-40 max-w-[70%] rounded-md bg-stone-300/90 animate-pulse dark:bg-white/15" />
              <div className="h-3 w-28 rounded-md bg-stone-300/70 animate-pulse dark:bg-white/10" />
            </div>
            <div className="h-3 w-10 shrink-0 rounded bg-stone-300/60 animate-pulse dark:bg-white/10" />
          </div>
        </div>
      ))}
    </div>
  );
}
