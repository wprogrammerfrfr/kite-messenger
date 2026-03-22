"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

/** Chromium install prompt (minimal typing; not in all DOM lib versions). */
type BeforeInstallPromptEvent = Event & {
  readonly platforms: string[];
  readonly userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
  prompt(): Promise<void>;
};

function readIsStandalone(): boolean {
  if (typeof window === "undefined") return false;
  try {
    if (window.matchMedia("(display-mode: standalone)").matches) return true;
  } catch {
    // ignore
  }
  const nav = window.navigator as Navigator & { standalone?: boolean };
  return nav.standalone === true;
}

type InstallPromptContextValue = {
  /** Captured from `beforeinstallprompt` after `preventDefault`. */
  deferredPrompt: BeforeInstallPromptEvent | null;
  /** True when the app is already running as an installed PWA (or iOS home-screen). */
  isStandalone: boolean;
  /** Show install UI only when not installed and the browser offered a prompt. */
  canInstall: boolean;
  /** Opens the native install dialog; clears the deferred prompt so the button hides. */
  requestInstall: () => Promise<void>;
};

const InstallPromptContext =
  createContext<InstallPromptContextValue | null>(null);

export function InstallPromptProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [deferredPrompt, setDeferredPrompt] =
    useState<BeforeInstallPromptEvent | null>(null);
  const [isStandalone, setIsStandalone] = useState(false);

  useEffect(() => {
    setIsStandalone(readIsStandalone());
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const onBeforeInstall = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };

    const onInstalled = () => {
      setDeferredPrompt(null);
      setIsStandalone(true);
    };

    window.addEventListener("beforeinstallprompt", onBeforeInstall);
    window.addEventListener("appinstalled", onInstalled);

    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstall);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  const requestInstall = useCallback(async () => {
    if (typeof window === "undefined") return;
    const promptEvent = deferredPrompt;
    if (!promptEvent) return;

    setDeferredPrompt(null);

    try {
      await promptEvent.prompt();
      await promptEvent.userChoice.catch(() => {
        // Some browsers reject if dismissed; ignore
      });
    } catch {
      // prompt() may throw if not allowed
    }
  }, [deferredPrompt]);

  const value = useMemo<InstallPromptContextValue>(
    () => ({
      deferredPrompt,
      isStandalone,
      canInstall: !isStandalone && deferredPrompt !== null,
      requestInstall,
    }),
    [deferredPrompt, isStandalone, requestInstall]
  );

  return (
    <InstallPromptContext.Provider value={value}>
      {children}
    </InstallPromptContext.Provider>
  );
}

export function useInstallPrompt(): InstallPromptContextValue {
  const ctx = useContext(InstallPromptContext);
  if (!ctx) {
    throw new Error("useInstallPrompt must be used within InstallPromptProvider");
  }
  return ctx;
}

/** Safe for optional UI when provider might be absent (should not happen in app shell). */
export function useInstallPromptOptional(): InstallPromptContextValue | null {
  return useContext(InstallPromptContext);
}
