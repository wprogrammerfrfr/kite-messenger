"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

const STORAGE_MANUAL = "kite-low-bandwidth";

type NetworkQuality = "offline" | "slow" | "good";

type ResilienceContextValue = {
  isOnline: boolean;
  networkQuality: NetworkQuality;
  /** Manual data-saver or auto-detected 2G / slow-2g */
  isLowBandwidthMode: boolean;
  /** User toggled data saver in Settings (vs network-only detection). */
  manualLowBandwidth: boolean;
  setManualLowBandwidth: (value: boolean) => void;
  /** True when online but connection is constrained (for header badge) */
  isLowSignal: boolean;
};

const ResilienceContext = createContext<ResilienceContextValue | null>(null);

function readManual(): boolean {
  try {
    return localStorage.getItem(STORAGE_MANUAL) === "1";
  } catch {
    return false;
  }
}

function connectionSlow(): boolean {
  if (typeof navigator === "undefined") return false;
  const c = (
    navigator as Navigator & {
      connection?: { effectiveType?: string; saveData?: boolean };
    }
  ).connection;
  if (!c) return false;
  if (c.saveData) return true;
  const t = c.effectiveType;
  return t === "slow-2g" || t === "2g";
}

export function ResilienceProvider({ children }: { children: ReactNode }) {
  const [isOnline, setIsOnline] = useState(
    typeof navigator !== "undefined" ? navigator.onLine : true
  );
  const [manualLowBw, setManualLowBwState] = useState(false);
  const [connSlow, setConnSlow] = useState(false);

  useEffect(() => {
    setManualLowBwState(readManual());
  }, []);

  useEffect(() => {
    const onOnline = () => setIsOnline(true);
    const onOffline = () => setIsOnline(false);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, []);

  useEffect(() => {
    const nav = navigator as Navigator & {
      connection?: EventTarget & {
        effectiveType?: string;
        saveData?: boolean;
        addEventListener?: (type: string, fn: () => void) => void;
        removeEventListener?: (type: string, fn: () => void) => void;
      };
    };
    const c = nav.connection;
    if (!c?.addEventListener) {
      setConnSlow(connectionSlow());
      return;
    }
    const update = () => setConnSlow(connectionSlow());
    update();
    c.addEventListener("change", update);
    return () => c.removeEventListener?.("change", update);
  }, []);

  const setManualLowBandwidth = useCallback((value: boolean) => {
    setManualLowBwState(value);
    try {
      if (value) localStorage.setItem(STORAGE_MANUAL, "1");
      else localStorage.removeItem(STORAGE_MANUAL);
    } catch {
      // ignore
    }
    window.dispatchEvent(new Event("kite-low-bandwidth"));
  }, []);

  useEffect(() => {
    const onStorage = () => setManualLowBwState(readManual());
    window.addEventListener("kite-low-bandwidth", onStorage);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener("kite-low-bandwidth", onStorage);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  const isLowBandwidthMode = manualLowBw || connSlow;
  const manualLowBandwidth = manualLowBw;

  const networkQuality: NetworkQuality = useMemo(() => {
    if (!isOnline) return "offline";
    if (isLowBandwidthMode) return "slow";
    return "good";
  }, [isOnline, isLowBandwidthMode]);

  const isLowSignal = isOnline && (connSlow || manualLowBw);

  const value = useMemo(
    () => ({
      isOnline,
      networkQuality,
      isLowBandwidthMode,
      manualLowBandwidth,
      setManualLowBandwidth,
      isLowSignal,
    }),
    [
      isOnline,
      networkQuality,
      isLowBandwidthMode,
      manualLowBandwidth,
      setManualLowBandwidth,
      isLowSignal,
    ]
  );

  return (
    <ResilienceContext.Provider value={value}>{children}</ResilienceContext.Provider>
  );
}

export function useResilience(): ResilienceContextValue {
  const ctx = useContext(ResilienceContext);
  if (!ctx) {
    return {
      isOnline: true,
      networkQuality: "good",
      isLowBandwidthMode: false,
      manualLowBandwidth: false,
      setManualLowBandwidth: () => {},
      isLowSignal: false,
    };
  }
  return ctx;
}
