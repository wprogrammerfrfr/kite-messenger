let config = null;
let timerId = null;
let intervalIndex = 0;

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

function clearTimer() {
  if (timerId !== null) {
    clearTimeout(timerId);
    timerId = null;
  }
}

function scheduleNextTick() {
  clearTimer();
  if (!config) return;

  const intervalMs = config.loopDurationSeconds * 1000;
  const now = performance.now();
  while (
    config.workerStartAtPerformanceMs + intervalIndex * intervalMs <
    now - config.tickLookaheadMs
  ) {
    intervalIndex += 1;
  }

  const scheduledAtPerformanceMs = config.startAtPerformanceMs + intervalIndex * intervalMs;
  const workerScheduledAtPerformanceMs =
    config.workerStartAtPerformanceMs + intervalIndex * intervalMs;
  const delayMs = Math.max(
    0,
    workerScheduledAtPerformanceMs - performance.now() - config.tickLookaheadMs
  );
  timerId = setTimeout(() => {
    if (!config) return;
    self.postMessage({
      type: "KITE_INTERVAL_TICK",
      sequenceNumber: config.sequenceNumber,
      intervalIndex,
      scheduledAtPerformanceMs,
      postedAtPerformanceMs: performance.now(),
      loopDurationSeconds: config.loopDurationSeconds,
      localIntervalFrames: config.localIntervalFrames,
      localSampleRate: config.localSampleRate,
    });
    intervalIndex += 1;
    scheduleNextTick();
  }, delayMs);
}

self.onmessage = (event) => {
  const data = event && event.data ? event.data : null;
  if (!data || typeof data !== "object") return;

  if (data.type === "STOP") {
    clearTimer();
    config = null;
    intervalIndex = 0;
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
    const commandPostedAtPerformanceMs =
      typeof data.commandPostedAtPerformanceMs === "number"
        ? data.commandPostedAtPerformanceMs
        : startAtPerformanceMs;
    const workerStartAtPerformanceMs =
      performance.now() + (startAtPerformanceMs - commandPostedAtPerformanceMs);
    config = {
      loopDurationSeconds: data.loopDurationSeconds,
      localIntervalFrames: data.localIntervalFrames,
      localSampleRate: data.localSampleRate,
      sequenceNumber: data.sequenceNumber,
      startAtPerformanceMs,
      workerStartAtPerformanceMs,
      tickLookaheadMs: data.tickLookaheadMs,
    };
    intervalIndex = 0;
    postStatus("started");
    scheduleNextTick();
    return;
  }

  if (data.type === "UPDATE") {
    if (!config) {
      postError("Cannot update Kite scheduler worker before START.");
      return;
    }
    const patch = { ...data.patch };
    if (typeof patch.startAtPerformanceMs === "number") {
      const commandPostedAtPerformanceMs =
        typeof data.commandPostedAtPerformanceMs === "number"
          ? data.commandPostedAtPerformanceMs
          : patch.startAtPerformanceMs;
      patch.workerStartAtPerformanceMs =
        performance.now() + (patch.startAtPerformanceMs - commandPostedAtPerformanceMs);
    }
    config = { ...config, ...patch };
    postStatus("updated");
    scheduleNextTick();
  }
};
