/** Fixed-interval wake-up only; grid timing is owned by the main thread (AudioContext). */
const PULSE_INTERVAL_MS = 10;

let config = null;
let pulseTimerId = null;

function postStatus(state) {
  self.postMessage({
    type: "KITE_SCHEDULER_STATUS",
    state,
    sequenceNumber: config ? config.sequenceNumber : 0,
    postedAtPerformanceMs: performance.now(),
  });
}

function postError(message) {
  self.postMessage({
    type: "KITE_SCHEDULER_ERROR",
    message,
    postedAtPerformanceMs: performance.now(),
  });
}

function clearPulseTimer() {
  if (pulseTimerId !== null) {
    clearInterval(pulseTimerId);
    pulseTimerId = null;
  }
}

function postPulse() {
  if (!config) return;
  self.postMessage({
    type: "KITE_SCHEDULER_PULSE",
    sequenceNumber: config.sequenceNumber,
    postedAtPerformanceMs: performance.now(),
  });
}

function startPulsing() {
  clearPulseTimer();
  if (!config) return;
  pulseTimerId = setInterval(postPulse, PULSE_INTERVAL_MS);
  postPulse();
}

self.onmessage = (event) => {
  const data = event && event.data ? event.data : null;
  if (!data || typeof data !== "object") return;

  if (data.type === "STOP") {
    clearPulseTimer();
    config = null;
    self.postMessage({
      type: "KITE_SCHEDULER_STATUS",
      state: "stopped",
      sequenceNumber: 0,
      postedAtPerformanceMs: performance.now(),
    });
    return;
  }

  if (data.type === "START") {
    const startAtPerformanceMs =
      typeof data.startAtPerformanceMs === "number" ? data.startAtPerformanceMs : performance.now();
    config = {
      loopDurationSeconds: data.loopDurationSeconds,
      localIntervalFrames: data.localIntervalFrames,
      localSampleRate: data.localSampleRate,
      sequenceNumber: data.sequenceNumber,
      startAtPerformanceMs,
      tickLookaheadMs: data.tickLookaheadMs,
    };
    postStatus("started");
    startPulsing();
    return;
  }

  if (data.type === "UPDATE") {
    if (!config) {
      postError("Cannot update Kite scheduler worker before START.");
      return;
    }
    config = { ...config, ...data.patch };
    postStatus("updated");
    return;
  }
};
