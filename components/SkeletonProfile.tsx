"use client";

/** Matches settings Profile Hub V2 sections: rounded-2xl, mb-3, orange border (light), animate-pulse. */
export function SkeletonProfile() {
  return (
    <div className="space-y-4" aria-hidden>
      <div className="mb-6 space-y-2">
        <div className="mx-auto h-8 w-48 rounded-lg bg-stone-300/80 animate-pulse dark:bg-white/15" />
        <div className="mx-auto h-3 w-64 max-w-full rounded bg-stone-300/60 animate-pulse dark:bg-white/10" />
      </div>

      <div className="mb-3 rounded-2xl border border-orange-500/30 bg-stone-100/80 p-4 sm:p-6 dark:border-stone-700 dark:bg-white/5">
        <div className="flex flex-col items-center">
          <div className="h-24 w-24 rounded-full bg-stone-300/90 animate-pulse dark:bg-white/15" />
          <div className="mt-4 h-3 w-32 rounded bg-stone-300/70 animate-pulse dark:bg-white/10" />
          <div className="mt-2 h-5 w-48 rounded bg-stone-300/80 animate-pulse dark:bg-white/12" />
          <div className="mt-3 h-12 w-full max-w-md rounded-lg bg-stone-300/60 animate-pulse dark:bg-white/10" />
        </div>
      </div>

      <div className="mb-3 space-y-3">
        <div className="h-3 w-20 rounded bg-stone-300/70 animate-pulse dark:bg-white/10" />
        <div className="h-10 w-full rounded-xl bg-stone-300/70 animate-pulse dark:bg-white/10" />
        <div className="h-3 w-16 rounded bg-stone-300/70 animate-pulse dark:bg-white/10" />
        <div className="h-24 w-full rounded-xl bg-stone-300/60 animate-pulse dark:bg-white/10" />
      </div>

      <div className="mb-3 rounded-2xl border border-orange-500/30 bg-stone-100/80 p-4 sm:p-5 dark:border-stone-700 dark:bg-white/5">
        <div className="mb-4 h-4 w-36 rounded bg-stone-300/80 animate-pulse dark:bg-white/12" />
        <div className="space-y-3">
          <div className="h-12 w-full rounded-xl bg-stone-300/60 animate-pulse dark:bg-white/10" />
          <div className="h-12 w-full rounded-xl bg-stone-300/60 animate-pulse dark:bg-white/10" />
        </div>
      </div>

      <div className="h-11 w-full rounded-xl bg-stone-300/80 animate-pulse dark:bg-white/15" />
    </div>
  );
}
