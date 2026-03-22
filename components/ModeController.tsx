"use client";

import { motion } from "framer-motion";
import { t, type Language } from "@/lib/translations";

export function ModeController(props: {
  professionalMode: boolean;
  isSupportMode: boolean;
  language: Language;
  professionalDisabled?: boolean;
  /** When false, hides Professional Mode UI (subscription prep); Support + key status stay visible. */
  showProfessionalUI?: boolean;
  onToggleProfessional: () => void;
  onToggleSupport: () => void;
  isOwnKeySyncing: boolean;
  hasOwnKeyInDb: boolean;
}) {
  const {
    professionalMode,
    isSupportMode,
    language,
    professionalDisabled = false,
    showProfessionalUI = true,
    onToggleProfessional,
    onToggleSupport,
    isOwnKeySyncing,
    hasOwnKeyInDb,
  } = props;

  return (
    <div className="border-t p-4" style={{ borderColor: "var(--border)" }}>
      {showProfessionalUI && (
        <>
          <label className="flex cursor-pointer items-center justify-between gap-3">
            <span className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>
              {t(language, "professionalModeLabel")}
            </span>
            <motion.button
              type="button"
              role="switch"
              aria-checked={professionalMode}
              className="relative h-7 w-12 shrink-0 rounded-full"
              disabled={professionalDisabled}
              style={{
                background: professionalMode
                  ? "var(--accent)"
                  : isSupportMode
                    ? "rgba(255, 69, 0, 0.2)"
                    : "rgba(139, 92, 246, 0.5)",
                pointerEvents: professionalDisabled ? "none" : "auto",
                opacity: professionalDisabled ? 0.6 : 1,
              }}
              onClick={onToggleProfessional}
              whileTap={{ scale: 0.98 }}
              initial={false}
              animate={{
                background: professionalMode
                  ? "var(--accent)"
                  : isSupportMode
                    ? "rgba(255, 69, 0, 0.2)"
                    : "rgba(139, 92, 246, 0.5)",
              }}
              transition={{ duration: 0.5, ease: "easeInOut" }}
            >
              <motion.span
                className="absolute top-1 h-5 w-5 rounded-full bg-white shadow"
                initial={false}
                animate={{ left: professionalMode ? "26px" : "4px" }}
                transition={{ duration: 0.3, ease: "easeInOut" }}
              />
            </motion.button>
          </label>
          <p className="mt-1.5 text-xs" style={{ color: "var(--text-secondary)" }}>
            {isSupportMode
              ? t(language, "supportDescription")
              : professionalMode
                ? t(language, "professionalDescriptionTherapist")
                : t(language, "professionalDescriptionMusician")}
          </p>
        </>
      )}

      <div
        className={showProfessionalUI ? "mt-4" : ""}
        style={{
          borderRadius: "0.75rem",
          border: "2px solid",
          borderColor: isSupportMode ? "#FF4500" : "rgba(255, 69, 0, 0.42)",
          background: isSupportMode
            ? "rgba(255, 69, 0, 0.12)"
            : "rgba(255, 69, 0, 0.04)",
          boxShadow: isSupportMode
            ? "0 0 0 1px rgba(255, 69, 0, 0.25), 0 4px 20px rgba(255, 69, 0, 0.12)"
            : "none",
        }}
      >
        <div className="p-3 sm:p-3.5">
          <label className="flex cursor-pointer items-center justify-between gap-3">
            <span
              className="text-sm font-bold uppercase tracking-wide"
              style={{ color: isSupportMode ? "#FF4500" : "var(--text-primary)" }}
            >
              {t(language, "supportModeLabel")}
            </span>
            <motion.button
              type="button"
              role="switch"
              aria-checked={isSupportMode}
              className="relative h-8 w-[3.25rem] shrink-0 rounded-full ring-2 ring-[rgba(255,69,0,0.5)] ring-offset-2 ring-offset-transparent"
              style={{
                background: isSupportMode ? "#FF4500" : "rgba(120, 113, 108, 0.45)",
              }}
              onClick={onToggleSupport}
              whileTap={{ scale: 0.97 }}
              initial={false}
            >
              <motion.span
                className="absolute top-1 h-6 w-6 rounded-full bg-white shadow-md"
                initial={false}
                animate={{ left: isSupportMode ? "1.375rem" : "0.25rem" }}
                transition={{ duration: 0.25, ease: "easeInOut" }}
              />
            </motion.button>
          </label>
          <p className="mt-2 text-xs leading-relaxed" style={{ color: "var(--text-secondary)" }}>
            {t(language, "optimizedSupportText")}
          </p>
        </div>
      </div>

      <p className="mt-3 text-xs" style={{ color: "var(--text-secondary)" }}>
        {isOwnKeySyncing
          ? t(language, "syncingSecurity")
          : hasOwnKeyInDb
          ? t(language, "secureBadge")
          : t(language, "securityNotSynced")}
      </p>
    </div>
  );
}

