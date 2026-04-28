class KiteIntervalProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();

    const processorOptions =
      options && options.processorOptions && typeof options.processorOptions === "object"
        ? options.processorOptions
        : {};

    this.sampleRateHint = Number.isFinite(processorOptions.sampleRate)
      ? Math.max(1, Math.floor(processorOptions.sampleRate))
      : sampleRate;
    this.intervalFrames = 0;
    this.channelCount = 2;
    this.intervalId = null;
    this.sequenceNumber = 0;
    this.frameCursor = 0;
    this.hasPlayableInterval = false;
    this.recordingBuffer = null;
    this.playbackBuffer = null;
    this.playbackChannelCount = 0;
    this.pendingPlaybackBuffer = null;
    this.pendingPlaybackChannelCount = 0;
    this.lastReportedState = "";

    this.port.onmessage = (event) => {
      const data = event && event.data ? event.data : null;
      if (!data || typeof data !== "object") return;

      if (data.type === "SET_INTERVAL") {
        this.setIntervalConfig(data);
        return;
      }

      if (data.type === "LOAD_INTERVAL") {
        this.loadInterval(data);
        return;
      }

      if (data.type === "RESET_INTERVAL") {
        this.reset();
      }
    };
  }

  reset() {
    this.intervalFrames = 0;
    this.channelCount = 2;
    this.intervalId = null;
    this.sequenceNumber = 0;
    this.frameCursor = 0;
    this.hasPlayableInterval = false;
    this.recordingBuffer = null;
    this.playbackBuffer = null;
    this.playbackChannelCount = 0;
    this.pendingPlaybackBuffer = null;
    this.pendingPlaybackChannelCount = 0;
    this.lastReportedState = "";
  }

  setIntervalConfig(data) {
    const nextIntervalFrames = Math.floor(Number(data.intervalFrames));
    if (!Number.isFinite(nextIntervalFrames) || nextIntervalFrames <= 0) {
      this.reset();
      this.reportState("RESET");
      return;
    }

    const nextChannelCount = Math.max(1, Math.min(2, Math.floor(Number(data.channelCount) || 2)));
    this.intervalFrames = nextIntervalFrames;
    this.channelCount = nextChannelCount;
    this.intervalId =
      typeof data.intervalId === "string" || typeof data.intervalId === "number"
        ? String(data.intervalId)
        : null;
    this.sequenceNumber = Math.max(0, Math.floor(Number(data.sequenceNumber) || 0));
    this.frameCursor = 0;
    this.hasPlayableInterval = false;
    this.recordingBuffer = new Float32Array(this.intervalFrames * this.channelCount);
    this.playbackBuffer = new Float32Array(this.intervalFrames * this.channelCount);
    this.playbackChannelCount = this.channelCount;
    this.pendingPlaybackBuffer = null;
    this.pendingPlaybackChannelCount = 0;
    this.reportState("CONFIGURED");
  }

  loadInterval(data) {
    if (this.intervalFrames <= 0) return;

    const source = data.buffer || data.payload;
    const nextChannelCount = Math.max(
      1,
      Math.min(2, Math.floor(Number(data.channelCount) || this.channelCount))
    );
    const nextIntervalFrames = Math.floor(Number(data.intervalFrames) || this.intervalFrames);
    if (nextIntervalFrames !== this.intervalFrames) return;

    let nextBuffer = null;
    if (source instanceof Float32Array) {
      nextBuffer = source;
    } else if (source instanceof ArrayBuffer) {
      nextBuffer = new Float32Array(source);
    }

    if (!nextBuffer || nextBuffer.length < this.intervalFrames * nextChannelCount) {
      return;
    }

    this.pendingPlaybackBuffer = nextBuffer;
    this.pendingPlaybackChannelCount = nextChannelCount;
    this.reportState("INTERVAL_LOADED");
  }

  reportState(state) {
    const key = `${state}:${this.intervalId}:${this.intervalFrames}:${this.channelCount}`;
    if (key === this.lastReportedState) return;
    this.lastReportedState = key;
    this.port.postMessage({
      type: "INTERVAL_STATE",
      state,
      intervalId: this.intervalId,
      intervalFrames: this.intervalFrames,
      channelCount: this.channelCount,
      sampleRate: this.sampleRateHint,
    });
  }

  readPlaybackSample(frameIndex, channelIndex) {
    if (!this.hasPlayableInterval || !this.playbackBuffer) return 0;
    const sourceChannelCount = Math.max(1, this.playbackChannelCount || this.channelCount);
    const sourceChannelIndex = sourceChannelCount === 1 ? 0 : Math.min(channelIndex, sourceChannelCount - 1);
    return this.playbackBuffer[frameIndex * sourceChannelCount + sourceChannelIndex] || 0;
  }

  writeRecordingSample(inputChannels, frameIndex, intervalFrameIndex, channelIndex) {
    if (!this.recordingBuffer) return;

    const inputChannel = inputChannels[channelIndex] || inputChannels[0];
    const sampleValue = inputChannel && frameIndex < inputChannel.length ? inputChannel[frameIndex] || 0 : 0;
    this.recordingBuffer[intervalFrameIndex * this.channelCount + channelIndex] = sampleValue;
  }

  finishInterval() {
    if (!this.recordingBuffer || this.intervalFrames <= 0) return;

    const completedBuffer = this.recordingBuffer;
    this.recordingBuffer = new Float32Array(this.intervalFrames * this.channelCount);

    if (this.pendingPlaybackBuffer) {
      this.playbackBuffer = this.pendingPlaybackBuffer;
      this.playbackChannelCount = Math.max(1, this.pendingPlaybackChannelCount || this.channelCount);
      this.pendingPlaybackBuffer = null;
      this.pendingPlaybackChannelCount = 0;
      this.hasPlayableInterval = true;
    }

    const transferred = completedBuffer.buffer;
    this.port.postMessage(
      {
        type: "INTERVAL_READY",
        intervalId: this.intervalId,
        sequenceNumber: this.sequenceNumber,
        sampleRate: this.sampleRateHint,
        intervalFrames: this.intervalFrames,
        channelCount: this.channelCount,
        buffer: transferred,
      },
      [transferred]
    );
    this.sequenceNumber = (this.sequenceNumber + 1) >>> 0;
  }

  process(inputs, outputs) {
    const inputChannels = inputs[0] || [];
    const outputChannels = outputs[0] || [];

    if (outputChannels.length === 0) {
      return true;
    }

    const frameCount = outputChannels[0] ? outputChannels[0].length : 0;
    if (this.intervalFrames <= 0 || !this.recordingBuffer) {
      for (let channelIndex = 0; channelIndex < outputChannels.length; channelIndex += 1) {
        const outputChannel = outputChannels[channelIndex];
        if (outputChannel) outputChannel.fill(0);
      }
      return true;
    }

    for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
      const intervalFrameIndex = this.frameCursor;

      for (let channelIndex = 0; channelIndex < this.channelCount; channelIndex += 1) {
        this.writeRecordingSample(inputChannels, frameIndex, intervalFrameIndex, channelIndex);
      }

      for (let channelIndex = 0; channelIndex < outputChannels.length; channelIndex += 1) {
        const outputChannel = outputChannels[channelIndex];
        if (!outputChannel) continue;
        outputChannel[frameIndex] = this.readPlaybackSample(intervalFrameIndex, channelIndex);
      }

      this.frameCursor += 1;
      if (this.frameCursor >= this.intervalFrames) {
        this.frameCursor = 0;
        this.finishInterval();
      }
    }

    return true;
  }
}

registerProcessor("kite-interval-processor", KiteIntervalProcessor);
