"use client";

import { useEffect, useMemo, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { motion } from "framer-motion";
import { t, type Language } from "@/lib/translations";
import { InstallKiteButton } from "@/components/InstallKiteButton";

/** App icon file: `public/kite-mobile-icon.png` → URL `/kite-mobile-icon.png` */
const KITE_APP_ICON = "/kite-mobile-icon.png";

const ACCENT_ORANGE = "#FF4500";

const pageShellStyle = {
  minHeight: "100vh",
  background:
    "radial-gradient(circle at top, rgba(255, 69, 0, 0.12) 0%, #000000 55%)",
  color: "#f7f7f8",
  fontFamily: 'Inter, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
};

const sectionStyle = {
  background: "rgba(255, 255, 255, 0.03)",
  border: "1px solid rgba(255, 69, 0, 0.35)",
  borderRadius: 18,
  padding: 22,
};

const orangeIconGradient = "linear-gradient(135deg, #FF4500 0%, #ff6a33 100%)";

const circularLogoBase = {
  borderRadius: "9999px",
  overflow: "hidden",
  border: "2px solid rgba(255, 255, 255, 0.2)",
};

export default function WelcomePage() {
  const [language, setLanguage] = useState<Language>("en");

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const storedLang = localStorage.getItem("nexus-lang");
      if (
        storedLang === "fa" ||
        storedLang === "ar" ||
        storedLang === "en" ||
        storedLang === "kr" ||
        storedLang === "tr"
      ) {
        setLanguage(storedLang);
      }
    } catch {
      // Ignore localStorage failures
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const isRtl = language === "fa" || language === "ar";
    document.documentElement.dir = isRtl ? "rtl" : "ltr";
    document.documentElement.lang =
      language === "kr" ? "ko" : language === "tr" ? "tr" : language;
    document.cookie = `nexus-lang=${language}; path=/; max-age=${60 * 60 * 24 * 365}`;
  }, [language]);

  const languageButtons = useMemo(() => {
    const langs: Language[] = ["en", "kr", "tr", "fa", "ar"];
    const labels: Record<Language, string> = {
      en: "EN",
      kr: "KO",
      tr: "TR",
      fa: "FA",
      ar: "AR",
    };
    return langs.map((lang) => ({ lang, label: labels[lang] }));
  }, []);

  const isRtl = language === "fa" || language === "ar";

  return (
    <div dir={isRtl ? "rtl" : "ltr"} style={pageShellStyle}>
      <header
        style={{
          maxWidth: 1180,
          margin: "0 auto",
          padding: "22px 20px",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 14,
          flexWrap: "wrap",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div
            className="h-10 w-10 rounded-full border-2 border-white/20"
            style={{
              ...circularLogoBase,
              background: "rgba(255, 255, 255, 0.03)",
            }}
          >
            <Image
              src={KITE_APP_ICON}
              alt="Kite logo"
              width={40}
              height={40}
              priority
              className="h-full w-full object-cover"
            />
          </div>
          <span style={{ fontSize: 26, fontWeight: 800, letterSpacing: 0.2 }}>
            Kite
          </span>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <div style={{ display: "flex", gap: 8 }}>
            {languageButtons.map(({ lang, label }) => {
              const isActive = language === lang;
              return (
                <button
                  key={lang}
                  type="button"
                  onClick={() => {
                    setLanguage(lang);
                    try {
                      localStorage.setItem("nexus-lang", lang);
                    } catch {
                      // Ignore localStorage failures
                    }
                  }}
                  style={{
                    border: `1px solid ${
                      isActive ? ACCENT_ORANGE : "rgba(255,255,255,0.25)"
                    }`,
                    background: isActive ? ACCENT_ORANGE : "transparent",
                    color: "#fff",
                    padding: "6px 10px",
                    borderRadius: 999,
                    fontSize: 12,
                    fontWeight: 700,
                    cursor: "pointer",
                  }}
                >
                  {label}
                </button>
              );
            })}
          </div>
          <nav style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <Link
            href="/chat?mode=signup"
            style={{
              textDecoration: "none",
              fontWeight: 700,
              borderRadius: 999,
              padding: "10px 16px",
              background: ACCENT_ORANGE,
              color: "#111",
            }}
          >
            {t(language, "welcomeLaunchApp")}
          </Link>
          <Link
            href="/chat?mode=login"
            style={{
              textDecoration: "none",
              fontWeight: 700,
              borderRadius: 999,
              padding: "10px 16px",
              color: "#fff",
              border: "1px solid rgba(255,255,255,0.25)",
            }}
          >
            {t(language, "welcomeLogin")}
          </Link>
          </nav>
        </div>
      </header>

      <main style={{ maxWidth: 1180, margin: "0 auto", padding: "4px 20px 48px" }}>
        <section
          style={{
            minHeight: "68vh",
            display: "grid",
            placeItems: "center",
            textAlign: "center",
            padding: "34px 0 20px",
          }}
        >
          <div>
            <motion.div
              initial={{ y: 0 }}
              animate={{ y: [0, -10, 0] }}
              transition={{ duration: 4.8, repeat: Infinity, ease: "easeInOut" }}
              className="mx-auto flex h-48 w-48 items-center justify-center"
            >
              <div className="h-48 w-48 overflow-hidden rounded-full border-2 border-white/20 shadow-[0_0_40px_rgba(255,69,0,0.35)]">
                <Image
                  src={KITE_APP_ICON}
                  alt="Kite"
                  width={192}
                  height={192}
                  priority
                  className="h-full w-full object-cover"
                />
              </div>
            </motion.div>

            <h1
              style={{
                marginTop: 18,
                marginBottom: 8,
                fontSize: "clamp(2.2rem, 7vw, 4.9rem)",
                fontWeight: 900,
                letterSpacing: -0.6,
              }}
            >
              {t(language, "welcomeHeroTitle")}
            </h1>
            <p style={{ color: "rgba(255,255,255,0.72)", fontSize: 17 }}>
              {t(language, "welcomeHeroSubtitle")}
            </p>

            <div
              style={{
                marginTop: 38,
                display: "inline-flex",
                flexDirection: "column",
                alignItems: "center",
                color: ACCENT_ORANGE,
                gap: 8,
              }}
            >
              <span style={{ fontSize: 34, lineHeight: 1 }} aria-hidden="true">
                ↓
              </span>
              <span style={{ fontWeight: 700, fontSize: 13, letterSpacing: 0.35 }}>
                {t(language, "welcomeScrollHint")}
              </span>
            </div>
          </div>
        </section>

        <section style={{ paddingTop: 24, marginBottom: 8 }}>
          <div
            style={{
              border: `2px solid ${ACCENT_ORANGE}`,
              borderRadius: 16,
              background: "#050505",
              padding: "clamp(28px, 5vw, 44px) clamp(22px, 4vw, 40px)",
              boxShadow: "0 0 0 1px rgba(255, 69, 0, 0.15), 0 24px 48px rgba(0, 0, 0, 0.55)",
            }}
          >
            <h2
              style={{
                margin: 0,
                marginBottom: 22,
                fontSize: "clamp(0.95rem, 2.4vw, 1.15rem)",
                fontWeight: 800,
                letterSpacing: "0.12em",
                lineHeight: 1.35,
                color: ACCENT_ORANGE,
                textTransform: "uppercase",
              }}
            >
              {t(language, "welcomeMissionTitle")}
            </h2>
            <p
              style={{
                margin: 0,
                marginBottom: 18,
                fontSize: "clamp(1rem, 2.2vw, 1.125rem)",
                lineHeight: 1.75,
                fontWeight: 500,
                color: "rgba(245, 245, 244, 0.94)",
              }}
            >
              {t(language, "welcomeMissionBody1")}
            </p>
            <p
              style={{
                margin: 0,
                fontSize: "clamp(1rem, 2.2vw, 1.125rem)",
                lineHeight: 1.75,
                fontWeight: 500,
                color: "rgba(245, 245, 244, 0.94)",
              }}
            >
              {t(language, "welcomeMissionBody2")}
            </p>
          </div>
        </section>

        <section
          style={{
            paddingTop: 20,
            marginBottom: 8,
            maxWidth: 720,
            marginLeft: "auto",
            marginRight: "auto",
          }}
        >
          <InstallKiteButton language={language} variant="prominent" />
        </section>

        <section style={{ paddingTop: 24 }}>
          <h2 style={{ fontSize: 30, fontWeight: 800, marginBottom: 16 }}>
            {t(language, "welcomeAboutTitle")}
          </h2>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
              gap: 14,
            }}
          >
            <article style={sectionStyle}>
              <div
                style={{
                  ...circularLogoBase,
                  width: 42,
                  height: 42,
                  background: "rgba(255, 69, 0, 0.12)",
                  display: "grid",
                  placeItems: "center",
                  marginBottom: 10,
                }}
              >
                <span
                  aria-hidden="true"
                  style={{
                    fontSize: 19,
                    fontWeight: 900,
                    background: orangeIconGradient,
                    WebkitBackgroundClip: "text",
                    WebkitTextFillColor: "transparent",
                    backgroundClip: "text",
                  }}
                >
                  🔒
                </span>
              </div>
              <h3 style={{ fontSize: 18, fontWeight: 800 }}>
                {t(language, "welcomeAboutE2eeTitle")}
              </h3>
              <p style={{ marginTop: 9, color: "rgba(255,255,255,0.75)", lineHeight: 1.6 }}>
                {t(language, "welcomeAboutE2eeBody")}
              </p>
            </article>

            <article style={sectionStyle}>
              <div
                style={{
                  ...circularLogoBase,
                  width: 42,
                  height: 42,
                  background: "rgba(255, 69, 0, 0.12)",
                  display: "grid",
                  placeItems: "center",
                  marginBottom: 10,
                }}
              >
                <span
                  aria-hidden="true"
                  style={{
                    fontSize: 19,
                    fontWeight: 900,
                    background: orangeIconGradient,
                    WebkitBackgroundClip: "text",
                    WebkitTextFillColor: "transparent",
                    backgroundClip: "text",
                  }}
                >
                  🌐
                </span>
              </div>
              <h3 style={{ fontSize: 18, fontWeight: 800 }}>
                {t(language, "welcomeAboutMultilingualTitle")}
              </h3>
              <p style={{ marginTop: 9, color: "rgba(255,255,255,0.75)", lineHeight: 1.6 }}>
                {t(language, "welcomeAboutMultilingualBody")}
              </p>
            </article>

            <article style={sectionStyle}>
              <div
                style={{
                  ...circularLogoBase,
                  width: 42,
                  height: 42,
                  background: "rgba(255, 69, 0, 0.12)",
                  display: "grid",
                  placeItems: "center",
                  marginBottom: 10,
                }}
              >
                <span
                  aria-hidden="true"
                  style={{
                    fontSize: 19,
                    fontWeight: 900,
                    background: orangeIconGradient,
                    WebkitBackgroundClip: "text",
                    WebkitTextFillColor: "transparent",
                    backgroundClip: "text",
                  }}
                >
                  📶
                </span>
              </div>
              <h3 style={{ fontSize: 18, fontWeight: 800 }}>
                {t(language, "welcomeAboutLowBandwidthTitle")}
              </h3>
              <p style={{ marginTop: 9, color: "rgba(255,255,255,0.75)", lineHeight: 1.6 }}>
                {t(language, "welcomeAboutLowBandwidthBody")}
              </p>
            </article>
          </div>
        </section>

        <section style={{ paddingTop: 42 }}>
          <h2 style={{ fontSize: 30, fontWeight: 800, marginBottom: 16 }}>
            {t(language, "welcomeWhyTitle")}
          </h2>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
              gap: 14,
            }}
          >
            <article style={sectionStyle}>
              <h3 style={{ fontSize: 18, fontWeight: 800 }}>
                {t(language, "welcomeWhyTrackingTitle")}
              </h3>
              <p style={{ marginTop: 9, color: "rgba(255,255,255,0.75)", lineHeight: 1.6 }}>
                {t(language, "welcomeWhyTrackingBody")}
              </p>
            </article>

            <article style={sectionStyle}>
              <h3 style={{ fontSize: 18, fontWeight: 800 }}>
                {t(language, "welcomeWhySoloTitle")}
              </h3>
              <p style={{ marginTop: 9, color: "rgba(255,255,255,0.75)", lineHeight: 1.6 }}>
                {t(language, "welcomeWhySoloBody")}
              </p>
            </article>

            <article style={sectionStyle}>
              <h3 style={{ fontSize: 18, fontWeight: 800 }}>
                {t(language, "welcomeWhyWipeTitle")}
              </h3>
              <p style={{ marginTop: 9, color: "rgba(255,255,255,0.75)", lineHeight: 1.6 }}>
                {t(language, "welcomeWhyWipeBody")}
              </p>
            </article>
          </div>
        </section>

        <section style={{ paddingTop: 42 }}>
          <h2 style={{ fontSize: 30, fontWeight: 800, marginBottom: 16 }}>
            {t(language, "welcomeFutureTitle")}
          </h2>
          <div
            style={{
              background: "rgba(20, 12, 8, 0.75)",
              border: "1px solid rgba(255, 69, 0, 0.45)",
              borderRadius: 20,
              padding: 24,
              boxShadow:
                "0 16px 36px rgba(0, 0, 0, 0.55), 0 0 28px rgba(255, 69, 0, 0.22)",
            }}
          >
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
                gap: 16,
              }}
            >
              <article
                style={{
                  background: "rgba(255,255,255,0.04)",
                  border: "1px solid rgba(255,255,255,0.15)",
                  borderRadius: 16,
                  padding: 18,
                }}
              >
                <h3 style={{ fontSize: 18, fontWeight: 800 }}>
                  {t(language, "welcomeFutureMusicianTitle")}
                </h3>
                <p
                  style={{
                    marginTop: 9,
                    color: "rgba(255,255,255,0.78)",
                    lineHeight: 1.6,
                  }}
                >
                  {t(language, "welcomeFutureMusicianBody")}
                </p>
                <p
                  style={{
                    marginTop: 10,
                    marginBottom: 0,
                    color: "#ff8a50",
                    fontSize: 13,
                    fontWeight: 700,
                  }}
                >
                  {t(language, "welcomeFutureStatus")}
                </p>
              </article>

              <article
                style={{
                  background: "rgba(255,255,255,0.04)",
                  border: "1px solid rgba(255,255,255,0.15)",
                  borderRadius: 16,
                  padding: 18,
                }}
              >
                <h3 style={{ fontSize: 18, fontWeight: 800 }}>
                  {t(language, "welcomeFutureTherapistTitle")}
                </h3>
                <p
                  style={{
                    marginTop: 9,
                    color: "rgba(255,255,255,0.78)",
                    lineHeight: 1.6,
                  }}
                >
                  {t(language, "welcomeFutureTherapistBody")}
                </p>
                <p
                  style={{
                    marginTop: 10,
                    marginBottom: 0,
                    color: "#ff8a50",
                    fontSize: 13,
                    fontWeight: 700,
                  }}
                >
                  {t(language, "welcomeFutureStatus")}
                </p>
              </article>
            </div>
          </div>
        </section>

        <section style={{ paddingTop: 48, paddingBottom: 8 }}>
          <div
            style={{
              ...sectionStyle,
              borderColor: "rgba(255, 69, 0, 0.85)",
              background: "rgba(255, 69, 0, 0.08)",
              transform: "translateY(8px)",
            }}
          >
            <p style={{ margin: 0, fontSize: 19, fontWeight: 800 }}>
              {t(language, "welcomeSammyTitle")}
            </p>
            <p style={{ marginTop: 12, marginBottom: 0, lineHeight: 1.75, color: "#fff" }}>
              {t(language, "welcomeSammyLine1")}
              <br />
              {t(language, "welcomeSammyLine2")}
              <br />
              {t(language, "welcomeSammyLine3")}
              <br />
              {t(language, "welcomeSammyLine4")}
              <br />
              <br />
              {t(language, "welcomeSammySignoff")}
            </p>
          </div>
        </section>
      </main>

      <footer
        style={{
          borderTop: "1px solid rgba(255,255,255,0.12)",
          marginTop: 32,
        }}
      >
        <div
          style={{
            maxWidth: 1180,
            margin: "0 auto",
            padding: "18px 20px 24px",
            fontSize: 14,
            color: "rgba(255,255,255,0.85)",
          }}
        >
          <a
            href="https://instagram.com/sammjeoo"
            target="_blank"
            rel="noreferrer"
            style={{
              color: ACCENT_ORANGE,
              textDecoration: "none",
              borderBottom: "1px solid rgba(255, 69, 0, 0.35)",
              paddingBottom: 2,
            }}
          >
            {t(language, "welcomeFooterContact")}
          </a>
        </div>
      </footer>
    </div>
  );
}

