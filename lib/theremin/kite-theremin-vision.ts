import {
  FilesetResolver,
  HandLandmarker,
  type HandLandmarkerResult,
} from "@mediapipe/tasks-vision";
import { diatonicRootsInKey } from "./kite-theremin-theory";
import {
  CHORD_TYPES,
  DIATONIC_DEGREES,
  type AirSynthMode,
  type AirSynthZoneState,
  type ChordType,
  type MusicalKey,
} from "./kite-theremin-types";

const WASM_CDN =
  "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm";
const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";

/** MediaPipe HandLandmarker landmark index for index fingertip. */
const INDEX_FINGER_TIP = 8;

/** Dial centers in mirrored normalized coords — must match KiteAirSynthPanel layout. */
const SINGLE_HAND_CENTER = { x: 0.5, y: 0.38 };
const TWO_HAND_ROOT_CENTER = { x: 0.22, y: 0.5 };
const TWO_HAND_TYPE_CENTER = { x: 0.78, y: 0.5 };

/** Normalized radial dead zone matching the dial's center hole. */
const INNER_DEAD_ZONE_RADIUS = 0.12;
/** Outer playable ring — calibrated to visual dial outer edge per layout. */
const OUTER_MAX_RADIUS_SINGLE = 0.28;
const OUTER_MAX_RADIUS_TWO_HAND = 0.20;

export type AirSynthPoint = { x: number; y: number };

export type AirSynthFingerPointers = {
  primary: AirSynthPoint | null;
  left: AirSynthPoint | null;
  right: AirSynthPoint | null;
};

export const EMPTY_AIR_SYNTH_POINTERS: AirSynthFingerPointers = {
  primary: null,
  left: null,
  right: null,
};

export type ZoneChangeCallback = (zone: AirSynthZoneState | null) => void;
export type PointersChangeCallback = (pointers: AirSynthFingerPointers) => void;

export type KiteThereminVision = {
  start: (videoEl: HTMLVideoElement) => void;
  stop: () => void;
  setMode: (mode: AirSynthMode) => void;
  setKey: (key: MusicalKey) => void;
  onZoneChange: (cb: ZoneChangeCallback) => () => void;
  onPointersChange: (cb: PointersChangeCallback) => () => void;
  dispose: () => void;
};

function normalizeAngle(rad: number): number {
  let a = rad;
  while (a < 0) a += Math.PI * 2;
  while (a >= Math.PI * 2) a -= Math.PI * 2;
  return a;
}

function angleToSector(angle: number, sectorCount: number): number {
  const slice = (Math.PI * 2) / sectorCount;
  const shifted = normalizeAngle(angle + Math.PI / 2);
  return Math.min(sectorCount - 1, Math.floor(shifted / slice));
}

/** Display mirror is CSS-only; vision math must compensate. */
function mirrorX(xRaw: number): number {
  return 1 - xRaw;
}

/** Strict index-fingertip anchor. Returns null if tip landmark is missing. */
function getIndexTipAnchor(
  landmarks: { x: number; y: number }[]
): AirSynthPoint | null {
  const tip = landmarks[INDEX_FINGER_TIP];
  if (!tip || !Number.isFinite(tip.x) || !Number.isFinite(tip.y)) {
    return null;
  }
  return { x: mirrorX(tip.x), y: tip.y };
}

function radialSectorFromHand(
  hand: AirSynthPoint,
  center: AirSynthPoint,
  sectorCount: number
): number {
  const dx = hand.x - center.x;
  const dy = hand.y - center.y;
  const angle = Math.atan2(dy, dx);
  return angleToSector(angle, sectorCount);
}

function isOutsidePlayableRing(
  tip: AirSynthPoint,
  center: AirSynthPoint,
  outerMax: number
): boolean {
  const d = Math.hypot(tip.x - center.x, tip.y - center.y);
  return d < INNER_DEAD_ZONE_RADIUS || d > outerMax;
}

type FrameMapResult = {
  zone: AirSynthZoneState | null;
  pointers: AirSynthFingerPointers;
};

function mapResultToFrame(
  result: HandLandmarkerResult,
  mode: AirSynthMode,
  key: MusicalKey
): FrameMapResult {
  const hands = result.landmarks;
  const handedness = result.handedness;

  if (!hands?.length) {
    return { zone: null, pointers: { ...EMPTY_AIR_SYNTH_POINTERS } };
  }

  if (mode === "single-hand") {
    const lm = hands[0];
    if (!lm) {
      return { zone: null, pointers: { ...EMPTY_AIR_SYNTH_POINTERS } };
    }
    const tip = getIndexTipAnchor(lm);
    if (!tip) {
      return { zone: null, pointers: { ...EMPTY_AIR_SYNTH_POINTERS } };
    }
    const pointers: AirSynthFingerPointers = {
      primary: tip,
      left: null,
      right: null,
    };
    if (isOutsidePlayableRing(tip, SINGLE_HAND_CENTER, OUTER_MAX_RADIUS_SINGLE)) {
      return { zone: null, pointers };
    }
    const sector = radialSectorFromHand(
      tip,
      SINGLE_HAND_CENTER,
      DIATONIC_DEGREES.length
    );
    return {
      zone: {
        mode: "single-hand",
        degree: DIATONIC_DEGREES[sector]!,
        degreeSector: sector,
      },
      pointers,
    };
  }

  let leftTip: AirSynthPoint | null = null;
  let rightTip: AirSynthPoint | null = null;

  for (let i = 0; i < hands.length; i++) {
    const lm = hands[i];
    const label = handedness[i]?.[0]?.categoryName ?? "";
    const tip = lm ? getIndexTipAnchor(lm) : null;
    if (label === "Left") {
      leftTip = tip;
    } else if (label === "Right") {
      rightTip = tip;
    }
  }

  if (!leftTip && hands[0]) leftTip = getIndexTipAnchor(hands[0]);
  if (!rightTip && hands[1]) rightTip = getIndexTipAnchor(hands[1]);

  const pointers: AirSynthFingerPointers = {
    primary: null,
    left: leftTip,
    right: rightTip,
  };

  if (!leftTip || !rightTip) {
    return { zone: null, pointers };
  }

  if (
    isOutsidePlayableRing(leftTip, TWO_HAND_ROOT_CENTER, OUTER_MAX_RADIUS_TWO_HAND) ||
    isOutsidePlayableRing(rightTip, TWO_HAND_TYPE_CENTER, OUTER_MAX_RADIUS_TWO_HAND)
  ) {
    return { zone: null, pointers };
  }

  const roots = diatonicRootsInKey(key);
  const rootSector = radialSectorFromHand(
    leftTip,
    TWO_HAND_ROOT_CENTER,
    roots.length
  );
  const typeSector = radialSectorFromHand(
    rightTip,
    TWO_HAND_TYPE_CENTER,
    CHORD_TYPES.length
  );

  return {
    zone: {
      mode: "two-hand",
      root: roots[rootSector]!,
      chordType: CHORD_TYPES[typeSector]! as ChordType,
      rootSector,
      typeSector,
    },
    pointers,
  };
}

export async function createKiteThereminVision(): Promise<KiteThereminVision> {
  const vision = await FilesetResolver.forVisionTasks(WASM_CDN);
  const landmarker = await HandLandmarker.createFromOptions(vision, {
    baseOptions: { modelAssetPath: MODEL_URL, delegate: "GPU" },
    runningMode: "VIDEO",
    numHands: 2,
  });

  let mode: AirSynthMode = "two-hand";
  let key: MusicalKey = "C";
  let videoEl: HTMLVideoElement | null = null;
  let rafId: number | null = null;
  let lastVideoTime = -1;
  let zoneListeners: ZoneChangeCallback[] = [];
  let pointerListeners: PointersChangeCallback[] = [];
  let disposed = false;
  let lastZone: AirSynthZoneState | null = null;
  let lastEmitMs = 0;
  let lastPointersWereEmpty = true;

  const emitZone = (zone: AirSynthZoneState | null): void => {
    const now = performance.now();
    if (zone === null && lastZone === null) return;
    if (
      zone !== null &&
      lastZone !== null &&
      JSON.stringify(zone) === JSON.stringify(lastZone) &&
      now - lastEmitMs < 50
    ) {
      return;
    }
    lastEmitMs = now;
    lastZone = zone;
    for (const cb of zoneListeners) cb(zone);
  };

  const emitPointers = (pointers: AirSynthFingerPointers): void => {
    const empty =
      pointers.primary === null &&
      pointers.left === null &&
      pointers.right === null;
    if (empty && lastPointersWereEmpty) return;
    lastPointersWereEmpty = empty;
    for (const cb of pointerListeners) cb(pointers);
  };

  const processFrame = (): void => {
    if (disposed || !videoEl || videoEl.readyState < 2) {
      rafId = requestAnimationFrame(processFrame);
      return;
    }
    const now = performance.now();
    if (videoEl.currentTime !== lastVideoTime) {
      lastVideoTime = videoEl.currentTime;
      const result: HandLandmarkerResult = landmarker.detectForVideo(videoEl, now);
      const { zone, pointers } = mapResultToFrame(result, mode, key);
      emitZone(zone);
      emitPointers(pointers);
    }
    rafId = requestAnimationFrame(processFrame);
  };

  const start = (el: HTMLVideoElement): void => {
    videoEl = el;
    if (rafId === null) {
      rafId = requestAnimationFrame(processFrame);
    }
  };

  const stop = (): void => {
    if (rafId !== null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
    videoEl = null;
    emitZone(null);
    lastPointersWereEmpty = false;
    emitPointers({ ...EMPTY_AIR_SYNTH_POINTERS });
  };

  const setMode = (next: AirSynthMode): void => {
    mode = next;
  };

  const setKey = (next: MusicalKey): void => {
    key = next;
  };

  const onZoneChange = (cb: ZoneChangeCallback): (() => void) => {
    zoneListeners.push(cb);
    return () => {
      zoneListeners = zoneListeners.filter((l) => l !== cb);
    };
  };

  const onPointersChange = (cb: PointersChangeCallback): (() => void) => {
    pointerListeners.push(cb);
    return () => {
      pointerListeners = pointerListeners.filter((l) => l !== cb);
    };
  };

  const dispose = (): void => {
    disposed = true;
    stop();
    landmarker.close();
    zoneListeners = [];
    pointerListeners = [];
  };

  return { start, stop, setMode, setKey, onZoneChange, onPointersChange, dispose };
}
