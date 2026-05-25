"use client";

export type FourBeatMetronomeProps = {
  activeBeat: 0 | 1 | 2 | 3 | null;
};

export function FourBeatMetronome({ activeBeat }: FourBeatMetronomeProps) {
  return (
    <div className="flex flex-row gap-2 items-center justify-center">
      {[0, 1, 2, 3].map((beatIndex) => {
        const isActive = activeBeat === beatIndex;
        const activeClass =
          beatIndex === 0
            ? "bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.8)]"
            : "bg-stone-300";

        return (
          <div
            key={beatIndex}
            className={`h-4 w-4 rounded-full transition-colors duration-100 ${
              isActive ? activeClass : "bg-stone-800 border border-stone-600"
            }`}
          />
        );
      })}
    </div>
  );
}
