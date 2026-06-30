"use client";

import { useEffect, useRef, type RefObject } from "react";

export type LooperFootPedalArmContext = {
  /** When false, listeners are not attached. */
  enabled: boolean;
  /**
   * Pedal routing target 1–4, read on each handled space keydown.
   * 1 = master first-loop path; 2–4 = overdub path. Omitted or invalid → 1.
   */
  pedalTargetTrackIndexRef?: RefObject<number>;
};

export type UseLooperFootPedalOptions = {
  armContext: LooperFootPedalArmContext;
  /** Runs synchronously on capture-phase keydown before `onPedalDown` (timing-critical sampling). */
  onPedalDownPrepare?: () => void;
  /** Receives resolved track index in 1..4 (each keydown = one tap; no keyup). */
  onPedalDown: (targetTrackIndex: number) => void;
};

function resolvePedalTargetTrackIndex(ctx: LooperFootPedalArmContext): number {
  const raw = ctx.pedalTargetTrackIndexRef?.current;
  if (raw == null || !Number.isFinite(raw)) {
    return 1;
  }
  return Math.min(4, Math.max(1, Math.floor(raw)));
}

function isSpaceKey(e: KeyboardEvent): boolean {
  return e.code === "Space" || e.key === " ";
}

function isRangeSliderFocus(): boolean {
  const el = document.activeElement;
  return el instanceof HTMLInputElement && el.type === "range";
}

function isRangeSliderTarget(target: EventTarget | null): boolean {
  if (!target || !(target instanceof Element)) {
    return false;
  }
  const input = target.closest('input[type="range"]');
  return input instanceof HTMLInputElement;
}

function isEditableFocus(): boolean {
  const el = document.activeElement;
  if (!el || !(el instanceof HTMLElement)) {
    return false;
  }
  if (el instanceof HTMLInputElement && el.type === "range") {
    return false;
  }
  if (el.isContentEditable) {
    return true;
  }
  const role = el.getAttribute("role");
  if (role === "textbox" || role === "combobox") {
    return true;
  }
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

function isEditableEventTarget(target: EventTarget | null): boolean {
  if (!target || !(target instanceof Element)) {
    return false;
  }
  if (isRangeSliderTarget(target)) {
    return false;
  }
  return Boolean(
    target.closest(
      "input:not([type='range']), textarea, select, [contenteditable='true'], [contenteditable=''], [role='textbox']"
    )
  );
}

/**
 * Window-level spacebar “pedal” for loop transport (tap-to-toggle). Skips editable fields and prevents default scroll
 * for handled keys. A capture-phase keyup silencer blocks synthetic button activation on Space release without invoking
 * `onPedalDown`. Each handled keydown passes the current `pedalTargetTrackIndexRef` (default 1).
 */
export function useLooperFootPedal({
  armContext,
  onPedalDownPrepare,
  onPedalDown,
}: UseLooperFootPedalOptions): void {
  const onPedalDownRef = useRef(onPedalDown);
  const onPedalDownPrepareRef = useRef(onPedalDownPrepare);
  const armContextRef = useRef(armContext);
  onPedalDownRef.current = onPedalDown;
  onPedalDownPrepareRef.current = onPedalDownPrepare;
  armContextRef.current = armContext;

  useEffect(() => {
    if (!armContext.enabled || typeof window === "undefined") {
      return;
    }

    const onKeyDown = (e: KeyboardEvent): void => {
      if (!isSpaceKey(e)) {
        return;
      }
      if (isEditableFocus() || isEditableEventTarget(e.target)) {
        return;
      }
      e.preventDefault();
      if (e.repeat) {
        return;
      }
      if (isRangeSliderFocus() || isRangeSliderTarget(e.target)) {
        return;
      }
      onPedalDownPrepareRef.current?.();
      const target = resolvePedalTargetTrackIndex(armContextRef.current);
      onPedalDownRef.current(target);
    };

    const onKeyUpSilenceGhostClick = (e: KeyboardEvent): void => {
      if (!isSpaceKey(e)) {
        return;
      }
      if (isEditableFocus() || isEditableEventTarget(e.target)) {
        return;
      }
      e.preventDefault();
      if (e.repeat) {
        return;
      }
      if (isRangeSliderFocus() || isRangeSliderTarget(e.target)) {
        return;
      }
      e.stopPropagation();
    };

    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("keyup", onKeyUpSilenceGhostClick, true);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("keyup", onKeyUpSilenceGhostClick, true);
    };
  }, [armContext.enabled]);
}
