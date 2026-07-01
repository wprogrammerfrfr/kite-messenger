"use client";

import Link from "next/link";
import { BrandMark, KiteStudioLandingFooter } from "@/components/kite-studio/KiteStudioLandingFooter";
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  Music2,
  Users,
  Radio,
  Lock,
  Mic,
  Gauge,
  Video,
  Settings,
  Pause,
  Circle,
  ArrowRight,
  Check,
  Menu,
  X,
  Waves,
  Share2,
  type LucideIcon,
} from "lucide-react";

const ORANGE = "#FF4500";
const ORANGE_SOFT = "#FF7A45";
const TEAL = "#1A9E8F";
const TEAL_SOFT = "#2FCBB8";
const INK = "#050506";
const PAPER = "#F5F1E8";
const MUTE = "#9A9AA2";

const displayFont = "'Sora', system-ui, sans-serif";
const monoFont = "'DM Mono', 'IBM Plex Mono', monospace";

const SIGNIN_LOGIN = "/signin?mode=login&next=%2Fstudio";
const SIGNIN_SIGNUP = "/signin?mode=signup&next=%2Fstudio";

const gradientTextStyle = {
  background: `linear-gradient(95deg, ${ORANGE}, ${TEAL})`,
  WebkitBackgroundClip: "text",
  WebkitTextFillColor: "transparent",
  backgroundClip: "text",
} as const;

function useReveal(threshold = 0.15) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true);
          obs.unobserve(el);
        }
      },
      { threshold }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [threshold]);
  return [ref, visible] as const;
}

function Reveal({
  children,
  delay = 0,
  className = "",
}: {
  children: ReactNode;
  delay?: number;
  className?: string;
}) {
  const [ref, visible] = useReveal();
  return (
    <div
      ref={ref}
      className={className}
      style={{
        opacity: visible ? 1 : 0,
        transform: visible ? "translateY(0px)" : "translateY(28px)",
        transition: `opacity 0.8s cubic-bezier(.2,.7,.2,1) ${delay}ms, transform 0.8s cubic-bezier(.2,.7,.2,1) ${delay}ms`,
      }}
    >
      {children}
    </div>
  );
}

function SignalCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      return;
    }

    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    let w = 0;
    let h = 0;
    let dpr = 1;

    const resize = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = canvas.clientWidth;
      h = canvas.clientHeight;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener("resize", resize);

    let t = 0;
    const draw = () => {
      t += 0.016;
      ctx.clearRect(0, 0, w, h);

      const midY = h / 2;
      const nodeL = { x: w * 0.12, y: midY };
      const nodeR = { x: w * 0.88, y: midY };

      ctx.beginPath();
      const segments = 140;
      for (let i = 0; i <= segments; i++) {
        const p = i / segments;
        const x = nodeL.x + (nodeR.x - nodeL.x) * p;
        const envelope = Math.sin(p * Math.PI);
        const y =
          midY +
          Math.sin(p * 26 + t * 2.4) * 10 * envelope +
          Math.sin(p * 7 - t * 1.1) * 16 * envelope;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      const grad = ctx.createLinearGradient(nodeL.x, 0, nodeR.x, 0);
      grad.addColorStop(0, ORANGE);
      grad.addColorStop(1, TEAL);
      ctx.strokeStyle = grad;
      ctx.lineWidth = 1.6;
      ctx.globalAlpha = 0.55;
      ctx.stroke();
      ctx.globalAlpha = 1;

      const pulseP = (Math.sin(t * 0.9) + 1) / 2;
      const px = nodeL.x + (nodeR.x - nodeL.x) * pulseP;
      const py =
        midY +
        Math.sin(pulseP * 26 + t * 2.4) * 10 * Math.sin(pulseP * Math.PI) +
        Math.sin(pulseP * 7 - t * 1.1) * 16 * Math.sin(pulseP * Math.PI);
      ctx.beginPath();
      ctx.arc(px, py, 3.2, 0, Math.PI * 2);
      ctx.fillStyle = pulseP < 0.5 ? ORANGE_SOFT : TEAL_SOFT;
      ctx.shadowColor = pulseP < 0.5 ? ORANGE : TEAL;
      ctx.shadowBlur = 14;
      ctx.fill();
      ctx.shadowBlur = 0;

      [
        { pos: nodeL, color: ORANGE },
        { pos: nodeR, color: TEAL },
      ].forEach(({ pos, color }) => {
        const pulse = 4 + Math.sin(t * 2.6) * 1.4;
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, 14 + pulse, 0, Math.PI * 2);
        ctx.strokeStyle = color;
        ctx.globalAlpha = 0.22;
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.globalAlpha = 1;

        ctx.beginPath();
        ctx.arc(pos.x, pos.y, 5, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.fill();
      });

      rafRef.current = requestAnimationFrame(draw);
    };
    rafRef.current = requestAnimationFrame(draw);

    return () => {
      window.removeEventListener("resize", resize);
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      style={{ width: "100%", height: "100%", display: "block" }}
      aria-hidden
    />
  );
}

function Pill({ children, color = TEAL, dot = true }: { children: ReactNode; color?: string; dot?: boolean }) {
  return (
    <span
      className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs tracking-wide"
      style={{
        fontFamily: monoFont,
        color,
        background: `${color}14`,
        border: `1px solid ${color}33`,
      }}
    >
      {dot && (
        <span
          className="w-1.5 h-1.5 rounded-full"
          style={{ background: color, boxShadow: `0 0 8px ${color}` }}
        />
      )}
      {children}
    </span>
  );
}

function CornerDots() {
  const dotStyle: React.CSSProperties = {
    position: "absolute",
    width: 6,
    height: 6,
    borderRadius: "50%",
    background: "rgba(255,255,255,0.14)",
  };
  return (
    <>
      <span style={{ ...dotStyle, top: 10, left: 10 }} />
      <span style={{ ...dotStyle, top: 10, right: 10 }} />
      <span style={{ ...dotStyle, bottom: 10, left: 10 }} />
      <span style={{ ...dotStyle, bottom: 10, right: 10 }} />
    </>
  );
}

function GradientButton({
  children,
  icon: Icon,
  href,
  onClick,
  type = "button",
  full = false,
}: {
  children: ReactNode;
  icon?: LucideIcon;
  href?: string;
  onClick?: () => void;
  type?: "button" | "submit";
  full?: boolean;
}) {
  const className = `group relative inline-flex items-center justify-center gap-2 px-6 py-3 rounded-xl font-semibold text-sm ${
    full ? "w-full" : ""
  }`;
  const style: React.CSSProperties = {
    fontFamily: displayFont,
    color: INK,
    background: `linear-gradient(100deg, ${ORANGE} 0%, ${ORANGE_SOFT} 45%, ${TEAL} 100%)`,
    boxShadow: `0 8px 30px -8px ${ORANGE}88`,
    transition: "transform 0.25s ease, box-shadow 0.25s ease",
    textDecoration: "none",
  };

  const inner = (
    <>
      {children}
      {Icon && (
        <Icon size={16} className="transition-transform duration-300 group-hover:translate-x-1" />
      )}
    </>
  );

  if (href) {
    return (
      <Link href={href} className={className} style={style}>
        {inner}
      </Link>
    );
  }

  return (
    <button type={type} onClick={onClick} className={className} style={style}>
      {inner}
    </button>
  );
}

function GhostButton({
  children,
  icon: Icon,
  href,
  onClick,
  color = TEAL,
}: {
  children: ReactNode;
  icon?: LucideIcon;
  href?: string;
  onClick?: () => void;
  color?: string;
}) {
  const className =
    "inline-flex items-center justify-center gap-2 px-6 py-3 rounded-xl font-semibold text-sm";
  const style: React.CSSProperties = {
    fontFamily: displayFont,
    color: PAPER,
    border: "1px solid rgba(255,255,255,0.14)",
    background: "rgba(255,255,255,0.02)",
    transition: "border-color 0.25s ease, background 0.25s ease",
    textDecoration: "none",
  };

  const inner = (
    <>
      {Icon && <Icon size={16} />}
      {children}
    </>
  );

  if (href) {
    return (
      <Link href={href} className={className} style={style}>
        {inner}
      </Link>
    );
  }

  return (
    <button type="button" onClick={onClick} className={className} style={style}>
      {inner}
    </button>
  );
}

function Nav() {
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    window.addEventListener("scroll", onScroll);
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const links = [
    { label: "Studio", href: "#pillars" },
    { label: "Looper", href: "#looper" },
    { label: "Modes", href: "#modes" },
    { label: "Privacy", href: "#privacy" },
  ];

  return (
    <div
      className="fixed top-0 left-0 right-0 z-50 transition-all duration-300"
      style={{
        background: scrolled ? "rgba(5,5,6,0.82)" : "transparent",
        backdropFilter: scrolled ? "blur(14px)" : "none",
        borderBottom: scrolled ? "1px solid rgba(255,255,255,0.08)" : "1px solid transparent",
      }}
    >
      <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
        <BrandMark />

        <div className="hidden md:flex items-center gap-8">
          {links.map((l) => (
            <a
              key={l.label}
              href={l.href}
              className="text-sm transition-colors"
              style={{ fontFamily: displayFont, color: MUTE }}
              onMouseEnter={(e) => {
                e.currentTarget.style.color = PAPER;
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.color = MUTE;
              }}
            >
              {l.label}
            </a>
          ))}
        </div>

        <div className="hidden md:flex items-center gap-3">
          <Link
            href={SIGNIN_LOGIN}
            className="text-sm px-4 py-2"
            style={{ fontFamily: displayFont, color: PAPER, textDecoration: "none" }}
          >
            Log in
          </Link>
          <GradientButton icon={ArrowRight} href={SIGNIN_SIGNUP}>
            Start Jamming
          </GradientButton>
        </div>

        <button type="button" className="md:hidden" aria-label={open ? "Close menu" : "Open menu"} onClick={() => setOpen((o) => !o)}>
          {open ? <X size={22} color={PAPER} /> : <Menu size={22} color={PAPER} />}
        </button>
      </div>

      {open && (
        <div className="md:hidden px-6 pb-6 flex flex-col gap-4" style={{ background: "rgba(5,5,6,0.96)" }}>
          {links.map((l) => (
            <a
              key={l.label}
              href={l.href}
              onClick={() => setOpen(false)}
              style={{ fontFamily: displayFont, color: PAPER }}
            >
              {l.label}
            </a>
          ))}
          <div className="flex flex-col gap-3 pt-2">
            <GhostButton href={SIGNIN_LOGIN}>Log in</GhostButton>
            <GradientButton icon={ArrowRight} href={SIGNIN_SIGNUP} full>
              Start Jamming
            </GradientButton>
          </div>
        </div>
      )}
    </div>
  );
}

function Hero() {
  return (
    <section
      className="relative pt-40 pb-28 px-6 overflow-hidden"
      style={{
        background: `radial-gradient(70% 60% at 15% 0%, ${ORANGE}22 0%, transparent 60%), radial-gradient(65% 55% at 90% 15%, ${TEAL}22 0%, transparent 55%), ${INK}`,
      }}
    >
      <div className="max-w-7xl mx-auto relative z-10">
        <Reveal>
          <div className="flex justify-center mb-8">
            <Pill color={TEAL}>SYSTEM ONLINE · P2P READY</Pill>
          </div>
        </Reveal>

        <Reveal delay={80}>
          <h1
            className="text-center font-bold leading-[1.02] tracking-tight"
            style={{
              fontFamily: displayFont,
              color: PAPER,
              fontSize: "clamp(2.6rem, 7vw, 5.4rem)",
            }}
          >
            Zero Install.{" "}
            <span style={gradientTextStyle}>Zero Latency.</span>
            <br />
            Just Jam.
          </h1>
        </Reveal>

        <Reveal delay={160}>
          <p
            className="text-center max-w-2xl mx-auto mt-6 text-2xl font-semibold"
            style={{ fontFamily: displayFont }}
          >
            <span style={gradientTextStyle}>Fly with Kite Studio</span>
          </p>
        </Reveal>

        <Reveal delay={240}>
          <div className="flex flex-col sm:flex-row justify-center gap-4 mt-10">
            <GradientButton icon={ArrowRight} href={SIGNIN_SIGNUP}>
              Start Looping
            </GradientButton>
            <GhostButton icon={Radio} color={TEAL}>
              See Kite Sync in action
            </GhostButton>
          </div>
        </Reveal>

        <Reveal delay={320}>
          <div className="mt-20 relative">
            <div style={{ height: 160 }}>
              <SignalCanvas />
            </div>
            <div className="flex justify-between px-4 -mt-10 text-xs" style={{ fontFamily: monoFont, color: MUTE }}>
              <span style={{ color: ORANGE_SOFT }}>YOU · LOCAL MIC</span>
              <span style={{ color: TEAL_SOFT }}>THEM · REMOTE PEER</span>
            </div>
          </div>
        </Reveal>

        <Reveal delay={400}>
          <div
            className="relative mt-14 max-w-3xl mx-auto rounded-2xl p-5"
            style={{
              background: "rgba(255,255,255,0.03)",
              border: "1px solid rgba(255,255,255,0.08)",
              backdropFilter: "blur(10px)",
            }}
          >
            <CornerDots />
            <div className="flex items-center justify-between mb-4">
              <Pill color={TEAL} dot>
                LIVE MODE · P2P
              </Pill>
              <span style={{ fontFamily: monoFont, color: MUTE, fontSize: 12 }}>ROOM 86UX8N</span>
            </div>
            <div className="grid grid-cols-4 gap-3">
              {["MASTER 1", "TRACK 2", "TRACK 3", "TRACK 4"].map((label, i) => (
                <div
                  key={label}
                  className="rounded-xl p-3 text-center"
                  style={{
                    background: "rgba(255,255,255,0.02)",
                    border: `1px solid ${i === 0 ? ORANGE : "rgba(255,255,255,0.08)"}55`,
                  }}
                >
                  <div style={{ fontFamily: monoFont, fontSize: 10, color: i === 0 ? ORANGE_SOFT : MUTE }}>
                    {label}
                  </div>
                  <div
                    className="mx-auto mt-3 rounded-full flex items-center justify-center"
                    style={{
                      width: 34,
                      height: 34,
                      border: `1.5px solid ${i === 0 ? ORANGE : "rgba(255,255,255,0.2)"}`,
                    }}
                  >
                    <Circle size={10} fill={i === 0 ? ORANGE : "transparent"} color={i === 0 ? ORANGE : MUTE} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

function TrustStrip() {
  const items = [
    "RUNS IN CHROME",
    "PEER-TO-PEER AUDIO",
    "48kHz / OPUS",
    "SUB-40ms TALK-BACK",
    "TURN FALLBACK",
    "AUDIOWORKLET ENGINE",
  ];
  const loop = [...items, ...items];
  return (
    <div className="py-5 overflow-hidden border-y" style={{ borderColor: "rgba(255,255,255,0.08)", background: "#08080A" }}>
      <div className="flex gap-10 whitespace-nowrap kite-marquee">
        {loop.map((t, i) => (
          <span key={i} className="text-xs flex items-center gap-2" style={{ fontFamily: monoFont, color: MUTE }}>
            <span className="w-1 h-1 rounded-full" style={{ background: i % 2 === 0 ? ORANGE : TEAL }} />
            {t}
          </span>
        ))}
      </div>
    </div>
  );
}

function SectionHeading({
  eyebrow,
  title,
  sub,
  color = TEAL,
}: {
  eyebrow: string;
  title: string;
  sub?: string;
  color?: string;
}) {
  return (
    <Reveal>
      <div className="max-w-2xl mb-14">
        <Pill color={color}>{eyebrow}</Pill>
        <h2
          className="mt-5 font-bold tracking-tight"
          style={{
            fontFamily: displayFont,
            color: PAPER,
            fontSize: "clamp(1.9rem, 4vw, 2.8rem)",
          }}
        >
          {title}
        </h2>
        {sub && (
          <p className="mt-4 text-base" style={{ fontFamily: displayFont, color: MUTE }}>
            {sub}
          </p>
        )}
      </div>
    </Reveal>
  );
}

function Pillars() {
  const pillars = [
    {
      icon: Music2,
      color: ORANGE,
      title: "Web-Based Loopstation",
      desc: "A Boss-style 4-track loopstation that runs natively in the browser. Sample-accurate looping powered by an AudioWorklet engine, not JavaScript timers.",
    },
    {
      icon: Users,
      color: TEAL,
      title: "P2P Jam Sessions",
      desc: "WebRTC carries audio, video, and loop data directly between players. Nothing routes through Kite's servers unless a restrictive network forces a relay.",
    },
    {
      icon: Radio,
      color: ORANGE,
      title: "Kite Sync",
      desc: "A latency-aware sync engine that turns network delay into usable musical timing — count in, lock the grid, and play in time together.",
    },
  ];
  return (
    <section id="pillars" className="px-6 py-28" style={{ background: INK }}>
      <div className="max-w-7xl mx-auto">
        <SectionHeading
          eyebrow="THE STACK"
          title="One studio. Three engines."
          sub="Kite Studio isn't a video call with a record button pasted on. It's built engine-first, for musicians who need timing they can trust."
        />
        <div className="grid md:grid-cols-3 gap-6">
          {pillars.map((p, i) => (
            <Reveal key={p.title} delay={i * 120}>
              <div
                className="relative rounded-2xl p-7 h-full"
                style={{
                  background: "rgba(255,255,255,0.03)",
                  border: "1px solid rgba(255,255,255,0.08)",
                  transition: "transform 0.35s ease, border-color 0.35s ease",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.transform = "translateY(-6px)";
                  e.currentTarget.style.borderColor = `${p.color}55`;
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.transform = "translateY(0px)";
                  e.currentTarget.style.borderColor = "rgba(255,255,255,0.08)";
                }}
              >
                <div
                  className="w-11 h-11 rounded-xl flex items-center justify-center mb-6"
                  style={{ background: `${p.color}18`, border: `1px solid ${p.color}44` }}
                >
                  <p.icon size={20} color={p.color} />
                </div>
                <h3 className="text-lg font-semibold mb-3" style={{ fontFamily: displayFont, color: PAPER }}>
                  {p.title}
                </h3>
                <p style={{ fontFamily: displayFont, color: MUTE, fontSize: 14.5, lineHeight: 1.6 }}>{p.desc}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

function LooperShowcase() {
  const tracks = [
    { label: "MASTER 1", state: "start", color: ORANGE },
    { label: "TRACK 2", state: "rec", color: TEAL },
    { label: "TRACK 3", state: "rec", color: TEAL },
    { label: "TRACK 4", state: "rec", color: TEAL },
  ];
  const features = [
    "4-track looping with quantized overdubs locked to the master length",
    "Configurable loop length — 2, 4, or 8 bars",
    "Spacebar foot-pedal support for hands-free record and overdub",
    "Session recording — lossless stems and a mixed stereo export",
    "Built-in metronome, tuner, and webcam panel",
    "Latency calibration keeps overdubs tight on real interfaces",
  ];
  return (
    <section id="looper" className="px-6 py-28" style={{ background: "#08080A" }}>
      <div className="max-w-7xl mx-auto grid lg:grid-cols-2 gap-14 items-center">
        <Reveal>
          <div
            className="relative rounded-2xl p-5"
            style={{
              background: "linear-gradient(160deg, rgba(255,69,0,0.06), rgba(26,158,143,0.06))",
              border: "1px solid rgba(255,255,255,0.08)",
            }}
          >
            <CornerDots />
            <div className="flex items-center justify-between mb-6">
              <span
                className="text-xl font-bold"
                style={{
                  fontFamily: displayFont,
                  background: `linear-gradient(95deg, ${ORANGE}, ${TEAL})`,
                  WebkitBackgroundClip: "text",
                  WebkitTextFillColor: "transparent",
                }}
              >
                Kite Looper
              </span>
              <GhostButton icon={Pause}>Pause</GhostButton>
            </div>
            <div className="grid grid-cols-4 gap-3">
              {tracks.map((t) => (
                <div
                  key={t.label}
                  className="rounded-xl p-4 text-center"
                  style={{ background: "rgba(0,0,0,0.35)", border: `1px solid ${t.color}44` }}
                >
                  <div style={{ fontFamily: monoFont, fontSize: 10, color: t.color }}>{t.label}</div>
                  <div className="mx-auto my-4" style={{ width: 2, height: 30, background: `${t.color}77` }} />
                  <div
                    className="mx-auto rounded-full flex items-center justify-center"
                    style={{ width: 40, height: 40, border: `1.5px solid ${t.color}` }}
                  >
                    <Circle size={11} fill={t.color} color={t.color} />
                  </div>
                  <div style={{ fontFamily: monoFont, fontSize: 9, color: MUTE, marginTop: 8 }}>
                    {t.state === "start" ? "START" : "REC"}
                  </div>
                </div>
              ))}
            </div>
            <div className="flex items-center justify-between mt-6 text-xs" style={{ fontFamily: monoFont, color: MUTE }}>
              <div className="flex items-center gap-2">
                <Gauge size={13} color={TEAL_SOFT} /> LATENCY 12ms
              </div>
              <div className="flex items-center gap-2">
                <Video size={13} color={ORANGE_SOFT} /> WEBCAM ON
              </div>
              <div className="flex items-center gap-2">
                <Settings size={13} /> SETTINGS
              </div>
            </div>
          </div>
        </Reveal>
        <div>
          <Pill color={ORANGE}>THE FLAGSHIP LOOPER</Pill>
          <h2
            className="mt-5 mb-6 font-bold tracking-tight"
            style={{ fontFamily: displayFont, color: PAPER, fontSize: "clamp(1.9rem, 4vw, 2.8rem)" }}
          >
            Loop solo. Loop together. Same engine either way.
          </h2>
          <p className="mb-8" style={{ fontFamily: displayFont, color: MUTE, lineHeight: 1.7 }}>
            The full looper works locally, no partner required. Bring a peer into the room and every track stays
            sample-accurate, layer after layer.
          </p>
          <div className="flex flex-col gap-4">
            {features.map((f, i) => (
              <Reveal key={f} delay={i * 70}>
                <div className="flex items-start gap-3">
                  <div
                    className="mt-0.5 w-5 h-5 rounded-md flex items-center justify-center flex-shrink-0"
                    style={{ background: `${i % 2 === 0 ? ORANGE : TEAL}18` }}
                  >
                    <Check size={12} color={i % 2 === 0 ? ORANGE_SOFT : TEAL_SOFT} />
                  </div>
                  <span style={{ fontFamily: displayFont, color: PAPER, fontSize: 14.5 }}>{f}</span>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function Modes() {
  const modes = [
    {
      icon: Mic,
      color: ORANGE,
      title: "Live Mode",
      desc: "The default. P2P talk-back and room setup — the lowest-friction voice path before locking to the grid.",
    },
    {
      icon: Waves,
      color: TEAL,
      title: "Solo Mode",
      desc: "Local loopstation practice. Full 4-track looper, metronome, and calibration — no peer connectivity needed.",
    },
    {
      icon: Radio,
      color: ORANGE,
      title: "Kite Sync",
      desc: "Syncs participants roughly one loop ahead, with a count-in before going live. Resilient to packet loss.",
    },
    {
      icon: Share2,
      color: TEAL,
      title: "Broadcast Mode",
      desc: "The full collaborative jam surface once sync is locked. Live-monitor ducking keeps every mix clean.",
    },
  ];
  return (
    <section id="modes" className="px-6 py-28" style={{ background: INK }}>
      <div className="max-w-7xl mx-auto">
        <SectionHeading eyebrow="HOW MUSICIANS USE IT" title="Not one mode. A workflow." color={ORANGE} />
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-5">
          {modes.map((m, i) => (
            <Reveal key={m.title} delay={i * 90}>
              <div
                className="rounded-2xl p-6 h-full"
                style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)" }}
              >
                <m.icon size={20} color={m.color} className="mb-5" />
                <h3 className="font-semibold mb-2" style={{ fontFamily: displayFont, color: PAPER }}>
                  {m.title}
                </h3>
                <p style={{ fontFamily: displayFont, color: MUTE, fontSize: 13.5, lineHeight: 1.6 }}>{m.desc}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

function SessionFlow() {
  const steps = [
    { title: "Sign up", desc: "A free account, secured by Supabase auth." },
    { title: "Studio lobby", desc: "Host a room, or join with a 6-character code." },
    { title: "Preflight", desc: "Mic, speakers, signal, and latency all checked before you enter." },
    { title: "Setup wizard", desc: "Set tempo and time signature, solo or with a partner." },
    { title: "Studio bridge", desc: "Looper and P2P session UI, live in one view." },
    { title: "Jam", desc: "Live Mode → Kite Sync → loop, overdub, and record." },
  ];
  return (
    <section className="px-6 py-28" style={{ background: "#08080A" }}>
      <div className="max-w-4xl mx-auto">
        <SectionHeading eyebrow="ZERO TO JAMMING IN 30 SECONDS" title="The session flow" color={TEAL} />
        <div className="relative pl-10">
          <div
            className="absolute left-[15px] top-2 bottom-2 w-px"
            style={{ background: `linear-gradient(${ORANGE}, ${TEAL})` }}
          />
          {steps.map((s, i) => (
            <Reveal key={s.title} delay={i * 90}>
              <div className="relative pb-12 last:pb-0">
                <div
                  className="absolute -left-10 top-0 w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold"
                  style={{
                    fontFamily: monoFont,
                    background: INK,
                    border: `1.5px solid ${i % 2 === 0 ? ORANGE : TEAL}`,
                    color: i % 2 === 0 ? ORANGE_SOFT : TEAL_SOFT,
                  }}
                >
                  {i + 1}
                </div>
                <h4 className="font-semibold mb-1" style={{ fontFamily: displayFont, color: PAPER, fontSize: 17 }}>
                  {s.title}
                </h4>
                <p style={{ fontFamily: displayFont, color: MUTE, fontSize: 14.5 }}>{s.desc}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

function Privacy() {
  const points = [
    "Session audio, video, loops, and in-session text are P2P — not stored on Kite's servers",
    "Supabase handles auth and an optional profile only",
    "Room codes and connection signaling are transient, used only to establish the link",
  ];
  return (
    <section id="privacy" className="px-6 py-24" style={{ background: INK }}>
      <div
        className="max-w-5xl mx-auto rounded-3xl p-10 md:p-14 relative overflow-hidden"
        style={{
          background: `linear-gradient(120deg, ${TEAL}14, transparent 60%)`,
          border: "1px solid rgba(255,255,255,0.08)",
        }}
      >
        <Reveal>
          <div className="flex items-center gap-3 mb-6">
            <div
              className="w-10 h-10 rounded-xl flex items-center justify-center"
              style={{ background: `${TEAL}22`, border: `1px solid ${TEAL}55` }}
            >
              <Lock size={18} color={TEAL_SOFT} />
            </div>
            <span style={{ fontFamily: monoFont, color: TEAL_SOFT, fontSize: 12 }}>PRIVACY BY ARCHITECTURE</span>
          </div>
          <h2
            className="font-bold mb-8 max-w-xl"
            style={{ fontFamily: displayFont, color: PAPER, fontSize: "clamp(1.6rem, 3.4vw, 2.2rem)" }}
          >
            Your jam stays between you and your bandmate — not on our servers.
          </h2>
        </Reveal>
        <div className="grid md:grid-cols-3 gap-6">
          {points.map((p, i) => (
            <Reveal key={p} delay={i * 100}>
              <div className="flex gap-3">
                <Check size={16} color={TEAL_SOFT} className="mt-0.5 flex-shrink-0" />
                <p style={{ fontFamily: displayFont, color: MUTE, fontSize: 14 }}>{p}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

export default function KiteStudioLandingView() {
  return (
    <div className="kite-studio-landing" style={{ minHeight: "100vh" }}>
      <Nav />
      <Hero />
      <TrustStrip />
      <Pillars />
      <LooperShowcase />
      <Modes />
      <SessionFlow />
      <Privacy />
      <KiteStudioLandingFooter />
    </div>
  );
}
