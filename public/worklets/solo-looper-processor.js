class SoloLooperProcessor extends AudioWorkletProcessor {
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
    this.loopId = null;
    this.mode = "idle";
    this.recordCursor = 0;
    this.playbackCursor = 0;
    this.recordingBuffer = null;
    this.playbackBuffer = null;

    this.port.onmessage = (event) => {
      const data = event && event.data ? event.data : null;
      if (!data || typeof data !== "object") return;

      if (data.type === "CONFIGURE_LOOP") {
        this.configureLoop(data);
        return;
      }

      if (data.type === "START_RECORDING") {
        this.startRecording();
        return;
      }

      if (data.type === "STOP_LOOP") {
        this.stopLoop();
        return;
      }

      if (data.type === "RESET_LOOP") {
        this.reset();
      }
    };
  }

  reset() {
    this.intervalFrames = 0;
    this.channelCount = 2;
    this.loopId = null;
    this.mode = "idle";
    this.recordCursor = 0;
    this.playbackCursor = 0;
    this.recordingBuffer = null;
    this.playbackBuffer = null;
    this.reportState("RESET");
  }

  configureLoop(data) {
    const nextIntervalFrames = Math.floor(Number(data.intervalFrames));
    if (!Number.isFinite(nextIntervalFrames) || nextIntervalFrames <= 0) {
      this.reset();
      return;
    }

    this.intervalFrames = nextIntervalFrames;
    this.channelCount = Math.max(1, Math.min(2, Math.floor(Number(data.channelCount) || 2)));
    this.loopId =
      typeof data.loopId === "string" || typeof data.loopId === "number" ? String(data.loopId) : null;
    this.mode = "idle";
    this.recordCursor = 0;
    this.playbackCursor = 0;
    this.recordingBuffer = new Float32Array(this.intervalFrames * this.channelCount);
    this.playbackBuffer = null;
    this.reportState("CONFIGURED");
  }

  startRecording() {
    if (this.intervalFrames <= 0) return;

    this.mode = "recording";
    this.recordCursor = 0;
    this.playbackCursor = 0;
    this.recordingBuffer = new Float32Array(this.intervalFrames * this.channelCount);
    this.playbackBuffer = null;
    this.reportState("RECORDING");
  }

  stopLoop() {
    this.mode = "idle";
    this.reportState("STOPPED");
  }

  reportState(state) {
    this.port.postMessage({
      type: "LOOP_STATE",
      state,
      loopId: this.loopId,
      intervalFrames: this.intervalFrames,
      channelCount: this.channelCount,
      sampleRate: this.sampleRateHint,
    });
  }

  writeRecordingSample(inputChannels, frameIndex, loopFrameIndex, channelIndex) {
    if (!this.recordingBuffer) return;

    const inputChannel = inputChannels[channelIndex] || inputChannels[0];
    const sampleValue = inputChannel && frameIndex < inputChannel.length ? inputChannel[frameIndex] || 0 : 0;
    this.recordingBuffer[loopFrameIndex * this.channelCount + channelIndex] = sampleValue;
  }

  readPlaybackSample(channelIndex) {
    if (!this.playbackBuffer || this.intervalFrames <= 0) return 0;

    const sourceChannelIndex = this.channelCount === 1 ? 0 : Math.min(channelIndex, this.channelCount - 1);
    return this.playbackBuffer[this.playbackCursor * this.channelCount + sourceChannelIndex] || 0;
  }

  finishRecording() {
    if (!this.recordingBuffer || this.intervalFrames <= 0) return;

    this.playbackBuffer = this.recordingBuffer;
    this.recordingBuffer = null;
    this.mode = "playing";
    this.playbackCursor = 0;

    const capturedBuffer = this.playbackBuffer.slice();
    const transferred = capturedBuffer.buffer;
    this.port.postMessage(
      {
        type: "LOOP_READY",
        loopId: this.loopId,
        sampleRate: this.sampleRateHint,
        intervalFrames: this.intervalFrames,
        channelCount: this.channelCount,
        buffer: transferred,
      },
      [transferred]
    );
    this.reportState("PLAYING");
  }

  fillSilence(outputChannels, frameIndex) {
    for (let channelIndex = 0; channelIndex < outputChannels.length; channelIndex += 1) {
      const outputChannel = outputChannels[channelIndex];
      if (outputChannel) outputChannel[frameIndex] = 0;
    }
  }

  writePlayback(outputChannels, frameIndex) {
    for (let channelIndex = 0; channelIndex < outputChannels.length; channelIndex += 1) {
      const outputChannel = outputChannels[channelIndex];
      if (!outputChannel) continue;
      outputChannel[frameIndex] = this.readPlaybackSample(channelIndex);
    }

    this.playbackCursor += 1;
    if (this.playbackCursor >= this.intervalFrames) {
      this.playbackCursor = 0;
    }
  }

  process(inputs, outputs) {
    const inputChannels = inputs[0] || [];
    const outputChannels = outputs[0] || [];

    if (outputChannels.length === 0) {
      return true;
    }

    const frameCount = outputChannels[0] ? outputChannels[0].length : 0;
    if (this.intervalFrames <= 0) {
      for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
        this.fillSilence(outputChannels, frameIndex);
      }
      return true;
    }

    for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
      if (this.mode === "recording") {
        const loopFrameIndex = this.recordCursor;
        for (let channelIndex = 0; channelIndex < this.channelCount; channelIndex += 1) {
          this.writeRecordingSample(inputChannels, frameIndex, loopFrameIndex, channelIndex);
        }
        for (let channelIndex = 0; channelIndex < outputChannels.length; channelIndex += 1) {
          const outputChannel = outputChannels[channelIndex];
          if (!outputChannel) continue;
          outputChannel[frameIndex] = 0;
        }

        this.recordCursor += 1;
        if (this.recordCursor >= this.intervalFrames) {
          this.finishRecording();
        }
        continue;
      }

      if (this.mode === "playing") {
        this.writePlayback(outputChannels, frameIndex);
        continue;
      }

      this.fillSilence(outputChannels, frameIndex);
    }

    return true;
  }
}

registerProcessor("solo-looper-processor", SoloLooperProcessor);
