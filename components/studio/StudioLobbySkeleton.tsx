export function StudioLobbySkeleton() {
  return (
    <div className="relative min-h-screen overflow-hidden bg-zinc-950 font-sans text-zinc-100">
      <div className="pointer-events-none absolute inset-0" aria-hidden="true">
        <div className="absolute -left-32 -top-32 h-96 w-96 rounded-full bg-orange-500/10 blur-3xl" />
        <div className="absolute -bottom-40 -right-20 h-96 w-96 rounded-full bg-emerald-500/10 blur-3xl" />
      </div>

      <div className="relative z-10 mx-auto max-w-5xl animate-pulse px-4 py-6 sm:px-8 sm:py-10">
        <div className="rounded-2xl border border-zinc-700/50 bg-zinc-900/60 px-6 py-8 sm:px-12 sm:py-12">
          <div className="flex items-center justify-between">
            <div className="h-3 w-28 rounded bg-zinc-800" />
            <div className="h-10 w-10 rounded-full bg-zinc-800" />
          </div>
          <div className="mx-auto mt-6 h-10 w-64 rounded-lg bg-zinc-800 sm:h-14 sm:w-80" />
          <div className="mx-auto mt-6 h-3 w-32 rounded bg-zinc-800" />
        </div>

        <div className="mt-6 grid gap-6 sm:grid-cols-2">
          <div className="rounded-2xl border border-zinc-700/50 bg-zinc-900/80 p-6">
            <div className="h-3 w-24 rounded bg-zinc-800" />
            <div className="mt-6 h-12 w-full rounded-lg bg-zinc-800" />
            <div className="mt-6 h-10 w-full rounded-lg bg-zinc-800/80" />
          </div>
          <div className="rounded-2xl border border-zinc-700/50 bg-zinc-900/80 p-6">
            <div className="h-3 w-24 rounded bg-zinc-800" />
            <div className="mt-6 flex justify-center gap-2">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="h-12 w-9 rounded-md bg-zinc-800 sm:h-14 sm:w-11" />
              ))}
            </div>
            <div className="mt-6 h-10 w-full rounded-lg bg-zinc-800/80" />
          </div>
        </div>

        <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div
              key={i}
              className="rounded-lg border border-zinc-700/50 bg-zinc-900/60 px-4 py-3"
            >
              <div className="mx-auto h-2 w-16 rounded bg-zinc-800" />
              <div className="mx-auto mt-2 h-5 w-10 rounded bg-zinc-800" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
