// Marketing Mockup Presentational View Only

"use client";

import Image from "next/image";
import Link from "next/link";
import { MessageCircle, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { InstallKiteButton } from "@/components/InstallKiteButton";
import { LanguageDropdown } from "@/components/LanguageDropdown";
import { t, type Language } from "@/lib/translations";

export type KiteStudioWelcomeViewProps = {
  language: Language;
  onLanguageChange: (lang: Language) => void;
};

function useTimer(running: boolean): string {
  const [secs, setSecs] = useState(0);
  const ref = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (running) {
      ref.current = setInterval(() => setSecs((s) => s + 1), 1000);
    } else {
      if (ref.current !== null) {
        clearInterval(ref.current);
        ref.current = null;
      }
      setSecs(0);
    }
    return () => {
      if (ref.current !== null) {
        clearInterval(ref.current);
        ref.current = null;
      }
    };
  }, [running]);

  const mm = String(Math.floor(secs / 60)).padStart(2, "0");
  const ss = String(secs % 60).padStart(2, "0");
  return `${mm}:${ss}`;
}

type VUMeterProps = {
  classes: string[];
  color: string;
};

function VUMeter({ classes, color }: VUMeterProps) {
  return (
    <div style={{ display: "flex", alignItems: "flex-end", gap: "2px", width: 28, height: 120 }}>
      {classes.map((cls, i) => (
        <div
          key={i}
          className={`vu-meter-bar ${cls}`}
          style={{
            flex: 1,
            borderRadius: "2px 2px 0 0",
            background: color,
            boxShadow: `0 0 6px ${color}99`,
          }}
        />
      ))}
    </div>
  );
}

type MixerChannelProps = {
  label: string;
  vuClasses: string[];
  vuColor: string;
  defaultVal?: number;
};

function MixerChannel({
  label,
  vuClasses,
  vuColor,
  defaultVal = 75,
}: MixerChannelProps) {
  const [val, setVal] = useState(defaultVal);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 12,
        padding: "20px 18px",
        background: "rgba(255,255,255,0.025)",
        borderRadius: 12,
        border: "1px solid rgba(230,237,243,0.06)",
        minWidth: 100,
      }}
    >
      <span
        style={{
          fontFamily: "'DM Mono', monospace",
          fontSize: 10,
          color: "rgba(230,237,243,0.4)",
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          textAlign: "center",
        }}
      >
        {label}
      </span>

      <div style={{ display: "flex", gap: 10, alignItems: "flex-end", height: 130 }}>
        <input
          type="range"
          className="select-auto caret-auto"
          min={0}
          max={100}
          value={val}
          onChange={(e) => setVal(Number(e.target.value))}
          aria-label={`${label} volume`}
        />
        <VUMeter classes={vuClasses} color={vuColor} />
      </div>

      <span
        style={{
          fontFamily: "'DM Mono', monospace",
          fontSize: 11,
          color: vuColor,
          letterSpacing: "0.06em",
        }}
      >
        {val === 0 ? "-inf" : `-${String(100 - val).padStart(2, "0")}`} dB
      </span>
    </div>
  );
}

type FeatureCard = {
  icon: string;
  color: string;
  label: string;
  labelColor: string;
  desc: string;
};

const FEATURE_CARDS: FeatureCard[] = [
  {
    icon: "&#9889;",
    color: "#FF4500",
    label: "Zero Install",
    labelColor: "var(--amber)",
    desc: "Runs entirely in your browser. No plugins, no downloads, no drivers. Just open a link.",
  },
  {
    icon: "&#127908;",
    color: "#1A9E8F",
    label: "Live Mode - Sub 40ms Latency",
    labelColor: "var(--amber)",
    desc: "Direct peer-to-peer, uncompressed high-fidelity audio for crystal-clear voice, room setup, and standard talk-back.",
  },
  {
    icon: "&#9210;",
    color: "#ef4444",
    label: "Record Sessions",
    labelColor: "var(--amber)",
    desc: "Capture every track in lossless stems. Export stems or a mixed stereo file instantly.",
  },
  {
    icon: "&#9881;",
    color: "#FF4500",
    label: "Kite Sync",
    labelColor: "var(--amber)",
    desc: "Kite Sync turns internet latency into musical timing by syncing everyone one loop ahead.",
  },
];

const SAMMY_NOTE_CONTENT = {
  title: "PLZ USE MY APP! 😭",
  lines: [
    "i made it very securely plz (trust me plz)",
    "its literally MY app so i wont sell your messages to facebook or openAI",
    "if u find a bug u didnt, thats a feature (if its a big bug plz private message me tho) 🥀🥀",
    "u can also use it when u in the mountains and low connection",
  ],
  signoff: "love, your fav (and only) KITE developer Sammy",
} as const;

const LOOPER_TRANSPORT_ICONS = ["\u23EE", "\u23F9", "\u23ED"] as const;

export default function KiteStudioWelcomeView({
  language,
  onLanguageChange,
}: KiteStudioWelcomeViewProps) {
  const [recording, setRecording] = useState(false);
  const [sammyOpen, setSammyOpen] = useState(false);
  const timer = useTimer(recording);
  const sammyPopoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!sammyOpen) return;
    const onPointerDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (sammyPopoverRef.current?.contains(target)) return;
      const fab = document.getElementById("welcome-sammy-fab");
      if (fab?.contains(target)) return;
      setSammyOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [sammyOpen]);

  return (
    <div style={{ position: "relative", zIndex: 1 }}>
      <header
        className="nav-blur"
        style={{
          position: "fixed",
          top: 0,
          left: 0,
          right: 0,
          zIndex: 50,
          borderBottom: "1px solid var(--border)",
          background: "rgba(0,0,0,0.86)",
        }}
      >
        <div
          style={{
            maxWidth: 1200,
            margin: "0 auto",
            padding: "0 28px",
            height: 64,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 11 }}>
            <Image
              src="/kite-mobile-icon.svg"
              width={32}
              height={32}
              alt=""
              aria-hidden
              style={{ flexShrink: 0 }}
            />
            <span
              style={{
                fontFamily: "'Sora', sans-serif",
                fontWeight: 600,
                fontSize: 19,
                letterSpacing: "-0.01em",
              }}
            >
              Kite<span style={{ color: "var(--amber)", fontWeight: 700 }}>Studio</span>
            </span>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
            <LanguageDropdown value={language} onChange={onLanguageChange} />

            <Link
              href="/chat?mode=login"
              style={{
                color: "var(--muted)",
                textDecoration: "none",
                fontSize: 14,
                fontWeight: 500,
                transition: "color 0.2s",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.color = "var(--text)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.color = "var(--muted)";
              }}
            >
              {t(language, "welcomeLogin")}
            </Link>

            <Link
              href="/chat?mode=signup"
              style={{
                position: "relative",
                overflow: "hidden",
                display: "inline-block",
                background: "var(--amber)",
                color: "#fff",
                border: "none",
                borderRadius: 99,
                padding: "9px 22px",
                fontFamily: "'Sora', sans-serif",
                fontWeight: 700,
                fontSize: 14,
                cursor: "pointer",
                letterSpacing: "-0.01em",
                textDecoration: "none",
                boxShadow: "0 0 24px rgba(255,69,0,0.35)",
                transition: "box-shadow 0.2s, transform 0.15s",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.boxShadow = "0 0 40px rgba(255,69,0,0.6)";
                e.currentTarget.style.transform = "scale(1.04)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.boxShadow = "0 0 24px rgba(255,69,0,0.35)";
                e.currentTarget.style.transform = "scale(1)";
              }}
            >
              {t(language, "welcomeLaunchApp")}
            </Link>
          </div>
        </div>
      </header>

      <section
        style={{
          position: "relative",
          paddingTop: 168,
          paddingBottom: 72,
          textAlign: "center",
          overflow: "hidden",
        }}
      >
        <div
          className="teal-glow"
          style={{
            position: "absolute",
            top: "50%",
            left: "50%",
            transform: "translate(-50%, -58%)",
            width: 680,
            height: 480,
            borderRadius: "50%",
            background:
              "radial-gradient(ellipse at center, rgba(26,158,143,0.15) 0%, transparent 68%)",
            pointerEvents: "none",
          }}
        />

        <h1
          style={{
            fontFamily: "'Sora', sans-serif",
            fontWeight: 800,
            fontSize: "clamp(36px, 5.4vw, 72px)",
            lineHeight: 1.1,
            letterSpacing: "-0.035em",
            maxWidth: 1040,
            margin: "0 auto 22px",
            padding: "0 12px",
            textAlign: "center",
            position: "relative",
          }}
        >
          Zero <span style={{ color: "var(--amber)" }}>Install</span>. Zero{" "}
          <span style={{ color: "var(--amber)" }}>Latency</span>, Just{" "}
          <span style={{ color: "var(--amber)" }}>Jam</span>.
          <br />
          <span style={{ color: "var(--amber)" }}>Fly</span> with{" "}
          <span style={{ color: "var(--amber)" }}>Kite</span> Studio!
        </h1>

        <p
          style={{
            fontFamily: "'Sora', sans-serif",
            fontWeight: 400,
            fontSize: "clamp(15px, 1.9vw, 18px)",
            color: "rgba(230,237,243,0.70)",
            maxWidth: 800,
            margin: "0 auto 40px",
            lineHeight: 1.72,
          }}
        >
          The world&apos;s first zero-install platform for real-time collaborative music
          sessions and looping.
        </p>

        <Link
          href="/chat?mode=signup"
          className="btn-shine"
          style={{
            position: "relative",
            overflow: "hidden",
            display: "inline-block",
            background: "var(--amber)",
            color: "#fff",
            border: "none",
            borderRadius: 99,
            padding: "15px 44px",
            fontFamily: "'Sora', sans-serif",
            fontWeight: 700,
            fontSize: 16,
            cursor: "pointer",
            letterSpacing: "-0.01em",
            textDecoration: "none",
            boxShadow: "0 0 48px rgba(255,69,0,0.4)",
            transition: "box-shadow 0.2s, transform 0.15s",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.boxShadow = "0 0 72px rgba(255,69,0,0.65)";
            e.currentTarget.style.transform = "scale(1.03)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.boxShadow = "0 0 48px rgba(255,69,0,0.4)";
            e.currentTarget.style.transform = "scale(1)";
          }}
        >
          Sign Up for Free!
        </Link>
      </section>

      <section
        className="welcome-section-deferred"
        style={{ padding: "0 28px 96px", display: "flex", justifyContent: "center" }}
      >
        <div
          style={{
            width: "100%",
            maxWidth: 920,
            background: "var(--surface)",
            borderRadius: 18,
            border: "1px solid rgba(230,237,243,0.08)",
            boxShadow: "0 40px 120px rgba(0,0,0,0.88), 0 0 0 1px rgba(255,69,0,0.05)",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              background: "rgba(255,255,255,0.02)",
              borderBottom: "1px solid var(--border)",
              padding: "10px 16px",
              display: "flex",
              alignItems: "center",
              gap: 8,
            }}
          >
            <div style={{ width: 12, height: 12, borderRadius: "50%", background: "#FF5F57" }} />
            <div style={{ width: 12, height: 12, borderRadius: "50%", background: "#FEBC2E" }} />
            <div style={{ width: 12, height: 12, borderRadius: "50%", background: "#28C840" }} />
            <span
              style={{
                fontFamily: "'DM Mono', monospace",
                fontSize: 12,
                color: "var(--muted)",
                marginLeft: 12,
              }}
            >
              kite://session/jam-room-4a7f
            </span>
          </div>

          <div
            style={{
              background: "#000",
              borderBottom: "1px solid var(--border)",
              padding: "12px 24px",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
              <div>
                <span
                  style={{
                    fontFamily: "'DM Mono', monospace",
                    fontSize: 10,
                    color: "var(--muted)",
                    letterSpacing: "0.08em",
                    display: "block",
                  }}
                >
                  SESSION
                </span>
                <span
                  style={{
                    fontFamily: "'DM Mono', monospace",
                    fontSize: 13,
                    color: "var(--text)",
                    letterSpacing: "0.04em",
                  }}
                >
                  JAM-4A7F
                </span>
              </div>
              <div style={{ width: 1, height: 32, background: "var(--border)" }} />
              <div>
                <span
                  style={{
                    fontFamily: "'DM Mono', monospace",
                    fontSize: 10,
                    color: "var(--muted)",
                    letterSpacing: "0.08em",
                    display: "block",
                  }}
                >
                  BPM
                </span>
                <span
                  style={{
                    fontFamily: "'DM Mono', monospace",
                    fontSize: 13,
                    color: "var(--amber)",
                    letterSpacing: "0.04em",
                  }}
                >
                  120
                </span>
              </div>
            </div>

            <div style={{ textAlign: "center" }}>
              <span
                className="latency-blink"
                style={{
                  fontFamily: "'DM Mono', monospace",
                  fontSize: 28,
                  fontWeight: 500,
                  color: "var(--amber)",
                  display: "block",
                  lineHeight: 1,
                  letterSpacing: "-0.01em",
                  textShadow: "0 0 24px rgba(255,69,0,0.55)",
                }}
              >
                KITE SYNC
              </span>
              <span
                style={{
                  fontFamily: "'DM Mono', monospace",
                  fontSize: 10,
                  color: "var(--muted)",
                  letterSpacing: "0.08em",
                }}
              >
                4-BAR · LOCKED TO GRID
              </span>
            </div>

            <div
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "flex-end",
                gap: 8,
              }}
            >
              <div
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 7,
                  background: "rgba(26,158,143,0.1)",
                  border: "1px solid rgba(26,158,143,0.28)",
                  borderRadius: 99,
                  padding: "5px 14px",
                }}
              >
                <span
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: "50%",
                    background: "var(--teal)",
                    boxShadow: "0 0 10px var(--teal)",
                    display: "inline-block",
                  }}
                />
                <span
                  style={{
                    fontFamily: "'DM Mono', monospace",
                    fontSize: 11,
                    color: "var(--teal)",
                    letterSpacing: "0.08em",
                    fontWeight: 500,
                  }}
                >
                  LIVE MODE · P2P
                </span>
              </div>
              <div
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 7,
                  background: "rgba(255,69,0,0.08)",
                  border: "1px solid rgba(255,69,0,0.2)",
                  borderRadius: 99,
                  padding: "5px 14px",
                }}
              >
                <span
                  style={{
                    fontFamily: "'DM Mono', monospace",
                    fontSize: 11,
                    color: "var(--amber)",
                    letterSpacing: "0.08em",
                  }}
                >
                  &#128274; E2EE ON
                </span>
              </div>
            </div>
          </div>

          <div style={{ padding: "28px 24px", display: "flex", gap: 20, flexWrap: "wrap" }}>
            <div style={{ flex: "1 1 340px" }}>
              <div
                style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 20 }}
              >
                <span
                  style={{
                    fontFamily: "'DM Mono', monospace",
                    fontSize: 10,
                    color: "var(--muted)",
                    letterSpacing: "0.1em",
                    textTransform: "uppercase",
                  }}
                >
                  Mixer
                </span>
                <div style={{ flex: 1, height: 1, background: "var(--border)" }} />
                <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 10, color: "var(--teal)" }}>
                  3 CH
                </span>
              </div>
              <div style={{ display: "flex", gap: 12, justifyContent: "center" }}>
                <MixerChannel
                  label="Local Mic"
                  vuClasses={["vu-bar-1", "vu-bar-2", "vu-bar-3", "vu-bar-4", "vu-bar-5"]}
                  vuColor="#FF4500"
                  defaultVal={82}
                />
                <MixerChannel
                  label="Remote Peer"
                  vuClasses={[
                    "vu-bar-3-1",
                    "vu-bar-3-2",
                    "vu-bar-3-3",
                    "vu-bar-3-4",
                    "vu-bar-3-5",
                  ]}
                  vuColor="#1A9E8F"
                  defaultVal={68}
                />
                <MixerChannel
                  label="Metronome"
                  vuClasses={[
                    "vu-metro-1",
                    "vu-metro-2",
                    "vu-metro-3",
                    "vu-metro-4",
                    "vu-metro-5",
                  ]}
                  vuColor="rgba(230,237,243,0.45)"
                  defaultVal={40}
                />
              </div>
            </div>

            <div
              style={{ width: 1, background: "var(--border)", flexShrink: 0, alignSelf: "stretch" }}
            />

            <div style={{ flex: "1 1 260px" }}>
              <div
                style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 20 }}
              >
                <span
                  style={{
                    fontFamily: "'DM Mono', monospace",
                    fontSize: 10,
                    color: "var(--muted)",
                    letterSpacing: "0.1em",
                    textTransform: "uppercase",
                  }}
                >
                  Looper
                </span>
                <div style={{ flex: 1, height: 1, background: "var(--border)" }} />
              </div>

              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  gap: 22,
                  padding: "10px 0",
                }}
              >
                <button
                  type="button"
                  onClick={() => setRecording((r) => !r)}
                  className={recording ? "rec-pulse" : ""}
                  style={{
                    width: 80,
                    height: 80,
                    borderRadius: "50%",
                    background: recording
                      ? "radial-gradient(circle, #ff6b6b, #ef4444)"
                      : "radial-gradient(circle, rgba(239,68,68,0.14), rgba(239,68,68,0.04))",
                    border: recording
                      ? "2px solid rgba(239,68,68,0.9)"
                      : "2px solid rgba(239,68,68,0.3)",
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    transition: "background 0.2s, border-color 0.2s",
                  }}
                >
                  <div
                    style={{
                      width: 30,
                      height: 30,
                      borderRadius: recording ? "4px" : "50%",
                      background: recording ? "#fff" : "rgba(239,68,68,0.8)",
                      transition: "border-radius 0.25s, background 0.2s",
                    }}
                  />
                </button>

                <div style={{ textAlign: "center" }}>
                  <span
                    style={{
                      fontFamily: "'DM Mono', monospace",
                      fontSize: 13,
                      color: recording ? "#ef4444" : "var(--muted)",
                      letterSpacing: "0.08em",
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                      transition: "color 0.2s",
                    }}
                  >
                    {recording ? (
                      <>
                        <span
                          style={{
                            width: 8,
                            height: 8,
                            borderRadius: "50%",
                            background: "#ef4444",
                            boxShadow: "0 0 8px #ef4444",
                            display: "inline-block",
                          }}
                        />
                        REC {timer}
                        <span className="timer-cursor">_</span>
                      </>
                    ) : (
                      "● READY"
                    )}
                  </span>
                </div>

                <div style={{ display: "flex", gap: 8 }}>
                  {LOOPER_TRANSPORT_ICONS.map((icon) => (
                    <button
                      key={icon}
                      type="button"
                      style={{
                        width: 40,
                        height: 40,
                        borderRadius: 10,
                        background: "rgba(255,255,255,0.03)",
                        border: "1px solid var(--border)",
                        color: "var(--muted)",
                        fontSize: 16,
                        cursor: "pointer",
                        transition: "background 0.15s, color 0.15s",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.background = "rgba(255,255,255,0.07)";
                        e.currentTarget.style.color = "var(--text)";
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.background = "rgba(255,255,255,0.03)";
                        e.currentTarget.style.color = "var(--muted)";
                      }}
                    >
                      {icon}
                    </button>
                  ))}
                </div>

                <div style={{ display: "flex", gap: 6 }}>
                  {["2 BAR", "4 BAR", "8 BAR"].map((bar, i) => (
                    <button
                      key={bar}
                      type="button"
                      style={{
                        background: i === 1 ? "rgba(255,69,0,0.12)" : "none",
                        border:
                          i === 1
                            ? "1px solid rgba(255,69,0,0.35)"
                            : "1px solid var(--border)",
                        borderRadius: 6,
                        color: i === 1 ? "var(--amber)" : "var(--muted)",
                        fontFamily: "'DM Mono', monospace",
                        fontSize: 10,
                        letterSpacing: "0.06em",
                        padding: "5px 10px",
                        cursor: "pointer",
                        transition: "all 0.15s",
                      }}
                    >
                      {bar}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>

          <div
            style={{
              background: "#000",
              borderTop: "1px solid var(--border)",
              padding: "10px 24px",
              display: "flex",
              alignItems: "center",
              gap: 20,
            }}
          >
            <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 10, color: "var(--muted)" }}>
              &#9711; 2 PEERS ONLINE
            </span>
            <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 10, color: "var(--teal)" }}>
              &#8593; 48kHz / 16-bit
            </span>
            <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 10, color: "var(--muted)" }}>
              OPUS CODEC
            </span>
            <div style={{ flex: 1 }} />
            <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 10, color: "var(--muted)" }}>
              CPU 12% · PHASE 5 BUFFER
            </span>
          </div>
        </div>
      </section>

      <section className="welcome-section-deferred" style={{ padding: "0 28px 96px" }}>
        <div style={{ maxWidth: 1100, margin: "0 auto" }}>
          <div style={{ textAlign: "center", marginBottom: 48 }}>
            <span
              style={{
                fontFamily: "'DM Mono', monospace",
                fontSize: 12,
                color: "var(--teal)",
                letterSpacing: "0.12em",
              }}
            >
              WHY KITE STUDIO
            </span>
            <h2
              style={{
                fontFamily: "'Sora', sans-serif",
                fontWeight: 700,
                fontSize: "clamp(26px, 3.2vw, 40px)",
                letterSpacing: "-0.03em",
                marginTop: 12,
              }}
            >
              Built for musicians,
              <br />
              by a musician.
            </h2>
          </div>
          <div className="feature-grid">
            {FEATURE_CARDS.map((card) => (
              <div
                key={card.label}
                className="feature-card"
                style={{
                  background: "var(--surface)",
                  border: "1px solid var(--border)",
                  borderRadius: 14,
                  padding: "26px 22px",
                }}
              >
                <div
                  style={{
                    width: 46,
                    height: 46,
                    borderRadius: 11,
                    background: `${card.color}14`,
                    border: `1px solid ${card.color}28`,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 22,
                    marginBottom: 18,
                  }}
                  dangerouslySetInnerHTML={{ __html: card.icon }}
                />
                <h3
                  style={{
                    fontFamily: "'Sora', sans-serif",
                    fontWeight: 700,
                    fontSize: 19,
                    letterSpacing: "-0.02em",
                    marginBottom: 9,
                    color: card.labelColor,
                  }}
                >
                  {card.label}
                </h3>
                <p
                  style={{
                    fontFamily: "'Sora', sans-serif",
                    fontSize: 13,
                    color: "var(--muted)",
                    lineHeight: 1.65,
                    marginBottom: 0,
                  }}
                >
                  {card.desc}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="welcome-section-deferred" style={{ padding: "0 28px 96px" }}>
        <div
          style={{
            maxWidth: 900,
            margin: "0 auto",
            background: "var(--surface)",
            border: "1px solid var(--border)",
            borderRadius: 18,
            padding: "48px 40px",
          }}
        >
          <div style={{ textAlign: "center", marginBottom: 48 }}>
            <span
              style={{
                fontFamily: "'DM Mono', monospace",
                fontSize: 12,
                color: "var(--teal)",
                letterSpacing: "0.12em",
              }}
            >
              IN THREE STEPS
            </span>
            <h2
              style={{
                fontFamily: "'Sora', sans-serif",
                fontWeight: 700,
                fontSize: "clamp(22px, 2.8vw, 34px)",
                letterSpacing: "-0.03em",
                marginTop: 12,
              }}
            >
              From zero to jamming in 30 seconds.
            </h2>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 32 }}>
            {[
              {
                n: "01",
                title: "Open a Room",
                body: "Hit Create Session — a private, encrypted room spins up instantly. No account needed for guests.",
              },
              {
                n: "02",
                title: "Share the Link",
                body: "Send the link to your bandmate. They click it in any browser. No install prompts. Ever.",
              },
              {
                n: "03",
                title: "Start Playing",
                body: "Live Mode opens for talk-back and room setup. Flip to Kite Sync to lock the band to the grid, then hit Record.",
              },
            ].map((step) => (
              <div key={step.n} style={{ textAlign: "center" }}>
                <div
                  style={{
                    fontFamily: "'DM Mono', monospace",
                    fontSize: 52,
                    fontWeight: 500,
                    color: "rgba(255,69,0,0.40)",
                    lineHeight: 1,
                    marginBottom: 14,
                    letterSpacing: "-0.03em",
                    textShadow: "0 0 18px rgba(255,69,0,0.18)",
                  }}
                >
                  {step.n}
                </div>
                <h3
                  style={{
                    fontFamily: "'Sora', sans-serif",
                    fontWeight: 700,
                    fontSize: 17,
                    marginBottom: 9,
                    letterSpacing: "-0.02em",
                  }}
                >
                  {step.title}
                </h3>
                <p
                  style={{
                    fontFamily: "'Sora', sans-serif",
                    fontSize: 13,
                    color: "var(--muted)",
                    lineHeight: 1.68,
                  }}
                >
                  {step.body}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section
        id="kite-chat"
        className="welcome-section-deferred"
        style={{ padding: "0 28px 80px" }}
      >
        <div
          style={{
            maxWidth: 900,
            margin: "0 auto",
            background: "var(--surface2)",
            border: "1px solid rgba(26,158,143,0.16)",
            borderRadius: 18,
            overflow: "hidden",
            boxShadow: "0 0 72px rgba(26,158,143,0.06)",
          }}
        >
          <div
            style={{
              background: "rgba(26,158,143,0.06)",
              borderBottom: "1px solid rgba(26,158,143,0.13)",
              padding: "14px 28px",
              display: "flex",
              alignItems: "center",
              gap: 10,
            }}
          >
            <span style={{ fontSize: 15 }}>&#128274;</span>
            <span
              className="lock-shimmer"
              style={{
                fontFamily: "'DM Mono', monospace",
                fontWeight: 500,
                fontSize: 12,
                letterSpacing: "0.09em",
              }}
            >
              Legacy Node: Kite Chat Secure Compartment
            </span>
            <div style={{ flex: 1 }} />
            <div
              style={{
                background: "rgba(26,158,143,0.1)",
                border: "1px solid rgba(26,158,143,0.22)",
                borderRadius: 6,
                padding: "3px 10px",
              }}
            >
              <span
                style={{
                  fontFamily: "'DM Mono', monospace",
                  fontSize: 10,
                  color: "var(--teal)",
                  letterSpacing: "0.08em",
                }}
              >
                AES-256-GCM
              </span>
            </div>
          </div>

          <div
            style={{
              padding: "36px 40px 44px",
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: 48,
              alignItems: "center",
            }}
          >
            <div>
              <h2
                style={{
                  fontFamily: "'Sora', sans-serif",
                  fontWeight: 700,
                  fontSize: "clamp(20px, 2.4vw, 28px)",
                  letterSpacing: "-0.03em",
                  marginBottom: 28,
                  lineHeight: 1.28,
                }}
              >
                E2EE Messaging.{" "}
                <span style={{ color: "var(--teal)" }}>Off the record.</span>
              </h2>

              <ul style={{ listStyle: "none", display: "flex", flexDirection: "column", gap: 18 }}>
                {[
                  {
                    label: "Zero-Knowledge Relay",
                    sub: "No server-side message logs. Ever.",
                  },
                  {
                    label: "Tor Network Optimization",
                    sub: "Operates over restricted, surveilled, high-jitter routes.",
                  },
                  {
                    label: "72-Hour Ephemeral Threads",
                    sub: "Self-destructing sessions. No persistence by design.",
                  },
                ].map((item) => (
                  <li
                    key={item.label}
                    style={{ display: "flex", gap: 12, alignItems: "flex-start" }}
                  >
                    <span
                      style={{
                        color: "var(--teal)",
                        flexShrink: 0,
                        marginTop: 3,
                        fontSize: 11,
                        fontFamily: "'DM Mono', monospace",
                      }}
                    >
                      &#9670;
                    </span>
                    <div>
                      <span
                        style={{
                          fontFamily: "'DM Mono', monospace",
                          fontSize: 12,
                          color: "var(--text)",
                          letterSpacing: "0.03em",
                          display: "block",
                          marginBottom: 3,
                        }}
                      >
                        {item.label}
                      </span>
                      <span
                        style={{
                          fontFamily: "'Sora', sans-serif",
                          fontSize: 12,
                          color: "var(--muted)",
                          lineHeight: 1.55,
                        }}
                      >
                        {item.sub}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            </div>

            <div
              style={{
                background: "rgba(255,255,255,0.02)",
                border: "1px solid var(--border)",
                borderRadius: 14,
                padding: "32px 28px",
                textAlign: "center",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 20,
              }}
            >
              <div
                style={{
                  width: 64,
                  height: 64,
                  borderRadius: 16,
                  background:
                    "radial-gradient(circle at 40% 40%, rgba(26,158,143,0.18), rgba(26,158,143,0.03))",
                  border: "1px solid rgba(26,158,143,0.22)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 28,
                }}
              >
                &#128737;
              </div>

              <div>
                <h3
                  style={{
                    fontFamily: "'Sora', sans-serif",
                    fontWeight: 700,
                    fontSize: 18,
                    marginBottom: 7,
                    letterSpacing: "-0.02em",
                  }}
                >
                  Offline Access Mode
                </h3>
                <p
                  style={{
                    fontFamily: "'Sora', sans-serif",
                    fontSize: 12,
                    color: "var(--muted)",
                    lineHeight: 1.6,
                  }}
                >
                  Native app. Air-gapped network support via local mesh relay.
                </p>
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: 9, width: "100%" }}>
                <InstallKiteButton language={language} variant="prominent" />
                <button
                  type="button"
                  style={{
                    background: "none",
                    color: "var(--muted)",
                    border: "1px solid var(--border)",
                    borderRadius: 9,
                    padding: "11px 18px",
                    fontFamily: "'Sora', sans-serif",
                    fontWeight: 500,
                    fontSize: 12,
                    cursor: "pointer",
                    transition: "border-color 0.2s, color 0.2s",
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.borderColor = "rgba(230,237,243,0.22)";
                    e.currentTarget.style.color = "var(--text)";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.borderColor = "var(--border)";
                    e.currentTarget.style.color = "var(--muted)";
                  }}
                >
                  Security Model &#8594;
                </button>
              </div>

              <p
                style={{
                  fontFamily: "'DM Mono', monospace",
                  fontSize: 9,
                  color: "rgba(230,237,243,0.25)",
                  letterSpacing: "0.07em",
                }}
              >
                OPEN SOURCE · AUDITED Q1 2025
              </p>
            </div>
          </div>
        </div>
      </section>

      <section style={{ padding: "60px 28px 80px", textAlign: "center" }}>
        <h2
          style={{
            fontFamily: "'Sora', sans-serif",
            fontWeight: 800,
            fontSize: "clamp(28px, 4vw, 50px)",
            letterSpacing: "-0.04em",
            marginBottom: 18,
          }}
        >
          Ready to play?
        </h2>
        <p
          style={{
            fontFamily: "'Sora', sans-serif",
            fontSize: 16,
            color: "rgba(230,237,243,0.70)",
            maxWidth: 440,
            margin: "0 auto 36px",
            lineHeight: 1.7,
          }}
        >
          Create your free session in seconds. No credit card. No install. Just music.
        </p>
        <Link
          href="/chat?mode=signup"
          style={{
            position: "relative",
            overflow: "hidden",
            display: "inline-block",
            background: "var(--amber)",
            color: "#fff",
            border: "none",
            borderRadius: 99,
            padding: "16px 50px",
            fontFamily: "'Sora', sans-serif",
            fontWeight: 800,
            fontSize: 17,
            cursor: "pointer",
            letterSpacing: "-0.02em",
            textDecoration: "none",
            boxShadow: "0 0 60px rgba(255,69,0,0.42)",
            transition: "box-shadow 0.2s, transform 0.15s",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.boxShadow = "0 0 90px rgba(255,69,0,0.68)";
            e.currentTarget.style.transform = "scale(1.04)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.boxShadow = "0 0 60px rgba(255,69,0,0.42)";
            e.currentTarget.style.transform = "scale(1)";
          }}
        >
          Start Jamming Free &#8594;
        </Link>
      </section>

      <div className="welcome-sammy-fab-root">
        {sammyOpen ? (
          <div
            ref={sammyPopoverRef}
            className="welcome-sammy-popover"
            role="dialog"
            aria-modal="true"
            aria-labelledby="sammy-note-title"
          >
            <button
              type="button"
              className="welcome-sammy-popover-close"
              onClick={() => setSammyOpen(false)}
              aria-label="Close note"
            >
              <X size={18} aria-hidden />
            </button>
            <p id="sammy-note-title" className="welcome-sammy-popover-title">
              {SAMMY_NOTE_CONTENT.title}
            </p>
            <ol className="welcome-sammy-popover-list">
              {SAMMY_NOTE_CONTENT.lines.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ol>
            <p className="welcome-sammy-popover-signoff">{SAMMY_NOTE_CONTENT.signoff}</p>
          </div>
        ) : null}
        <button
          id="welcome-sammy-fab"
          type="button"
          className="welcome-sammy-fab"
          onClick={() => setSammyOpen((open) => !open)}
          aria-expanded={sammyOpen}
          aria-label={sammyOpen ? "Close Sammy's note" : "Open Sammy's note"}
        >
          {sammyOpen ? (
            <X size={26} strokeWidth={2.25} aria-hidden />
          ) : (
            <MessageCircle size={26} strokeWidth={2.25} aria-hidden />
          )}
        </button>
      </div>

      <footer
        className="welcome-section-deferred"
        style={{
          borderTop: "1px solid var(--border)",
          padding: "26px 40px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: 14,
        }}
      >
        <span
          style={{
            fontFamily: "'Sora', sans-serif",
            fontWeight: 700,
            fontSize: 15,
            letterSpacing: "-0.02em",
          }}
        >
          Kite<span style={{ color: "var(--amber)" }}>Studio</span>
        </span>
        <div style={{ display: "flex", gap: 22, flexWrap: "wrap" }}>
          {["Privacy", "Terms", "Security", "GitHub", "Status", "Blog"].map((l) => (
            <a
              key={l}
              href="#"
              style={{
                fontFamily: "'Sora', sans-serif",
                fontSize: 13,
                color: "var(--muted)",
                textDecoration: "none",
                transition: "color 0.15s",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.color = "var(--text)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.color = "var(--muted)";
              }}
            >
              {l}
            </a>
          ))}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
          <span
            style={{
              fontFamily: "'DM Mono', monospace",
              fontSize: 11,
              color: "rgba(230,237,243,0.25)",
            }}
          >
            &copy; 2025 Kite Studio
          </span>
          <a
            href="https://instagram.com/sammjeoo"
            target="_blank"
            rel="noopener noreferrer"
            className="font-sans text-[13px] text-[#FF4500] no-underline hover:opacity-90 transition-colors"
          >
            Developed with 🧉 by Sammy — @sammjeoo on Instagram
          </a>
        </div>
      </footer>
    </div>
  );
}
