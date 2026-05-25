const MAX_TRACK_INDEX = 4;
const MIN_TRACK_INDEX = 1;
/** Hard RAM budget: ≤ 60 s of samples per track (protocol / allocation guard for P5-xx). */
const MAX_RECORDING_SECONDS = 60;

const LOOP_CROSSFADE_SAMPLES = Math.max(2, Math.floor(sampleRate * 0.005));
const DEFAULT_BPM = 120;
const CALIBRATION_THRESHOLD = 0.05;
const CALIBRATION_TIMEOUT_FRAMES = 24000;
const CALIBRATION_CLICK_AMPLITUDE = 0.95;
const CALIBRATION_BURST_FRAMES = 10;

/**
 * Must stay identical to `lib/looper-math.ts` `snapToMasterMultiple`.
 */
function snapToMasterMultiple(targetFrames, masterFrames) {
  if (!Number.isFinite(targetFrames) || !Number.isFinite(masterFrames) || targetFrames < 0) {
    return targetFrames;
  }
  if (masterFrames <= 0) {
    return targetFrames;
  }
  const ratio = targetFrames / masterFrames;
  if (!Number.isFinite(ratio)) {
    return targetFrames;
  }
  const n = Math.round(ratio);
  const clampedN = Math.max(1, n);
  return clampedN * masterFrames;
}

function createEmptySlot() {
  return {
    intervalFrames: 0,
    channelCount: 2,
    loopId: null,
    configured: false,
    mode: "idle",
    recordCursor: 0,
    playbackCursor: 0,
    recordWriteOffsetInBlock: 0,
    /** Sample index at record start (after pre-roll); organic length = recordCursor - epoch. */
    recordingEpochFrames: 0,
    /** True after provision cap handler runs (prevents reject/finalize spam in process). */
    atProvisionCap: false,
    recordingBuffer: null,
    playbackBuffer: null,
    loopMode: "free",
    targetLengthFrames: null,
    latencyOffsetFrames: 0,
    /** Per-track playback/recording gain in summing bus (0–4). */
    gain: 1,
    /** Post-roll target: the exact frame count to record up to before deferred finalization. */
    stopTargetFrames: null,
    /** Options captured at stop time for the deferred finalizeRecordingSlot call. */
    stopOptions: null,
  };
}

class SoloLooperProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();

    this.maxRecordingFrames = Math.floor(sampleRate * MAX_RECORDING_SECONDS);
    if (!Number.isFinite(this.maxRecordingFrames) || this.maxRecordingFrames < 1) {
      this.maxRecordingFrames = 1;
    }

    /** 1–4: logical target for transport and CONFIGURE_LOOP when omitted. */
    this.activeTrackIndex = 1;

    /** @type {{ trackIndex: number, provisionFrames: number, channelCount: number, loopId: string|null } | null} */
    this.overdubArm = null;

    /** Indices 0..3 ↔ tracks 1..4 — full per-track RAM + state. */
    this.trackSlots = [];
    for (let i = 0; i < MAX_TRACK_INDEX; i += 1) {
      this.trackSlots.push(createEmptySlot());
    }

    /** Stereo pre-roll ring (1 s per channel) — written every process() frame. */
    this.ringBuffers = [new Float32Array(sampleRate), new Float32Array(sampleRate)];
    this.ringWriteCursor = 0;
    this.PRE_ROLL_FRAMES = Math.floor(sampleRate * 0.035);

    /** BPM for provision-cap self-finalize when bridge has not sent STOP_RECORDING yet. */
    this.lastKnownBpm = DEFAULT_BPM;
    this.isPaused = false;
    this.calibration = {
      active: false,
      elapsedFrames: 0,
      clickInjected: false,
      clickFrame: null,
      burstFramesEmitted: 0,
    };

    this.port.onmessage = (event) => {
      const data = event && event.data ? event.data : null;
      if (!data || typeof data !== "object") return;

      if (data.type === "SELECT_TRACK") {
        this.selectTrack(data);
        return;
      }

      if (data.type === "CONFIGURE_LOOP") {
        this.configureLoop(data);
        return;
      }

      if (data.type === "START_RECORDING") {
        this.startRecording(data);
        return;
      }

      if (data.type === "ARM_OVERDUB") {
        this.armOverdub(data);
        return;
      }

      if (data.type === "DISARM_OVERDUB") {
        this.disarmOverdub(data);
        return;
      }

      if (data.type === "STOP_LOOP") {
        this.stopLoop();
        return;
      }

      if (data.type === "RESET_LOOP") {
        this.reset();
        return;
      }

      if (data.type === "SET_PAUSED") {
        this.setPaused(data);
        return;
      }

      if (data.type === "RESET_TRACK") {
        this.resetTrack(data);
        return;
      }

      if (data.type === "SET_TRACK_GAIN") {
        this.setTrackGain(data);
        return;
      }

      if (data.type === "REQUEST_PLAYBACK_UI_STATE") {
        this.postPlaybackUiState();
        return;
      }

      if (data.type === "STOP_RECORDING") {
        this.stopRecording(data);
        return;
      }

      if (data.type === "START_CALIBRATION") {
        this.startCalibration();
        return;
      }
    };
  }

  getActiveSlot() {
    return this.trackSlots[this.activeTrackIndex - 1];
  }

  getSlotForTrack(trackIndex) {
    return this.trackSlots[trackIndex - 1];
  }

  /** @returns {number | null} Track index 1–4, or null if invalid. */
  normalizeTrackIndex(value) {
    const n = Math.floor(Number(value));
    if (!Number.isFinite(n)) return null;
    if (n < MIN_TRACK_INDEX || n > MAX_TRACK_INDEX) return null;
    return n;
  }

  /** @returns {boolean} True if track index is 2, 3, or 4. */
  isOverdubTrackIndex(trackIndex) {
    return trackIndex >= 2 && trackIndex <= MAX_TRACK_INDEX;
  }

  /**
   * Clamps interval frames to (0, maxRecordingFrames]. Invalid / non-positive → null.
   * @returns {{ value: number, clamped: boolean } | null}
   */
  clampIntervalFrames(intervalFrames) {
    const raw = Math.floor(Number(intervalFrames));
    if (!Number.isFinite(raw) || raw <= 0) {
      return null;
    }
    if (raw > this.maxRecordingFrames) {
      return { value: this.maxRecordingFrames, clamped: true };
    }
    return { value: raw, clamped: false };
  }

  freeSlotBuffers(slot) {
    slot.recordingBuffer = null;
    slot.playbackBuffer = null;
  }

  resetSlotToIdle(slot) {
    slot.mode = "idle";
    slot.configured = false;
    slot.intervalFrames = 0;
    slot.loopId = null;
    slot.recordCursor = 0;
    slot.playbackCursor = 0;
    slot.recordWriteOffsetInBlock = 0;
    slot.recordingEpochFrames = 0;
    slot.atProvisionCap = false;
    slot.loopMode = "free";
    slot.targetLengthFrames = null;
    slot.latencyOffsetFrames = 0;
    slot.stopTargetFrames = null;
    slot.stopOptions = null;
    this.freeSlotBuffers(slot);
  }

  normalizeLoopMode(value) {
    return value === "grid" ? "grid" : "free";
  }

  normalizeTargetLengthFrames(value) {
    const n = Math.floor(Number(value));
    if (!Number.isFinite(n) || n <= 0) {
      return null;
    }
    return Math.max(1, Math.min(n, this.maxRecordingFrames));
  }

  normalizeLatencyOffsetFrames(value) {
    const n = Math.floor(Number(value));
    if (!Number.isFinite(n) || n <= 0) {
      return 0;
    }
    return Math.max(0, n);
  }

  postConfigureRejected(reason, trackIndex) {
    try {
      this.port.postMessage({
        type: "CONFIGURE_REJECTED",
        reason,
        trackIndex,
        sampleRate,
      });
    } catch {
      /* ignore */
    }
  }

  postOverdubArmRejected(reason, trackIndex) {
    try {
      this.port.postMessage({
        type: "OVERDUB_ARM_REJECTED",
        reason,
        trackIndex,
      });
    } catch {
      /* ignore */
    }
  }

  applyActiveSlotToProcessorState(slot) {
    slot.mode = "idle";
    slot.recordCursor = 0;
    slot.playbackCursor = 0;
    slot.recordWriteOffsetInBlock = 0;
    slot.recordingBuffer = null;
    slot.playbackBuffer = null;
    if (slot.intervalFrames > 0 && slot.configured) {
      slot.recordingBuffer = new Float32Array(slot.intervalFrames * slot.channelCount);
    }
  }

  selectTrack(data) {
    const trackIndex = this.normalizeTrackIndex(data.trackIndex);
    if (trackIndex === null) {
      this.reportState("TRACK_SELECT_REJECTED");
      return;
    }

    this.activeTrackIndex = trackIndex;
    this.reportState("TRACK_SELECTED");
  }

  reset() {
    this.overdubArm = null;
    this.activeTrackIndex = 1;
    this.lastKnownBpm = DEFAULT_BPM;
    this.isPaused = false;
    for (let i = 0; i < MAX_TRACK_INDEX; i += 1) {
      this.trackSlots[i] = createEmptySlot();
    }
    this.reportState("RESET");
  }

  setPaused(data) {
    this.isPaused = data.paused === true;
    this.reportState(this.isPaused ? "PAUSED" : "RESUMED");
  }

  startCalibration() {
    this.calibration.active = true;
    this.calibration.elapsedFrames = 0;
    this.calibration.clickInjected = false;
    this.calibration.clickFrame = null;
    this.calibration.burstFramesEmitted = 0;
  }

  finishCalibration(latencyFrames) {
    try {
      this.port.postMessage({
        type: "CALIBRATION_RESULT",
        latencyFrames: Number.isFinite(latencyFrames) ? Math.max(0, Math.floor(latencyFrames)) : null,
      });
    } catch {
      /* ignore */
    }
    this.calibration.active = false;
    this.calibration.elapsedFrames = 0;
    this.calibration.clickInjected = false;
    this.calibration.clickFrame = null;
    this.calibration.burstFramesEmitted = 0;
  }

  resetTrack(data) {
    const trackIndex = this.normalizeTrackIndex(data.trackIndex);
    if (trackIndex === null) {
      this.postConfigureRejected("invalid_track", data.trackIndex);
      return;
    }

    if (trackIndex === 1) {
      this.overdubArm = null;
      this.activeTrackIndex = 1;
      for (let i = 0; i < MAX_TRACK_INDEX; i += 1) {
        this.resetSlotToIdle(this.trackSlots[i]);
        this.postTrackState("TRACK_RESET", i + 1);
      }
      this.isPaused = false;
      this.postPlaybackUiState();
      return;
    }

    if (this.overdubArm && this.overdubArm.trackIndex === trackIndex) {
      this.overdubArm = null;
    }
    this.resetSlotToIdle(this.getSlotForTrack(trackIndex));
    this.postTrackState("TRACK_RESET", trackIndex);
    this.postPlaybackUiState();
  }

  /** @returns {number} Effective BPM (updates lastKnownBpm when valid). */
  resolveBpm(bpm) {
    const n = Number(bpm);
    if (Number.isFinite(n) && n > 0) {
      this.lastKnownBpm = n;
      return n;
    }
    return this.lastKnownBpm;
  }

  snapshotMasterPhase() {
    const master = this.trackSlots[0];
    if (master.mode === "playing" && master.intervalFrames > 0) {
      return master.playbackCursor % master.intervalFrames;
    }
    return null;
  }

  computeRawTargetFrames(slot) {
    const epoch = slot.recordingEpochFrames;
    if (!Number.isFinite(epoch) || epoch < 0) {
      return Math.max(1, slot.recordCursor);
    }
    const raw = slot.recordCursor - epoch;
    return Math.max(1, raw);
  }

  /**
   * Worklet-authoritative loop length (V4.1). All paths clamp to maxRecordingFrames.
   * @returns {number | null}
   */
  computeFinalIntervalFrames(trackIndex, slot, bpm) {
    const rawTargetFrames = this.computeRawTargetFrames(slot);
    const effectiveBpm = this.resolveBpm(bpm);

    if (trackIndex === 1) {
      if (slot.loopMode === "free") {
        return Math.max(1, Math.min(Math.floor(rawTargetFrames), this.maxRecordingFrames));
      }

      const framesPerBeat = sampleRate * (60 / effectiveBpm);
      const beatsRounded = Math.max(1, Math.round(rawTargetFrames / framesPerBeat));
      const quantizedFrames = Math.round(beatsRounded * framesPerBeat);
      return Math.max(1, Math.min(quantizedFrames, this.maxRecordingFrames));
    }

    const masterFrames = this.trackSlots[0].intervalFrames;
    if (!Number.isFinite(masterFrames) || masterFrames <= 0) {
      return null;
    }
    let snapped = snapToMasterMultiple(rawTargetFrames, masterFrames);
    if (!Number.isFinite(snapped) || snapped <= 0) {
      return null;
    }
    return Math.max(1, Math.min(Math.floor(snapped), this.maxRecordingFrames));
  }

  resolveLatencyShiftFrames(slot, latencyOffsetFrames) {
    const channels = Math.max(1, Math.floor(Number(slot.channelCount) || 1));
    const bufferFrames = slot.recordingBuffer
      ? Math.floor(slot.recordingBuffer.length / channels)
      : 0;
    const recordedFrames = Math.max(
      0,
      Math.min(Math.floor(Number(slot.recordCursor) || 0), bufferFrames)
    );
    const rawOffset = Math.floor(Number(latencyOffsetFrames) || 0);
    if (!Number.isFinite(rawOffset) || rawOffset <= 0 || recordedFrames <= 1) {
      return 0;
    }

    return Math.max(0, Math.min(rawOffset, recordedFrames - 1));
  }

  findNearestZeroCrossing(buffer, targetIndex, maxWindow, channels, direction = -1) {
    if (!buffer || buffer.length <= 0) {
      return targetIndex;
    }
    const channelCount = Math.max(1, Math.floor(Number(channels) || 1));
    const totalFrames = Math.floor(buffer.length / channelCount);
    if (!Number.isFinite(totalFrames) || totalFrames <= 0) {
      return targetIndex;
    }

    const windowFrames = Math.max(1, Math.floor(Number(maxWindow) || 1));

    if (direction === 1) {
      // Forward scan: find the first zero crossing at or after targetIndex.
      const startFrame = Math.max(1, Math.floor(Number(targetIndex) || 0));
      const maxFrame = Math.min(totalFrames - 1, startFrame + windowFrames);
      for (let i = startFrame; i <= maxFrame; i += 1) {
        const current  = buffer[i * channelCount] || 0;
        const previous = buffer[(i - 1) * channelCount] || 0;
        if ((current >= 0 && previous < 0) || (current < 0 && previous >= 0)) {
          return i;
        }
      }
      return targetIndex;
    }

    // Backward scan (default, direction === -1): find the first zero crossing
    // at or before targetIndex.
    const startFrame = Math.min(
      Math.max(1, Math.floor(Number(targetIndex) || 1)),
      totalFrames
    );
    const minFrame = Math.max(1, startFrame - windowFrames);

    for (let i = startFrame; i >= minFrame; i -= 1) {
      const current  = buffer[i * channelCount] || 0;
      const previous = buffer[(i - 1) * channelCount] || 0;
      if ((current >= 0 && previous < 0) || (current < 0 && previous >= 0)) {
        return i;
      }
    }

    return targetIndex;
  }

  /**
   * Trim recording, apply seam crossfade, phase-lock overdubs, emit LOOP_READY.
   * @param {{ masterPhase: number | null, channelCount: number, loopId: string | null, requestedIntervalFrames?: number, postProvisionClamp?: boolean, latencyOffsetFrames?: number }} options
   */
  finalizeRecordingSlot(targetTrackIndex, nextIntervalFrames, options) {
    const slot = this.getSlotForTrack(targetTrackIndex);
    const masterPhase = options.masterPhase;
    let transportIntervalFrames = Math.max(
      1,
      Math.min(Math.floor(Number(nextIntervalFrames) || 1), this.maxRecordingFrames)
    );
    const isFreeMaster = targetTrackIndex === 1 && slot.loopMode === "free";
    let extractionEndFrames = transportIntervalFrames;
    let startOffset = 0;
    if (targetTrackIndex === 1) {
      const optimizedFrames = this.findNearestZeroCrossing(
        slot.recordingBuffer,
        transportIntervalFrames,
        512,
        slot.channelCount
      );
      extractionEndFrames = Math.max(
        1,
        Math.min(optimizedFrames, transportIntervalFrames)
      );

      const optimizedStartOffset = this.findNearestZeroCrossing(
        slot.recordingBuffer,
        0,
        512,
        slot.channelCount,
        1
      );
      startOffset = Math.max(0, Math.min(optimizedStartOffset, extractionEndFrames - 1));
    }
    const nextChannelCount = Math.max(
      1,
      Math.min(2, Math.floor(Number(options.channelCount) || slot.channelCount))
    );
    const nextLoopId =
      options.loopId !== undefined && options.loopId !== null
        ? String(options.loopId)
        : slot.loopId;

    const requested =
      options.requestedIntervalFrames !== undefined
        ? Math.floor(Number(options.requestedIntervalFrames))
        : nextIntervalFrames;

    if (
      requested > this.maxRecordingFrames ||
      options.postProvisionClamp === true
    ) {
      try {
        this.port.postMessage({
          type: "CONFIGURE_CLAMPED",
          trackIndex: targetTrackIndex,
          requestedIntervalFrames: requested,
          appliedIntervalFrames: transportIntervalFrames,
          maxRecordingFrames: this.maxRecordingFrames,
          sampleRate,
        });
      } catch {
        /* ignore */
      }
    }

    slot.intervalFrames = transportIntervalFrames;
    slot.channelCount = nextChannelCount;
    slot.loopId = nextLoopId;
    slot.configured = true;

    const channels = slot.channelCount;
    const latencyShiftFrames = this.resolveLatencyShiftFrames(
      slot,
      options.latencyOffsetFrames
    );
    const bufferFrames = slot.recordingBuffer
      ? Math.floor(slot.recordingBuffer.length / channels)
      : 0;
    const recordedFrames = Math.max(
      0,
      Math.min(Math.floor(Number(slot.recordCursor) || 0), bufferFrames)
    );
    const readStartFrame = Math.max(
      0,
      Math.min(startOffset + latencyShiftFrames, Math.max(0, recordedFrames - 1))
    );
    const availableReadFrames = Math.max(0, recordedFrames - readStartFrame);
    const extractionWindowFrames = Math.max(0, extractionEndFrames - startOffset);
    const extractedFrames = Math.max(
      0,
      Math.min(transportIntervalFrames, extractionWindowFrames, availableReadFrames)
    );
    if (isFreeMaster) {
      transportIntervalFrames = Math.max(1, Math.min(extractedFrames, this.maxRecordingFrames));
    }
    const n = transportIntervalFrames;
    const copyFrames = Math.max(0, Math.min(n, extractedFrames));
    const recorded = slot.recordCursor;
    const playback = new Float32Array(n * channels);
    const startOffsetIndex = readStartFrame * channels;
    const endOffsetIndex = (readStartFrame + copyFrames) * channels;
    playback.set(slot.recordingBuffer.subarray(startOffsetIndex, endOffsetIndex));

    if (targetTrackIndex !== 1) {
      const crossfadeSamples = Math.min(LOOP_CROSSFADE_SAMPLES, Math.floor(n / 2));
      if (crossfadeSamples >= 2 && recorded > 0) {
        const fadeOutStart = n - crossfadeSamples;
        const denom = crossfadeSamples - 1;
        for (let i = 0; i < crossfadeSamples; i += 1) {
          const theta = (i / denom) * (Math.PI / 2);
          const tailGain = Math.cos(theta);
          const headGain = Math.sin(theta);
          const tailBase = (fadeOutStart + i) * channels;
          const headBase = i * channels;
          for (let c = 0; c < channels; c += 1) {
            const tail = playback[tailBase + c];
            const head = playback[headBase + c];
            playback[tailBase + c] = tail * tailGain + head * headGain;
          }
        }
      }
    }

    slot.recordingBuffer = null;
    slot.playbackBuffer = playback;
    slot.intervalFrames = n;
    slot.recordCursor = 0;
    slot.targetLengthFrames = null;
    slot.latencyOffsetFrames = 0;
    if (this.isOverdubTrackIndex(targetTrackIndex) && masterPhase !== null) {
      slot.playbackCursor = masterPhase % transportIntervalFrames;
    } else {
      slot.playbackCursor = 0;
    }
    slot.mode = "playing";

    const transferBuffer = playback.slice().buffer;
    try {
      this.port.postMessage(
        {
          type: "LOOP_READY",
          trackIndex: targetTrackIndex,
          loopId: slot.loopId,
          sampleRate,
          intervalFrames: slot.intervalFrames,
          channelCount: slot.channelCount,
          buffer: transferBuffer,
        },
        [transferBuffer]
      );
    } catch {
      /* ignore */
    }

    this.activeTrackIndex = targetTrackIndex;
    this.reportState("PLAYING");
  }

  postAutoStopCompleted(trackIndex) {
    const slot = this.getSlotForTrack(trackIndex);
    try {
      this.port.postMessage({
        type: "AUTO_STOP_COMPLETED",
        trackIndex,
        loopId: slot.loopId,
      });
    } catch {
      /* ignore */
    }
  }

  /** V4.1: atomic pedal-up finalize (no bridge intervalFrames). */
  stopRecording(data) {
    const explicitTrack = this.normalizeTrackIndex(data.trackIndex);
    const targetTrackIndex = explicitTrack !== null ? explicitTrack : this.activeTrackIndex;
    const slot = this.getSlotForTrack(targetTrackIndex);

    if (slot.mode !== "recording" || !slot.recordingBuffer) {
      this.postConfigureRejected("not_recording", targetTrackIndex);
      return;
    }

    if (data.loopMode !== undefined) {
      slot.loopMode = this.normalizeLoopMode(data.loopMode);
    }
    this.resolveBpm(data.bpm);
    const masterPhase = this.snapshotMasterPhase();

    if (this.isOverdubTrackIndex(targetTrackIndex) && masterPhase === null) {
      this.postOverdubArmRejected("master_not_playing_at_finalize", targetTrackIndex);
      return;
    }

    const nextIntervalFrames = this.computeFinalIntervalFrames(
      targetTrackIndex,
      slot,
      data.bpm
    );
    if (nextIntervalFrames === null) {
      this.postConfigureRejected("quantize_failed", targetTrackIndex);
      return;
    }

    const nextChannelCount = Math.max(
      1,
      Math.min(2, Math.floor(Number(data.channelCount) || slot.channelCount))
    );
    const nextLoopId =
      typeof data.loopId === "string" || typeof data.loopId === "number"
        ? String(data.loopId)
        : slot.loopId;

    if (slot.recordCursor < nextIntervalFrames) {
      // Post-roll: mic stays hot — keep recording until we reach the quantized boundary.
      // Capture finalization options now (masterPhase must be snapshotted at stop time).
      slot.stopTargetFrames = nextIntervalFrames;
      slot.stopOptions = {
        masterPhase,
        channelCount: nextChannelCount,
        loopId: nextLoopId,
        requestedIntervalFrames: this.computeRawTargetFrames(slot),
        latencyOffsetFrames: data.latencyOffsetFrames,
      };
      // Extend the provision cap so the recording loop doesn't hit it prematurely.
      slot.intervalFrames =
        (slot.recordingEpochFrames || 0) +
        nextIntervalFrames +
        (slot.latencyOffsetFrames || 0);
      return;
    }

    this.finalizeRecordingSlot(targetTrackIndex, nextIntervalFrames, {
      masterPhase,
      channelCount: nextChannelCount,
      loopId: nextLoopId,
      requestedIntervalFrames: this.computeRawTargetFrames(slot),
      latencyOffsetFrames: data.latencyOffsetFrames,
    });
  }

  /**
   * Gap 3: provision cap / buffer-full — same quantize path as STOP_RECORDING, no bridge round-trip.
   */
  selfFinalizeRecording(trackIndex) {
    const slot = this.getSlotForTrack(trackIndex);
    if (slot.mode !== "recording" || !slot.recordingBuffer) {
      return;
    }

    const masterPhase = this.snapshotMasterPhase();
    if (this.isOverdubTrackIndex(trackIndex) && masterPhase === null) {
      this.postConfigureRejected("master_not_playing_at_finalize", trackIndex);
      return;
    }

    const provisionFrames = slot.intervalFrames;
    const nextIntervalFrames = this.computeFinalIntervalFrames(
      trackIndex,
      slot,
      this.lastKnownBpm
    );
    if (nextIntervalFrames === null) {
      this.postConfigureRejected("quantize_failed", trackIndex);
      return;
    }

    this.finalizeRecordingSlot(trackIndex, nextIntervalFrames, {
      masterPhase,
      channelCount: slot.channelCount,
      loopId: slot.loopId,
      requestedIntervalFrames: provisionFrames,
      postProvisionClamp: provisionFrames > nextIntervalFrames,
    });
  }

  armOverdub(data) {
    const trackIndex = this.normalizeTrackIndex(data.trackIndex);
    if (trackIndex === null || !this.isOverdubTrackIndex(trackIndex)) {
      this.postOverdubArmRejected("invalid_track", trackIndex ?? 0);
      return;
    }

    const provisionClamped = this.clampIntervalFrames(data.intervalFrames);
    if (provisionClamped === null) {
      this.postOverdubArmRejected("provision_invalid", trackIndex);
      return;
    }

    const provisionFrames = provisionClamped.value;
    const channelCount = Math.max(1, Math.min(2, Math.floor(Number(data.channelCount) || 2)));
    const loopId =
      typeof data.loopId === "string" || typeof data.loopId === "number" ? String(data.loopId) : null;

    const master = this.trackSlots[0];
    if (master.mode !== "playing" || master.intervalFrames <= 0) {
      this.postOverdubArmRejected("master_not_playing", trackIndex);
      return;
    }

    const target = this.getSlotForTrack(trackIndex);
    if (target.mode === "recording" || target.mode === "playing") {
      this.postOverdubArmRejected("target_busy", trackIndex);
      return;
    }

    if (this.overdubArm !== null && this.overdubArm.trackIndex !== trackIndex) {
      const prevIndex = this.overdubArm.trackIndex;
      this.resetSlotToIdle(this.getSlotForTrack(prevIndex));
      try {
        this.port.postMessage({ type: "OVERDUB_DISARMED", trackIndex: prevIndex });
      } catch {
        /* ignore */
      }
    }

    this.resetSlotToIdle(target);
    target.intervalFrames = provisionFrames;
    target.channelCount = channelCount;
    target.loopId = loopId;
    target.configured = true;
    target.mode = "armed_overdub";
    target.recordCursor = 0;
    target.latencyOffsetFrames = this.normalizeLatencyOffsetFrames(data.latencyOffsetFrames);
    target.playbackCursor = 0;
    target.recordWriteOffsetInBlock = 0;
    target.recordingBuffer = new Float32Array(provisionFrames * channelCount);
    target.playbackBuffer = null;

    this.overdubArm = { trackIndex, provisionFrames, channelCount, loopId };
    if (data.bpm !== undefined) {
      this.resolveBpm(data.bpm);
    }

    try {
      this.port.postMessage({
        type: "OVERDUB_ARMED",
        trackIndex,
        intervalFrames: provisionFrames,
        channelCount,
        sampleRate,
      });
    } catch {
      /* ignore */
    }
  }

  disarmOverdub(data) {
    const passedTrack = this.normalizeTrackIndex(data.trackIndex);

    if (this.overdubArm === null) {
      this.postOverdubArmRejected(
        "not_armed",
        passedTrack !== null ? passedTrack : 0
      );
      return;
    }

    const armedTrackIndex = this.overdubArm.trackIndex;

    if (passedTrack !== null && passedTrack !== armedTrackIndex) {
      this.postOverdubArmRejected("not_armed", passedTrack);
      return;
    }

    const slot = this.getSlotForTrack(armedTrackIndex);

    if (slot.mode === "armed_overdub") {
      this.resetSlotToIdle(slot);
      this.overdubArm = null;
      try {
        this.port.postMessage({ type: "OVERDUB_DISARMED", trackIndex: armedTrackIndex });
      } catch {
        /* ignore */
      }
      return;
    }

    if (slot.mode === "recording") {
      this.postOverdubArmRejected("already_recording", armedTrackIndex);
      return;
    }

    this.postOverdubArmRejected("not_armed", armedTrackIndex);
  }

  beginOverdubRecordingAtDownbeat(trackIndex, rem) {
    const slot = this.getSlotForTrack(trackIndex);
    const masterSlot = this.trackSlots[0];

    if (slot.mode !== "armed_overdub") {
      this.postOverdubArmRejected("slot_state_mismatch", trackIndex);
      return;
    }

    this.overdubArm = null;
    this.activeTrackIndex = trackIndex;

    slot.mode = "recording";
    slot.recordWriteOffsetInBlock = rem;
    slot.playbackBuffer = null;
    this.applyPreRollToSlot(slot);
    slot.recordingEpochFrames = slot.recordCursor;
    slot.atProvisionCap = false;
    slot.loopMode = masterSlot.loopMode;
    if (slot.loopMode === "grid") {
      slot.targetLengthFrames = masterSlot.intervalFrames;
    }

    try {
      this.port.postMessage({
        type: "OVERDUB_STARTED",
        trackIndex,
        sampleRate,
        currentTime,
        masterPlaybackCursor: masterSlot.playbackCursor,
        framesRemaining: rem,
      });
    } catch {
      /* ignore */
    }
  }

  configureLoop(data) {
    const explicitTrack = this.normalizeTrackIndex(data.trackIndex);
    const targetTrackIndex = explicitTrack !== null ? explicitTrack : this.activeTrackIndex;
    const slot = this.trackSlots[targetTrackIndex - 1];

    if (slot.mode === "armed_overdub") {
      this.postOverdubArmRejected("slot_busy_armed", targetTrackIndex);
      return;
    }

    /** V4.1: recording finalize is STOP_RECORDING / selfFinalizeRecording only. */
    if (slot.mode === "recording" && slot.recordingBuffer) {
      this.postConfigureRejected("use_stop_recording", targetTrackIndex);
      return;
    }

    const clamped = this.clampIntervalFrames(data.intervalFrames);
    if (clamped === null) {
      slot.configured = false;
      slot.intervalFrames = 0;
      slot.loopId = null;
      slot.mode = "idle";
      slot.recordCursor = 0;
      slot.playbackCursor = 0;
      slot.recordWriteOffsetInBlock = 0;
      slot.recordingBuffer = null;
      slot.playbackBuffer = null;
      if (targetTrackIndex === this.activeTrackIndex) {
        this.reportState("CONFIGURE_REJECTED");
      }
      return;
    }

    const nextIntervalFrames = clamped.value;
    const nextChannelCount = Math.max(1, Math.min(2, Math.floor(Number(data.channelCount) || 2)));
    const nextLoopId =
      typeof data.loopId === "string" || typeof data.loopId === "number" ? String(data.loopId) : null;

    slot.intervalFrames = nextIntervalFrames;
    slot.channelCount = nextChannelCount;
    slot.loopId = nextLoopId;
    slot.configured = true;

    if (clamped.clamped) {
      try {
        this.port.postMessage({
          type: "CONFIGURE_CLAMPED",
          trackIndex: targetTrackIndex,
          requestedIntervalFrames: Math.floor(Number(data.intervalFrames)),
          appliedIntervalFrames: nextIntervalFrames,
          maxRecordingFrames: this.maxRecordingFrames,
          sampleRate,
        });
      } catch {
        /* port may be busy or closing */
      }
    }

    if (targetTrackIndex === this.activeTrackIndex) {
      this.applyActiveSlotToProcessorState(slot);
      this.reportState("CONFIGURED");
    } else {
      slot.mode = "idle";
      slot.recordCursor = 0;
      slot.playbackCursor = 0;
      slot.recordWriteOffsetInBlock = 0;
      slot.recordingBuffer = null;
      slot.playbackBuffer = null;
    }
  }

  startRecording(data = {}) {
    const slot = this.getActiveSlot();
    if (slot.intervalFrames <= 0) return;

    slot.loopMode = this.normalizeLoopMode(data.loopMode);
    slot.targetLengthFrames = this.normalizeTargetLengthFrames(data.targetLengthFrames);
    slot.latencyOffsetFrames = this.normalizeLatencyOffsetFrames(data.latencyOffsetFrames);
    slot.mode = "recording";
    slot.playbackCursor = 0;
    slot.recordWriteOffsetInBlock = 0;
    slot.recordingBuffer = new Float32Array(slot.intervalFrames * slot.channelCount);
    slot.playbackBuffer = null;
    this.applyPreRollToSlot(slot);
    slot.recordingEpochFrames = slot.recordCursor;
    slot.atProvisionCap = false;
    this.reportState("RECORDING");
  }

  stopLoop() {
    const slot = this.getActiveSlot();
    slot.mode = "idle";
    this.reportState("STOPPED");
  }

  reportState(state) {
    this.postTrackState(state, this.activeTrackIndex);
  }

  postTrackState(state, trackIndex) {
    const slot = this.getSlotForTrack(trackIndex);
    this.port.postMessage({
      type: "LOOP_STATE",
      state,
      trackIndex,
      loopId: slot.loopId,
      intervalFrames: slot.intervalFrames,
      channelCount: slot.channelCount,
      sampleRate,
      maxRecordingFrames: this.maxRecordingFrames,
    });
  }

  /**
   * Sum all live input channels for this frame, normalize by count → centered mono.
   */
  computeInputMonoSumNormalized(inputChannels, frameIndex) {
    const chans = inputChannels || [];
    if (chans.length === 0) {
      return 0;
    }
    let sum = 0;
    for (let i = 0; i < chans.length; i += 1) {
      const ch = chans[i];
      sum += ch && frameIndex < ch.length ? ch[frameIndex] || 0 : 0;
    }
    return sum / chans.length;
  }

  writeRecordingMono(slot, loopFrameIndex, monoSample) {
    if (!slot.recordingBuffer || slot.channelCount <= 0) return;
    const base = loopFrameIndex * slot.channelCount;
    for (let c = 0; c < slot.channelCount; c += 1) {
      slot.recordingBuffer[base + c] = monoSample;
    }
  }

  /**
   * Copy the last PRE_ROLL_FRAMES from the stereo ring into the start of slot.recordingBuffer.
   * ringWriteCursor points at the next write index; newest sample is at (cursor - 1).
   */
  applyPreRollToSlot(slot) {
    if (!slot.recordingBuffer || slot.channelCount <= 0) return;

    const ringLen = sampleRate;
    const preRoll = Math.min(this.PRE_ROLL_FRAMES, slot.intervalFrames);

    for (let i = 0; i < preRoll; i += 1) {
      const ringIndex = (this.ringWriteCursor - preRoll + i + ringLen) % ringLen;
      const base = i * slot.channelCount;
      for (let c = 0; c < slot.channelCount; c += 1) {
        const ringCh = c < this.ringBuffers.length ? c : 0;
        slot.recordingBuffer[base + c] = this.ringBuffers[ringCh][ringIndex];
      }
    }

    slot.recordCursor = this.PRE_ROLL_FRAMES <= slot.intervalFrames
      ? this.PRE_ROLL_FRAMES
      : preRoll;
  }

  sampleSlotPlayback(slot, outputChannelIndex) {
    if (slot.mode !== "playing" || !slot.playbackBuffer || slot.intervalFrames <= 0) {
      return 0;
    }
    const sourceChannelIndex =
      slot.channelCount === 1 ? 0 : Math.min(outputChannelIndex, slot.channelCount - 1);
    const raw =
      slot.playbackBuffer[slot.playbackCursor * slot.channelCount + sourceChannelIndex] || 0;
    const g = Number.isFinite(slot.gain) ? slot.gain : 1;
    return raw * g;
  }

  setTrackGain(data) {
    const trackIndex = this.normalizeTrackIndex(data.trackIndex);
    if (trackIndex === null) return;
    const slot = this.trackSlots[trackIndex - 1];
    const g = Number(data.gain);
    slot.gain = Number.isFinite(g) ? Math.max(0, Math.min(4, g)) : 1;
  }

  postPlaybackUiState() {
    const slots = [];
    for (let i = 0; i < MAX_TRACK_INDEX; i += 1) {
      const s = this.trackSlots[i];
      const gain = Number.isFinite(s.gain) ? s.gain : 1;
      slots.push({
        trackIndex: i + 1,
        mode: s.mode,
        playbackCursor: s.playbackCursor,
        intervalFrames: s.intervalFrames,
        recordCursor: s.recordCursor,
        gain,
      });
    }
    try {
      this.port.postMessage({ type: "PLAYBACK_UI_STATE", slots });
    } catch {
      /* ignore */
    }
  }

  advancePlaybackCursor(slot) {
    slot.playbackCursor += 1;
    if (slot.playbackCursor >= slot.intervalFrames) {
      slot.playbackCursor = 0;
    }
  }

  /**
   * Provision / buffer cap — delegates to selfFinalizeRecording (V4.1 Gap 3).
   */
  handleRecordingProvisionCap(slot, trackIndex) {
    if (!slot.recordingBuffer || slot.intervalFrames <= 0 || slot.mode !== "recording") {
      return;
    }
    if (slot.atProvisionCap) {
      return;
    }
    slot.atProvisionCap = true;
    if (slot.recordCursor > slot.intervalFrames) {
      slot.recordCursor = slot.intervalFrames;
    }
    this.selfFinalizeRecording(trackIndex);
  }

  process(inputs, outputs) {
    const inputChannels = inputs[0] || [];
    const outputChannels = outputs[0] || [];

    if (outputChannels.length === 0) {
      return true;
    }

    const frameCount = outputChannels[0] ? outputChannels[0].length : 0;
    const blockSize = frameCount || 128;

    const master = this.trackSlots[0];

    if (!this.isPaused && this.overdubArm && master.mode === "playing" && master.intervalFrames > 0) {
      const rem = master.intervalFrames - master.playbackCursor;
      if (rem <= blockSize) {
        this.beginOverdubRecordingAtDownbeat(this.overdubArm.trackIndex, Math.max(0, rem));
      }
    }

    for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
      const monoSample = this.computeInputMonoSumNormalized(inputChannels, frameIndex);
      for (let c = 0; c < 2; c += 1) {
        const inputCh = inputChannels.length > c ? inputChannels[c] : inputChannels[0];
        const sample = inputCh ? inputCh[frameIndex] : 0.0;
        this.ringBuffers[c][this.ringWriteCursor] = sample;
      }
      this.ringWriteCursor = (this.ringWriteCursor + 1) % sampleRate;

      for (let oc = 0; oc < outputChannels.length; oc += 1) {
        let acc = 0;
        if (!this.isPaused) {
          for (let t = 0; t < MAX_TRACK_INDEX; t += 1) {
            acc += this.sampleSlotPlayback(this.trackSlots[t], oc);
          }
        }
        if (
          this.calibration.active &&
          this.calibration.burstFramesEmitted < CALIBRATION_BURST_FRAMES
        ) {
          const burstPolarity = this.calibration.burstFramesEmitted % 2 === 0 ? 1 : -1;
          acc += CALIBRATION_CLICK_AMPLITUDE * burstPolarity;
        }
        const outCh = outputChannels[oc];
        if (outCh) {
          outCh[frameIndex] = acc;
        }
      }

      if (this.calibration.active) {
        if (
          this.calibration.burstFramesEmitted < CALIBRATION_BURST_FRAMES
        ) {
          this.calibration.burstFramesEmitted += 1;
        }

        if (!this.calibration.clickInjected && this.calibration.burstFramesEmitted > 0) {
          this.calibration.clickInjected = true;
          this.calibration.clickFrame = this.calibration.elapsedFrames;
        }

        const canListen =
          this.calibration.clickFrame !== null &&
          this.calibration.elapsedFrames >= this.calibration.clickFrame;

        if (canListen && Math.abs(monoSample) >= CALIBRATION_THRESHOLD) {
          const measuredFrames = this.calibration.elapsedFrames - this.calibration.clickFrame;
          this.finishCalibration(measuredFrames);
        } else if (this.calibration.active) {
          this.calibration.elapsedFrames += 1;
          if (this.calibration.elapsedFrames >= CALIBRATION_TIMEOUT_FRAMES) {
            this.finishCalibration(null);
          }
        }
      }

      let slotJustFinished = null;
      const active = this.getActiveSlot();
      if (!this.isPaused && active.mode === "recording" && active.recordingBuffer) {
        if (frameIndex >= active.recordWriteOffsetInBlock && active.recordCursor < active.intervalFrames) {
          const loopFrameIndex = active.recordCursor;
          this.writeRecordingMono(active, loopFrameIndex, monoSample);

          active.recordCursor += 1;
          if (
            active.loopMode === "grid" &&
            active.targetLengthFrames !== null &&
            active.recordCursor >=
              (active.recordingEpochFrames || 0) +
              active.targetLengthFrames +
              (active.latencyOffsetFrames || 0)
          ) {
            const targetFrames = active.targetLengthFrames;
            const latencyOffsetFrames = active.latencyOffsetFrames;
            const capTrackIndex = this.activeTrackIndex;
            active.targetLengthFrames = null;
            this.finalizeRecordingSlot(capTrackIndex, targetFrames, {
              masterPhase: this.snapshotMasterPhase(),
              channelCount: active.channelCount,
              loopId: active.loopId,
              requestedIntervalFrames: targetFrames,
              latencyOffsetFrames,
            });
            this.postAutoStopCompleted(capTrackIndex);
            if (active.mode === "playing") {
              slotJustFinished = active;
            }
          } else if (
            active.stopTargetFrames !== null &&
            active.recordCursor >=
              (active.recordingEpochFrames || 0) +
              active.stopTargetFrames +
              (active.latencyOffsetFrames || 0)
          ) {
            // Deferred (post-roll) finalization: we have now recorded up to the quantized boundary.
            const tf = active.stopTargetFrames;
            const opts = active.stopOptions;
            const capTrackIndex = this.activeTrackIndex;
            active.stopTargetFrames = null;
            active.stopOptions = null;
            this.finalizeRecordingSlot(capTrackIndex, tf, opts);
            if (active.mode === "playing") {
              slotJustFinished = active;
            }
          } else if (active.recordCursor >= active.intervalFrames) {
            active.recordCursor = active.intervalFrames;
            const capTrackIndex = this.activeTrackIndex;
            this.handleRecordingProvisionCap(active, capTrackIndex);
            if (active.mode === "playing") {
              slotJustFinished = active;
            }
          }
        }
      }

      if (!this.isPaused) {
        for (let t = 0; t < MAX_TRACK_INDEX; t += 1) {
          const s = this.trackSlots[t];
          if (s.mode === "playing" && s !== slotJustFinished) {
            this.advancePlaybackCursor(s);
          }
        }
      }
    }

    for (let i = 0; i < MAX_TRACK_INDEX; i += 1) {
      this.trackSlots[i].recordWriteOffsetInBlock = 0;
    }

    return true;
  }
}

registerProcessor("solo-looper-processor", SoloLooperProcessor);

/**
 * V4.1 W1 dev harness — verify worklet before E1/P1 (solo engine must exist, track recording):
 *
 *   soloLooperEngineRef.current.workletNode.port.postMessage({
 *     type: "STOP_RECORDING",
 *     trackIndex: 1,
 *     bpm: 120,
 *     channelCount: 2,
 *   });
 *
 * Expect LOOP_READY with worklet-computed intervalFrames (not bridge configureLoop).
 */
