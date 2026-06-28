"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { NEXUS_LANG_CHANGE_EVENT, type Language } from "@/lib/translations";
import KiteStudioWelcomeView from "@/components/kite-studio/KiteStudioWelcomeView";

export default function WelcomePage() {
  const router = useRouter();
  const [language, setLanguage] = useState<Language>("en");
  const [welcomeReady, setWelcomeReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void supabase.auth.getSession().then(({ data: { session } }) => {
      if (cancelled) return;
      if (session) {
        router.replace("/studio");
        return;
      }
      setWelcomeReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, [router]);

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

  useEffect(() => {
    document.documentElement.classList.add("kite-studio-welcome-active");
    return () => {
      document.documentElement.classList.remove("kite-studio-welcome-active");
    };
  }, []);

  const handleLanguageChange = (lang: Language) => {
    setLanguage(lang);
    try {
      localStorage.setItem("nexus-lang", lang);
      window.dispatchEvent(new Event(NEXUS_LANG_CHANGE_EVENT));
    } catch {
      // Ignore localStorage failures
    }
  };

  const isRtl = language === "fa" || language === "ar";

  if (!welcomeReady) {
    return (
      <div
        className="min-h-screen bg-black"
        aria-busy="true"
        aria-label="Loading"
      />
    );
  }

  return (
    <div
      className="kite-studio-welcome caret-transparent select-none"
      dir={isRtl ? "rtl" : "ltr"}
    >
      <KiteStudioWelcomeView
        language={language}
        onLanguageChange={handleLanguageChange}
      />
    </div>
  );
}
