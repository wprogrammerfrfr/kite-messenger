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
import { readSupportModeFromStorage } from "@/lib/support-mode-storage";

type NetworkQuality = "offline" | "slow" | "good";

type ResilienceContextValue = {
  isOnline: boolean;
  networkQuality: NetworkQuality;
  /** Support Mode (persisted) — avatars, motion, read receipts, patience timeouts (see chat). */
  isLowBandwidthMode: boolean;
  /** True when Support Mode is on (from storage), regardless of network */
  isSupportModeEnabled: boolean;
  /** @deprecated No-op; data saver is tied to Support Mode. */
  setManualLowBandwidth: (_value: boolean) => void;
  /** @deprecated Always false */
  manualLowBandwidth: boolean;
  /** True when online but connection is constrained (for header badge) */
  isLowSignal: boolean;
};

const ResilienceContext = createContext<ResilienceContextValue | null>(null);

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
  const [supportModeOn, setSupportModeOn] = useState(false);
  const [connSlow, setConnSlow] = useState(false);

  const syncSupportFromStorage = useCallback(() => {
    setSupportModeOn(readSupportModeFromStorage());
  }, []);

  useEffect(() => {
    syncSupportFromStorage();
  }, [syncSupportFromStorage]);

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

  useEffect(() => {
    const onSupport = () => syncSupportFromStorage();
    window.addEventListener("kite-support-mode", onSupport);
    window.addEventListener("storage", onSupport);
    return () => {
      window.removeEventListener("kite-support-mode", onSupport);
      window.removeEventListener("storage", onSupport);
    };
  }, [syncSupportFromStorage]);

  const setManualLowBandwidth = useCallback((_value: boolean) => {
    // Deprecated: data saver consolidated into Support Mode in chat.
  }, []);

  const isLowBandwidthMode = supportModeOn;
  const manualLowBandwidth = false;

  const networkQuality: NetworkQuality = useMemo(() => {
    if (!isOnline) return "offline";
    if (supportModeOn || connSlow) return "slow";
    return "good";
  }, [isOnline, supportModeOn, connSlow]);

  const isLowSignal = isOnline && (connSlow || supportModeOn);

  const value = useMemo(
    () => ({
      isOnline,
      networkQuality,
      isLowBandwidthMode,
      isSupportModeEnabled: supportModeOn,
      setManualLowBandwidth,
      manualLowBandwidth,
      isLowSignal,
    }),
    [
      isOnline,
      networkQuality,
      isLowBandwidthMode,
      supportModeOn,
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
      isSupportModeEnabled: false,
      setManualLowBandwidth: () => {},
      manualLowBandwidth: false,
      isLowSignal: false,
    };
  }
  return ctx;
}
