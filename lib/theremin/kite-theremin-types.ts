export const KITE_AIR_SYNTH_DEVICE_ID = "kite:air-synth";

export type AirSynthMode = "two-hand" | "single-hand";

export type ChordType = "maj" | "m" | "maj7" | "m7" | "m6";

export type RootNote =
  | "C"
  | "C#"
  | "D"
  | "D#"
  | "E"
  | "F"
  | "F#"
  | "G"
  | "G#"
  | "A"
  | "A#"
  | "B";

export type DiatonicDegree = "I" | "ii" | "iii" | "IV" | "V" | "vi" | "vii°";

export type MusicalKey =
  | "C"
  | "G"
  | "D"
  | "A"
  | "E"
  | "B"
  | "F#"
  | "F"
  | "Bb"
  | "Eb"
  | "Ab"
  | "Db"
  | "Gb";

export type AirSynthErrorCode =
  | "none"
  | "webcam_missing"
  | "webcam_denied"
  | "vision_load_failed"
  | "audio_suspended"
  | "audio_context_missing";

export type AirSynthZoneState =
  | {
      mode: "two-hand";
      root: RootNote;
      chordType: ChordType;
      rootSector: number;
      typeSector: number;
    }
  | {
      mode: "single-hand";
      degree: DiatonicDegree;
      degreeSector: number;
    };

export type AirSynthStatus = "idle" | "booting" | "ready" | "error";

export const ROOT_NOTES: readonly RootNote[] = [
  "C",
  "C#",
  "D",
  "D#",
  "E",
  "F",
  "F#",
  "G",
  "G#",
  "A",
  "A#",
  "B",
] as const;

export const CHORD_TYPES: readonly ChordType[] = ["maj", "m", "maj7", "m7", "m6"] as const;

export const DIATONIC_DEGREES: readonly DiatonicDegree[] = [
  "I",
  "ii",
  "iii",
  "IV",
  "V",
  "vi",
  "vii°",
] as const;

export const MUSICAL_KEYS: readonly MusicalKey[] = [
  "C",
  "G",
  "D",
  "A",
  "E",
  "B",
  "F#",
  "F",
  "Bb",
  "Eb",
  "Ab",
  "Db",
  "Gb",
] as const;

/** Hold last chord this long when hands leave frame, then fade. */
export const AIR_SYNTH_HAND_LOST_HOLD_MS = 300;

export const AIR_SYNTH_ZONE_DEBOUNCE_MS = 50;
