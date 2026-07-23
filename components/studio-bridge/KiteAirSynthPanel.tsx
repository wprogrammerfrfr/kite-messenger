"use client";

import { useEffect, useRef, type CSSProperties, type RefObject } from "react";
import {
  chordLabelsInKey,
  degreeInKeyToChordLabel,
  diatonicRootLabelsInKey,
} from "@/lib/theremin/kite-theremin-theory";
import {
  CHORD_TYPES,
  type AirSynthMode,
  type AirSynthZoneState,
  type ChordType,
  type MusicalKey,
} from "@/lib/theremin/kite-theremin-types";
import type { AirSynthFingerPointers } from "@/lib/theremin/kite-theremin-vision";

const EMERALD = "#22c55e";
const ORANGE = "#ff4500";

/** Display-only labels for 2-Dial chord types (engine values stay maj/m/maj7/m7). */
const CHORD_TYPE_DISPLAY: Record<ChordType, string> = {
  maj: "M",
  m: "min",
  maj7: "M7",
  m7: "min7",
};

const ACTIVE_LABEL_FILL = ORANGE;
const ACTIVE_LABEL_FILTER =
  "drop-shadow(0px 0px 6px rgba(255, 69, 0, 0.85)) drop-shadow(0px 0px 12px rgba(255, 69, 0, 0.5))";
const INACTIVE_LABEL_FILL = "#000000";
const LABEL_FONT_FAMILY =
  "ui-rounded, 'Nunito', 'Quicksand', system-ui, sans-serif";

const DIAL_INNER_R = 28;
const DIAL_OUTER_R = 46;

const SECTOR_FILL_IDLE = "rgba(34, 197, 94, 0.15)";
const SECTOR_FILL_ACTIVE = "rgba(34, 197, 94, 0.28)";
const SECTOR_STROKE_IDLE = "rgba(255,255,255,0.22)";
const SECTOR_STROKE_ACTIVE = "rgba(34,197,94,0.55)";

export type KiteAirSynthPanelProps = {
  visible: boolean;
  mode: AirSynthMode;
  musicalKey: MusicalKey;
  activeZone: AirSynthZoneState | null;
  fingerPointersRef: RefObject<AirSynthFingerPointers>;
};

function sectorPath(
  cx: number,
  cy: number,
  innerR: number,
  outerR: number,
  startAngle: number,
  endAngle: number
): string {
  const x1 = cx + outerR * Math.cos(startAngle);
  const y1 = cy + outerR * Math.sin(startAngle);
  const x2 = cx + outerR * Math.cos(endAngle);
  const y2 = cy + outerR * Math.sin(endAngle);
  const x3 = cx + innerR * Math.cos(endAngle);
  const y3 = cy + innerR * Math.sin(endAngle);
  const x4 = cx + innerR * Math.cos(startAngle);
  const y4 = cy + innerR * Math.sin(startAngle);
  const largeArc = endAngle - startAngle > Math.PI ? 1 : 0;
  return `M ${x1} ${y1} A ${outerR} ${outerR} 0 ${largeArc} 1 ${x2} ${y2} L ${x3} ${y3} A ${innerR} ${innerR} 0 ${largeArc} 0 ${x4} ${y4} Z`;
}

function SectorDial({
  labels,
  activeSector,
  centerLabel,
  labelFontSize,
  uppercaseLabels = true,
  style,
}: {
  labels: readonly string[];
  activeSector: number;
  centerLabel?: string | null;
  labelFontSize: number;
  uppercaseLabels?: boolean;
  style?: CSSProperties;
}): React.JSX.Element {
  const cx = 50;
  const cy = 50;
  const sectorCount = labels.length;
  const slice = (Math.PI * 2) / sectorCount;

  return (
    <svg
      viewBox="0 0 100 100"
      preserveAspectRatio="xMidYMid meet"
      style={{ width: "100%", height: "100%", ...style }}
      aria-hidden
    >
      {Array.from({ length: sectorCount }, (_, i) => {
        const start = -Math.PI / 2 + i * slice;
        const end = start + slice;
        const isActive = i === activeSector;
        return (
          <path
            key={i}
            d={sectorPath(cx, cy, DIAL_INNER_R, DIAL_OUTER_R, start, end)}
            fill={isActive ? SECTOR_FILL_ACTIVE : SECTOR_FILL_IDLE}
            stroke={isActive ? SECTOR_STROKE_ACTIVE : SECTOR_STROKE_IDLE}
            strokeWidth={0.4}
            style={{ transition: "fill 0.18s, stroke 0.18s" }}
          />
        );
      })}
      <circle
        cx={cx}
        cy={cy}
        r={DIAL_OUTER_R}
        fill="none"
        stroke="rgba(255,255,255,0.24)"
        strokeWidth={0.5}
      />
      <circle
        cx={cx}
        cy={cy}
        r={DIAL_INNER_R}
        fill="none"
        stroke="rgba(255,255,255,0.18)"
        strokeWidth={0.4}
      />
      {labels.map((label, i) => {
        const mid = -Math.PI / 2 + (i + 0.5) * slice;
        const lx = cx + ((DIAL_INNER_R + DIAL_OUTER_R) / 2) * Math.cos(mid);
        const ly = cy + ((DIAL_INNER_R + DIAL_OUTER_R) / 2) * Math.sin(mid);
        const isActive = i === activeSector;
        return (
          <text
            key={String(label)}
            x={lx}
            y={ly}
            textAnchor="middle"
            dominantBaseline="middle"
            fill={isActive ? ACTIVE_LABEL_FILL : INACTIVE_LABEL_FILL}
            style={{
              fontSize: labelFontSize,
              fontFamily: LABEL_FONT_FAMILY,
              fontWeight: "bold",
              letterSpacing: "0.08em",
              textTransform: uppercaseLabels ? "uppercase" : "none",
              filter: isActive ? ACTIVE_LABEL_FILTER : undefined,
              transition: "fill 0.18s",
            }}
          >
            {label}
          </text>
        );
      })}
      {centerLabel ? (
        <text
          x={cx}
          y={cy}
          textAnchor="middle"
          dominantBaseline="middle"
          fill={ACTIVE_LABEL_FILL}
          style={{
            fontSize: 5.5,
            fontFamily: LABEL_FONT_FAMILY,
            fontWeight: "bold",
            filter: ACTIVE_LABEL_FILTER,
          }}
        >
          {centerLabel}
        </text>
      ) : null}
    </svg>
  );
}

const overlayRoot: CSSProperties = {
  position: "absolute",
  inset: 0,
  pointerEvents: "none",
  zIndex: 1,
};

const twoHandRow: CSSProperties = {
  position: "absolute",
  inset: 0,
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  padding: "0 2%",
  boxSizing: "border-box",
};

const dialColumnEdge: CSSProperties = {
  width: "42%",
  height: "78%",
  maxHeight: "min(72vmin, 520px)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
};

const singleDialContainer: CSSProperties = {
  position: "absolute",
  left: "50%",
  top: "50%",
  width: "78%",
  height: "78%",
  maxWidth: "min(72vmin, 520px)",
  maxHeight: "min(72vmin, 520px)",
  transform: "translate(-50%, calc(-50% - 15%))",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
};

const fingerDotBase: CSSProperties = {
  position: "absolute",
  width: 18,
  height: 18,
  marginLeft: -9,
  marginTop: -9,
  borderRadius: "50%",
  background: EMERALD,
  boxShadow: `0 0 10px 3px rgba(34,197,94,0.65), 0 0 22px 6px rgba(34,197,94,0.35)`,
  border: "2px solid rgba(255,255,255,0.85)",
  opacity: 0,
  left: "0%",
  top: "0%",
  willChange: "left, top, opacity",
  zIndex: 2,
};

function applyDot(
  el: HTMLDivElement | null,
  point: { x: number; y: number } | null
): void {
  if (!el) return;
  if (!point) {
    el.style.opacity = "0";
    return;
  }
  el.style.left = `${point.x * 100}%`;
  el.style.top = `${point.y * 100}%`;
  el.style.opacity = "1";
}

export default function KiteAirSynthPanel({
  visible,
  mode,
  musicalKey,
  activeZone,
  fingerPointersRef,
}: KiteAirSynthPanelProps): React.JSX.Element | null {
  const primaryDotRef = useRef<HTMLDivElement>(null);
  const leftDotRef = useRef<HTMLDivElement>(null);
  const rightDotRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!visible) return;
    let rafId = 0;
    const tick = (): void => {
      const pointers = fingerPointersRef.current;
      if (mode === "single-hand") {
        applyDot(primaryDotRef.current, pointers?.primary ?? null);
        applyDot(leftDotRef.current, null);
        applyDot(rightDotRef.current, null);
      } else {
        applyDot(primaryDotRef.current, null);
        applyDot(leftDotRef.current, pointers?.left ?? null);
        applyDot(rightDotRef.current, pointers?.right ?? null);
      }
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(rafId);
    };
  }, [visible, mode, fingerPointersRef]);

  if (!visible) return null;

  const rootLabels = diatonicRootLabelsInKey(musicalKey);
  const chordLabels = chordLabelsInKey(musicalKey);
  const activeChordLabel =
    activeZone?.mode === "single-hand"
      ? degreeInKeyToChordLabel(musicalKey, activeZone.degree)
      : null;
  const activeRootLabel =
    activeZone?.mode === "two-hand" &&
    activeZone.rootSector >= 0 &&
    activeZone.rootSector < rootLabels.length
      ? rootLabels[activeZone.rootSector]!
      : null;

  return (
    <div style={overlayRoot}>
      {mode === "two-hand" ? (
        <div style={twoHandRow}>
          <div style={dialColumnEdge}>
            <SectorDial
              labels={rootLabels}
              activeSector={
                activeZone?.mode === "two-hand" ? activeZone.rootSector : -1
              }
              centerLabel={
                activeZone?.mode === "two-hand" && activeRootLabel
                  ? `${activeRootLabel} ${CHORD_TYPE_DISPLAY[activeZone.chordType]}`
                  : null
              }
              labelFontSize={5.2}
            />
          </div>
          <div style={dialColumnEdge}>
            <SectorDial
              labels={CHORD_TYPES.map((t) => CHORD_TYPE_DISPLAY[t])}
              activeSector={
                activeZone?.mode === "two-hand" ? activeZone.typeSector : -1
              }
              centerLabel={
                activeZone?.mode === "two-hand"
                  ? CHORD_TYPE_DISPLAY[activeZone.chordType]
                  : null
              }
              labelFontSize={5.5}
              uppercaseLabels={false}
            />
          </div>
        </div>
      ) : (
        <div style={singleDialContainer}>
          <SectorDial
            labels={chordLabels}
            activeSector={
              activeZone?.mode === "single-hand" ? activeZone.degreeSector : -1
            }
            centerLabel={activeChordLabel}
            labelFontSize={5.5}
            uppercaseLabels={false}
          />
        </div>
      )}
      <div ref={primaryDotRef} style={fingerDotBase} aria-hidden />
      <div ref={leftDotRef} style={fingerDotBase} aria-hidden />
      <div ref={rightDotRef} style={fingerDotBase} aria-hidden />
    </div>
  );
}
