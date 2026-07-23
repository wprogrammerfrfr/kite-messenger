const MAX_VOICES = 4;
const ATTACK_SEC = 0.02;
const RELEASE_SEC = 0.08;
const DEFAULT_GAIN = 0.18;
/** Local foldback to speakers; mixer/stream path stays at masterGain 1.0. */
const MONITOR_GAIN = 0.35;

const ALLOWED_WAVEFORMS = new Set<OscillatorType>([
  "sine",
  "square",
  "sawtooth",
  "triangle",
]);

type Voice = {
  osc: OscillatorNode;
  gain: GainNode;
  frequency: number;
};

export type KiteThereminSynth = {
  setChordFrequencies: (hz: number[]) => void;
  silence: () => void;
  setVolume: (level: number) => void;
  setWaveform: (type: OscillatorType) => void;
  getOutputStream: () => MediaStream;
  resumeIfSuspended: () => Promise<void>;
  dispose: () => void;
};

export function createKiteThereminSynth(ctx: AudioContext): KiteThereminSynth {
  const masterGain = ctx.createGain();
  masterGain.gain.value = 1;

  const destination = ctx.createMediaStreamDestination();
  masterGain.connect(destination);

  const monitorGain = ctx.createGain();
  monitorGain.gain.value = MONITOR_GAIN;
  masterGain.connect(monitorGain);
  monitorGain.connect(ctx.destination);

  const voicePool: Voice[] = [];
  for (let i = 0; i < MAX_VOICES; i++) {
    const gain = ctx.createGain();
    gain.gain.value = 0;
    gain.connect(masterGain);
    voicePool.push({ osc: null as unknown as OscillatorNode, gain, frequency: 0 });
  }

  let disposed = false;
  let waveform: OscillatorType = "triangle";

  const ensureVoices = (): void => {
    for (let i = 0; i < MAX_VOICES; i++) {
      const slot = voicePool[i]!;
      if (!slot.osc || slot.osc.context !== ctx) {
        try {
          slot.osc?.stop();
          slot.osc?.disconnect();
        } catch {
          /* ignore */
        }
        const osc = ctx.createOscillator();
        osc.type = waveform;
        osc.frequency.value = slot.frequency || 440;
        osc.connect(slot.gain);
        osc.start();
        slot.osc = osc;
      }
    }
  };

  const rampGain = (gainNode: GainNode, target: number, when: number, duration: number): void => {
    gainNode.gain.cancelScheduledValues(when);
    gainNode.gain.setValueAtTime(gainNode.gain.value, when);
    gainNode.gain.linearRampToValueAtTime(target, when + duration);
  };

  const setChordFrequencies = (hz: number[]): void => {
    if (disposed) return;
    ensureVoices();
    const now = ctx.currentTime;
    const freqs = hz.filter((f) => Number.isFinite(f) && f > 0).slice(0, MAX_VOICES);

    for (let i = 0; i < MAX_VOICES; i++) {
      const slot = voicePool[i]!;
      const freq = freqs[i];
      if (freq !== undefined) {
        slot.frequency = freq;
        slot.osc.frequency.setTargetAtTime(freq, now, 0.01);
        rampGain(slot.gain, DEFAULT_GAIN, now, ATTACK_SEC);
      } else {
        rampGain(slot.gain, 0, now, RELEASE_SEC);
      }
    }
  };

  const silence = (): void => {
    if (disposed) return;
    const now = ctx.currentTime;
    for (const slot of voicePool) {
      rampGain(slot.gain, 0, now, RELEASE_SEC);
    }
  };

  const setVolume = (level: number): void => {
    if (disposed) return;
    const clamped = Math.min(1, Math.max(0, Number.isFinite(level) ? level : 0));
    const now = ctx.currentTime;
    masterGain.gain.cancelScheduledValues(now);
    masterGain.gain.setTargetAtTime(clamped, now, 0.02);
  };

  const setWaveform = (type: OscillatorType): void => {
    if (disposed) return;
    if (!ALLOWED_WAVEFORMS.has(type)) return;
    waveform = type;
    for (const slot of voicePool) {
      if (slot.osc) {
        try {
          slot.osc.type = type;
        } catch {
          /* ignore */
        }
      }
    }
  };

  const resumeIfSuspended = async (): Promise<void> => {
    if (ctx.state === "suspended") {
      await ctx.resume();
    }
  };

  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    silence();
    for (const slot of voicePool) {
      try {
        slot.osc?.stop();
        slot.osc?.disconnect();
      } catch {
        /* ignore */
      }
      slot.gain.disconnect();
    }
    try {
      monitorGain.disconnect();
    } catch {
      /* ignore */
    }
    masterGain.disconnect();
  };

  return {
    setChordFrequencies,
    silence,
    setVolume,
    setWaveform,
    getOutputStream: () => destination.stream,
    resumeIfSuspended,
    dispose,
  };
}
