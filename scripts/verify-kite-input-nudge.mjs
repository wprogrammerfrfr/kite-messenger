/**
 * Sanity checks for record write-index math (run: node scripts/verify-kite-input-nudge.mjs).
 * Manual P2P seam listening still recommended when D/N is large.
 */

function calcRecordWriteFrameIndex(frameCursor, inputNudgeFrames, intervalFrames) {
  const N = Math.max(1, Math.floor(intervalFrames));
  const c = Math.floor(frameCursor) % N;
  const D = Math.max(0, Math.min(Math.floor(inputNudgeFrames), N - 1));
  if (D === 0) return c;
  return (c - D + N) % N;
}

function assertBijection(N, D) {
  const seen = new Set();
  for (let c = 0; c < N; c += 1) {
    const w = calcRecordWriteFrameIndex(c, D, N);
    if (seen.has(w)) {
      throw new Error(`collision at c=${c}, write=${w}, N=${N}, D=${D}`);
    }
    seen.add(w);
  }
  if (seen.size !== N) {
    throw new Error(`incomplete coverage N=${N} D=${D} size=${seen.size}`);
  }
}

const cases = [
  { N: 384000, D: 3120 },
  { N: 48000, D: 3120 },
  { N: 4096, D: 3120 },
  { N: 100, D: 50 },
];

for (const { N, D } of cases) {
  assertBijection(N, D);
  console.log(`ok bijection N=${N} D=${D}`);
}

const D = 3120;
const N = 384000;
const tailStart = calcRecordWriteFrameIndex(0, D, N);
if (tailStart !== N - D) {
  throw new Error(`expected first write at N-D=${N - D}, got ${tailStart}`);
}
console.log(`ok boundary tail index at c=0 is ${tailStart} (N-D)`);
console.log("verify-kite-input-nudge: all checks passed");
