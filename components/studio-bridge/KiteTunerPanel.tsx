"use client";

import { motion, AnimatePresence } from "framer-motion";
import { Music2, X } from "lucide-react";
import {
  useKiteTunerEngine,
  KITE_TUNER_INSTRUMENT_PROFILES,
  type KiteTunerInstrumentId,
} from "@/hooks/useKiteTunerEngine";

const EMERALD = "#22c55e";
const ORANGE = "#ff4500";

const glass: React.CSSProperties = {
  background: "rgba(10,10,10,0.75)",
  backdropFilter: "blur(18px)",
  WebkitBackdropFilter: "blur(18px)",
  border: "1px solid rgba(255,255,255,0.08)",
  borderRadius: 18,
};

type KiteTunerPanelProps = {
  isOpen: boolean;
  onClose: () => void;
  audioContext: AudioContext | null;
  inputStream: MediaStream | null;
  instrumentId: KiteTunerInstrumentId;
  onInstrumentChange: (id: KiteTunerInstrumentId) => void;
};

function formatCents(cents: number | null): string {
  if (cents === null || !Number.isFinite(cents)) return "—";
  const rounded = Math.round(cents);
  if (rounded === 0) return "0";
  return rounded > 0 ? `+${rounded}` : `${rounded}`;
}

export default function KiteTunerPanel({
  isOpen,
  onClose,
  audioContext,
  inputStream,
  instrumentId,
  onInstrumentChange,
}: KiteTunerPanelProps): React.JSX.Element | null {
  const { isListening, reading, profiles } = useKiteTunerEngine({
    audioContext,
    inputStream,
    enabled: isOpen,
    instrumentId,
  });

  const profileOptions = Object.values(profiles);
  const noteName = reading.closestTargetNote?.name ?? "—";
  const centsOff = reading.centsOff;
  const needlePct =
    centsOff === null ? 50 : Math.min(100, Math.max(0, 50 + (centsOff / 50) * 50));

  return (
    <AnimatePresence>
      {isOpen ? (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 12 }}
          transition={{ type: "spring", stiffness: 340, damping: 32 }}
          style={{
            position: "absolute",
            left: 24,
            bottom: 112,
            zIndex: 60,
            width: "min(280px, calc(100vw - 48px))",
          }}
        >
          <div className="min-h-[240px]" style={{ ...glass, padding: "14px 16px 16px" }}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: 12,
                paddingBottom: 10,
                borderBottom: "1px solid rgba(255,255,255,0.06)",
              }}
            >
              <span
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 7,
                  color: "rgba(255,255,255,0.75)",
                  fontSize: 11,
                  letterSpacing: "0.18em",
                  textTransform: "uppercase",
                }}
              >
                <Music2 size={12} color={EMERALD} /> Tuner
              </span>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close tuner"
                style={{
                  background: "none",
                  border: "none",
                  color: "rgba(255,255,255,0.3)",
                  cursor: "pointer",
                  fontSize: 20,
                  lineHeight: 1,
                }}
              >
                <X size={16} />
              </button>
            </div>

            <label
              className="font-sans text-[11px] font-medium uppercase tracking-widest text-emerald-500"
              htmlFor="kite-tuner-instrument"
              style={{ display: "block", marginBottom: 6 }}
            >
              Instrument
            </label>
            <select
              id="kite-tuner-instrument"
              value={instrumentId}
              onChange={(e) => onInstrumentChange(e.target.value as KiteTunerInstrumentId)}
              style={{
                width: "100%",
                marginBottom: 14,
                padding: "8px 10px",
                borderRadius: 10,
                border: "1px solid rgba(255,255,255,0.1)",
                background: "rgba(0,0,0,0.35)",
                color: "#f5f5f4",
                fontSize: 12,
                outline: "none",
              }}
            >
              {profileOptions.map((profile) => (
                <option key={profile.id} value={profile.id}>
                  {profile.label}
                </option>
              ))}
            </select>

            <div className="mb-2.5 flex min-h-[108px] flex-col items-center">
              <div className="flex h-20 w-20 items-center justify-center">
                <div
                  className="font-mono text-[42px] font-extrabold leading-none"
                  style={{
                    color: reading.isTuned && isListening ? EMERALD : "#f5f5f4",
                    textShadow:
                      reading.isTuned && isListening ? "0 0 22px rgba(34,197,94,0.7)" : undefined,
                    transition: "color 0.12s ease",
                  }}
                >
                  {isListening ? noteName : "—"}
                </div>
              </div>
              <div className="mt-1.5 flex h-5 items-center justify-center text-[11px] text-stone-400/45">
                {!isListening ? "Play a note" : "\u00A0"}
              </div>
            </div>

            <div
              style={{
                position: "relative",
                height: 8,
                borderRadius: 999,
                background: "rgba(34, 197, 94, 0.1)",
                border: "1px solid rgba(34, 197, 94, 0.22)",
                boxShadow: "inset 0 1px 0 rgba(34, 197, 94, 0.08)",
                marginBottom: 8,
              }}
            >
              <div
                style={{
                  position: "absolute",
                  left: "50%",
                  top: -2,
                  width: 2,
                  height: 12,
                  marginLeft: -1,
                  background: "rgba(255,255,255,0.35)",
                  borderRadius: 1,
                }}
              />
              <div
                style={{
                  position: "absolute",
                  top: -3,
                  left: `${needlePct}%`,
                  width: 10,
                  height: 14,
                  marginLeft: -5,
                  borderRadius: 999,
                  background: reading.isTuned && isListening ? EMERALD : ORANGE,
                  boxShadow: "0 0 8px rgba(0,0,0,0.45)",
                  transition: "left 0.08s linear, background 0.12s ease",
                }}
              />
            </div>

            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                fontSize: 9,
                letterSpacing: "0.12em",
                textTransform: "uppercase",
                color: "rgba(255,255,255,0.28)",
              }}
            >
              <span>Flat</span>
              <span
                className="w-24 text-center tabular-nums font-mono text-[11px] font-semibold"
                style={{
                  color: reading.isTuned && isListening ? EMERALD : "rgba(255,255,255,0.55)",
                }}
              >
                {formatCents(centsOff)} ct
              </span>
              <span>Sharp</span>
            </div>
          </div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
