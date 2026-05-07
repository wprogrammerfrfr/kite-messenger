/**
 * Silent pump: runs on the audio render thread so the main thread can schedule
 * metronome ticks without relying on setInterval (which throttles in background tabs).
 */
class MetronomePumpProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const po =
      options && options.processorOptions && typeof options.processorOptions === "object"
        ? options.processorOptions
        : {};
    const intervalSec =
      typeof po.pumpIntervalSec === "number" &&
      Number.isFinite(po.pumpIntervalSec) &&
      po.pumpIntervalSec > 0
        ? Math.min(0.25, Math.max(0.005, po.pumpIntervalSec))
        : 0.025;
    this.pumpIntervalFrames = Math.max(1, Math.floor(sampleRate * intervalSec));
    this.running = false;
    this.framesAcc = 0;

    this.port.onmessage = (event) => {
      const data = event && event.data ? event.data : null;
      if (!data || typeof data !== "object") return;
      if (data.type === "START") {
        this.running = true;
        this.framesAcc = 0;
        return;
      }
      if (data.type === "STOP") {
        this.running = false;
        this.framesAcc = 0;
      }
    };
  }

  process(inputs, outputs) {
    const out = outputs[0];
    if (out && out.length > 0) {
      for (let c = 0; c < out.length; c++) {
        out[c].fill(0);
      }
    }
    if (!this.running) {
      return true;
    }
    if (!out || out.length === 0) {
      return true;
    }
    const quantum = out[0].length;
    this.framesAcc += quantum;
    while (this.framesAcc >= this.pumpIntervalFrames) {
      this.framesAcc -= this.pumpIntervalFrames;
      const audioTime =
        typeof globalThis.currentTime === "number" && Number.isFinite(globalThis.currentTime)
          ? globalThis.currentTime
          : globalThis.currentFrame / sampleRate;
      this.port.postMessage({
        type: "METRONOME_PUMP",
        currentTime: audioTime,
        currentFrame: globalThis.currentFrame,
      });
    }
    return true;
  }
}

registerProcessor("metronome-pump-processor", MetronomePumpProcessor);
