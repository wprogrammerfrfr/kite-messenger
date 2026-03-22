"use client";

import { useLayoutEffect } from "react";

const STORAGE_KEY = "kite-appearance";

/** Syncs `html.dark` with Tailwind `dark:` and localStorage (default: dark). */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  useLayoutEffect(() => {
    try {
      const mode = localStorage.getItem(STORAGE_KEY);
      if (mode === "light") {
        document.documentElement.classList.remove("dark");
      } else {
        document.documentElement.classList.add("dark");
      }
    } catch {
      document.documentElement.classList.add("dark");
    }
  }, []);

  return <>{children}</>;
}

export function setAppearanceMode(mode: "light" | "dark") {
  try {
    localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    // ignore
  }
  if (mode === "light") {
    document.documentElement.classList.remove("dark");
  } else {
    document.documentElement.classList.add("dark");
  }
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event("kite-appearance"));
  }
}

export function getStoredAppearance(): "light" | "dark" {
  if (typeof window === "undefined") return "dark";
  try {
    return localStorage.getItem(STORAGE_KEY) === "light" ? "light" : "dark";
  } catch {
    return "dark";
  }
}
