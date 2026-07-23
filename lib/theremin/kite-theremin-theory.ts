import {
  DIATONIC_DEGREES,
  type ChordType,
  type DiatonicDegree,
  type MusicalKey,
  type RootNote,
} from "./kite-theremin-types";

const A4_HZ = 440;
const SEMITONE_RATIO = Math.pow(2, 1 / 12);

/** MIDI note number for A4 = 69. */
function noteNameToMidi(note: RootNote, octave: number): number {
  const chromatic: Record<RootNote, number> = {
    C: 0,
    "C#": 1,
    D: 2,
    "D#": 3,
    E: 4,
    F: 5,
    "F#": 6,
    G: 7,
    "G#": 8,
    A: 9,
    "A#": 10,
    B: 11,
  };
  return (octave + 1) * 12 + chromatic[note];
}

function midiToHz(midi: number): number {
  return A4_HZ * Math.pow(SEMITONE_RATIO, midi - 69);
}

function midiNotesToHz(notes: number[]): number[] {
  return notes.map(midiToHz);
}

const CHORD_INTERVALS: Record<ChordType, number[]> = {
  maj: [0, 4, 7],
  m: [0, 3, 7],
  maj7: [0, 4, 7, 11],
  m7: [0, 3, 7, 10],
};

/** Root + type → frequencies (default octave 4 for root). */
export function rootAndTypeToFrequencies(root: RootNote, type: ChordType, rootOctave = 4): number[] {
  const rootMidi = noteNameToMidi(root, rootOctave);
  const intervals = CHORD_INTERVALS[type];
  return midiNotesToHz(intervals.map((i) => rootMidi + i));
}

type ScaleDegreeSpec = { rootOffset: number; type: ChordType };

/** Major scale diatonic triads/seventh qualities per degree. */
const MAJOR_SCALE_DEGREES: ScaleDegreeSpec[] = [
  { rootOffset: 0, type: "maj" },
  { rootOffset: 2, type: "m" },
  { rootOffset: 4, type: "m" },
  { rootOffset: 5, type: "maj" },
  { rootOffset: 7, type: "maj" },
  { rootOffset: 9, type: "m" },
  { rootOffset: 11, type: "m" },
];

const KEY_ROOT_SEMITONE: Record<MusicalKey, number> = {
  C: 0,
  G: 7,
  D: 2,
  A: 9,
  E: 4,
  B: 11,
  "F#": 6,
  F: 5,
  Bb: 10,
  Eb: 3,
  Ab: 8,
  Db: 1,
  Gb: 6,
};

const DEGREE_INDEX: Record<DiatonicDegree, number> = {
  I: 0,
  ii: 1,
  iii: 2,
  IV: 3,
  V: 4,
  vi: 5,
  "vii°": 6,
};

function semitoneToRootNote(semitone: number): RootNote {
  const names: RootNote[] = [
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
  ];
  return names[((semitone % 12) + 12) % 12]!;
}

/** Flat-side major keys prefer flat spellings for display labels. */
const FLAT_SIDE_KEYS = new Set<MusicalKey>(["F", "Bb", "Eb", "Ab", "Db", "Gb"]);

const SHARP_DISPLAY_NAMES = [
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

const FLAT_DISPLAY_NAMES = [
  "C",
  "Db",
  "D",
  "Eb",
  "E",
  "F",
  "Gb",
  "G",
  "Ab",
  "A",
  "Bb",
  "B",
] as const;

function normalizeSemitone(semitone: number): number {
  return ((semitone % 12) + 12) % 12;
}

function semitoneToDisplayName(semitone: number, key: MusicalKey): string {
  const idx = normalizeSemitone(semitone);
  return FLAT_SIDE_KEYS.has(key) ? FLAT_DISPLAY_NAMES[idx]! : SHARP_DISPLAY_NAMES[idx]!;
}

function chordRootSemitoneInKey(key: MusicalKey, degreeIdx: number): number {
  const spec = MAJOR_SCALE_DEGREES[degreeIdx]!;
  return normalizeSemitone(KEY_ROOT_SEMITONE[key] + spec.rootOffset);
}

/** Seven diatonic roots in key as RootNote (sharp spelling for audio/vision). */
export function diatonicRootsInKey(key: MusicalKey): RootNote[] {
  return MAJOR_SCALE_DEGREES.map((_, degreeIdx) =>
    semitoneToRootNote(chordRootSemitoneInKey(key, degreeIdx))
  );
}

/** Seven diatonic root display labels with key-aware sharp/flat spelling. */
export function diatonicRootLabelsInKey(key: MusicalKey): string[] {
  return MAJOR_SCALE_DEGREES.map((_, degreeIdx) =>
    semitoneToDisplayName(chordRootSemitoneInKey(key, degreeIdx), key)
  );
}

/**
 * Exact triad chord label for a diatonic degree in key (UI only).
 * Ignores audio seventh overrides so labels match C / Dm / Bdim style.
 */
export function degreeInKeyToChordLabel(key: MusicalKey, degree: DiatonicDegree): string {
  const degreeIdx = DEGREE_INDEX[degree];
  const rootLabel = semitoneToDisplayName(chordRootSemitoneInKey(key, degreeIdx), key);
  if (degree === "vii°") {
    return `${rootLabel}dim`;
  }
  const spec = MAJOR_SCALE_DEGREES[degreeIdx]!;
  if (spec.type === "m") {
    return `${rootLabel}m`;
  }
  return rootLabel;
}

/** All seven diatonic triad chord labels for a key. */
export function chordLabelsInKey(key: MusicalKey): string[] {
  return DIATONIC_DEGREES.map((degree) => degreeInKeyToChordLabel(key, degree));
}

/** Diatonic degree in key → chord frequencies (major key, octave 4). */
export function degreeInKeyToFrequencies(key: MusicalKey, degree: DiatonicDegree, rootOctave = 4): number[] {
  const degreeIdx = DEGREE_INDEX[degree];
  const spec = MAJOR_SCALE_DEGREES[degreeIdx]!;
  const chordRootSemitone = chordRootSemitoneInKey(key, degreeIdx);
  const root = semitoneToRootNote(chordRootSemitone);
  let type = spec.type;
  if (degree === "vii°") {
    type = "m7";
  } else if (degree === "I" || degree === "IV") {
    type = "maj7";
  } else if (degree === "V") {
    type = "maj";
  }
  return rootAndTypeToFrequencies(root, type, rootOctave);
}
