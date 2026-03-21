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

      <div className={showProfessionalUI ? "mt-4" : ""}>
        <label className="flex cursor-pointer items-center justify-between gap-3">
          <span className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>
            {t(language, "supportModeLabel")}
          </span>
          <motion.button
            type="button"
            role="switch"
            aria-checked={isSupportMode}
            className="relative h-7 w-12 shrink-0 rounded-full"
            style={{
              background: isSupportMode ? "var(--accent)" : "rgba(148, 163, 184, 0.7)",
            }}
            onClick={onToggleSupport}
            whileTap={{ scale: 0.98 }}
            initial={false}
          >
            <motion.span
              className="absolute top-1 h-5 w-5 rounded-full bg-white shadow"
              initial={false}
              animate={{ left: isSupportMode ? "26px" : "4px" }}
              transition={{ duration: 0.3, ease: "easeInOut" }}
            />
          </motion.button>
        </label>
        <p className="mt-1.5 text-xs" style={{ color: "var(--text-secondary)" }}>
          {t(language, "optimizedSupportText")}
        </p>
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

