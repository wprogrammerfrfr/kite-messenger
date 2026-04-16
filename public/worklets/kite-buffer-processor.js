class KiteBufferProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();

    const sampleRateHint =
      options &&
      options.processorOptions &&
      Number.isFinite(options.processorOptions.sampleRate)
        ? options.processorOptions.sampleRate
        : sampleRate;
    const requestedLeadFrames =
      options &&
      options.processorOptions &&
      Number.isFinite(options.processorOptions.targetLeadFrames)
        ? Math.max(0, Math.floor(options.processorOptions.targetLeadFrames))
        : Math.floor(sampleRateHint * 0.06);

    this.capacity = Math.max(128, Math.floor(sampleRateHint));
    this.buffer = new Float32Array(this.capacity);
    this.writeIndex = 0;
    this.readIndex = 0;
    this.bufferedFrames = 0;
    this.targetLeadFrames = Math.min(requestedLeadFrames, this.capacity);
    this.isPrimed = false;
    this.lastReportedDepth = -1;
    this.lastReportedCorrectionEvent = "none";
    this.driftWindowFrames = Math.max(128, Math.floor(sampleRateHint));
    this.driftWindowAccumulatedDepth = 0;
    this.driftWindowObservedFrames = 0;
    this.averageBufferDepth = this.targetLeadFrames;
    this.pendingCorrectionMode = "none";
    this.upperDriftThresholdRatio = 1.2;
    this.lowerDriftThresholdRatio = 0.8;
    this.targetPlayTimeSec = null;

    this.port.onmessage = (event) => {
      const data = event && event.data ? event.data : null;
      if (!data || typeof data !== "object") return;

      if (data.type === "SET_TARGET_LEAD_FRAMES") {
        const nextLeadFrames = Math.max(0, Math.floor(Number(data.value) || 0));
        this.targetLeadFrames = Math.min(nextLeadFrames, this.capacity);
        if (this.bufferedFrames < this.targetLeadFrames) {
          this.isPrimed = false;
        }
        return;
      }

      if (data.type === "FLUSH_BUFFER") {
        this.flushBuffer();
        return;
      }

      if (data.type === "SET_GRID_TARGET") {
        const nextTargetTimeSec = Number(data.targetTimeSec);
        this.targetPlayTimeSec = Number.isFinite(nextTargetTimeSec)
          ? nextTargetTimeSec
          : null;
      }
    };
  }

  flushBuffer() {
    this.writeIndex = 0;
    this.readIndex = 0;
    this.bufferedFrames = 0;
    this.isPrimed = false;
    this.driftWindowAccumulatedDepth = 0;
    this.driftWindowObservedFrames = 0;
    this.averageBufferDepth = 0;
    this.pendingCorrectionMode = "none";
    this.lastReportedDepth = -1;
    this.lastReportedCorrectionEvent = "none";
    this.targetPlayTimeSec = null;
    this.buffer.fill(0);
  }

  getBufferDepth() {
    return this.bufferedFrames;
  }

  writeSample(sample) {
    this.buffer[this.writeIndex] = sample;
    this.writeIndex = (this.writeIndex + 1) % this.capacity;

    if (this.bufferedFrames < this.capacity) {
      this.bufferedFrames += 1;
      return;
    }

    // Keep newest audio if producer outruns consumer.
    this.readIndex = (this.readIndex + 1) % this.capacity;
  }

  readSample() {
    if (this.bufferedFrames <= 0) {
      return 0;
    }

    const sample = this.buffer[this.readIndex];
    this.readIndex = (this.readIndex + 1) % this.capacity;
    this.bufferedFrames -= 1;
    return sample;
  }

  observeDepth(frameCount) {
    if (frameCount <= 0) return;

    this.driftWindowAccumulatedDepth += this.getBufferDepth() * frameCount;
    this.driftWindowObservedFrames += frameCount;

    if (this.driftWindowObservedFrames < this.driftWindowFrames) {
      return;
    }

    this.averageBufferDepth =
      this.driftWindowAccumulatedDepth / this.driftWindowObservedFrames;

    const upperThreshold = this.targetLeadFrames * this.upperDriftThresholdRatio;
    const lowerThreshold = this.targetLeadFrames * this.lowerDriftThresholdRatio;

    if (this.averageBufferDepth > upperThreshold) {
      this.pendingCorrectionMode = "drop";
    } else if (this.averageBufferDepth < lowerThreshold) {
      this.pendingCorrectionMode = "dupe";
    } else {
      this.pendingCorrectionMode = "none";
    }

    this.driftWindowAccumulatedDepth = 0;
    this.driftWindowObservedFrames = 0;
  }

  maybeReportDepth(driftCorrectionEvent) {
    const depth = this.getBufferDepth();
    if (
      depth === this.lastReportedDepth &&
      driftCorrectionEvent === this.lastReportedCorrectionEvent
    ) {
      return;
    }

    this.lastReportedDepth = depth;
    this.lastReportedCorrectionEvent = driftCorrectionEvent;
    this.port.postMessage({
      type: "BUFFER_DEPTH",
      bufferDepthFrames: depth,
      targetLeadFrames: this.targetLeadFrames,
      isPrimed: this.isPrimed,
      averageBufferDepthFrames: this.averageBufferDepth,
      driftCorrectionEvent,
    });
  }

  process(inputs, outputs) {
    const inputChannels = inputs[0] || [];
    const outputChannels = outputs[0] || [];

    if (outputChannels.length === 0) {
      this.maybeReportDepth("none");
      return true;
    }

    const frameCount = outputChannels[0] ? outputChannels[0].length : 0;

    for (let channelIndex = 0; channelIndex < inputChannels.length; channelIndex += 1) {
      const inputChannel = inputChannels[channelIndex];
      if (!inputChannel) continue;

      for (let frameIndex = 0; frameIndex < inputChannel.length; frameIndex += 1) {
        this.writeSample(inputChannel[frameIndex]);
      }
    }

    if (!this.isPrimed && this.getBufferDepth() >= this.targetLeadFrames) {
      this.isPrimed = true;
    }

    let isGridLocked = false;
    if (this.isPrimed && this.targetPlayTimeSec !== null) {
      if (currentTime >= this.targetPlayTimeSec) {
        this.targetPlayTimeSec = null;
      } else {
        isGridLocked = true;
      }
    }

    this.observeDepth(frameCount);

    let driftCorrectionEvent = "none";
    const shouldDrop =
      this.isPrimed &&
      !isGridLocked &&
      this.pendingCorrectionMode === "drop" &&
      this.getBufferDepth() > 1;
    const shouldDupe =
      this.isPrimed &&
      !isGridLocked &&
      this.pendingCorrectionMode === "dupe" &&
      frameCount > 1;
    const correctionFrameIndex = frameCount > 0 ? Math.floor(frameCount / 2) : -1;
    let duplicatedFrameIndex = -1;
    let duplicatedSample = 0;

    if (shouldDrop) {
      this.readSample();
      driftCorrectionEvent = "drop";
      this.pendingCorrectionMode = "none";
    } else if (shouldDupe) {
      duplicatedFrameIndex = correctionFrameIndex;
      driftCorrectionEvent = "dupe";
      this.pendingCorrectionMode = "none";
    }

    for (let channelIndex = 0; channelIndex < outputChannels.length; channelIndex += 1) {
      const outputChannel = outputChannels[channelIndex];
      if (!outputChannel) continue;

      for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
        if (!this.isPrimed || isGridLocked) {
          outputChannel[frameIndex] = 0;
          continue;
        }

        if (frameIndex === duplicatedFrameIndex) {
          duplicatedSample = this.readSample();
          outputChannel[frameIndex] = duplicatedSample;
          continue;
        }

        if (frameIndex === duplicatedFrameIndex + 1) {
          outputChannel[frameIndex] = duplicatedSample;
          duplicatedFrameIndex = -1;
          continue;
        }

        outputChannel[frameIndex] = this.readSample();
      }
    }

    this.maybeReportDepth(driftCorrectionEvent);
    return true;
  }
}

registerProcessor("kite-buffer-processor", KiteBufferProcessor);
