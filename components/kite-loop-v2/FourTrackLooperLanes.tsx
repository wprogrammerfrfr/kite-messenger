"use client";

import { LooperTrackLane } from "@/components/kite-loop-v2/LooperTrackLane";

export type SoloTrackLaneView = {
  trackIndex: 1 | 2 | 3 | 4;
  volume: number;
  progress: number;
  workletMode: string;
  onVolumeChange: (linear: number) => void;
  onArmRecord: () => void;
  armDisabled: boolean;
  armLabel: string;
  onResetTrack: () => void;
  resetDisabled: boolean;
  isFocused: boolean;
  onRequestFocus: () => void;
  /** Tracks 2–4: quantized overdub armed, waiting for Track 1 downbeat. */
  isOverdubArmedWaiting?: boolean;
};

export type FourTrackLooperLanesProps = {
  className?: string;
  lanes: SoloTrackLaneView[];
};

export function FourTrackLooperLanes({ className, lanes }: FourTrackLooperLanesProps) {
  return (
    <div className={className}>
      <p className="text-[10px] font-semibold uppercase tracking-widest text-stone-500">
        Tracks
      </p>
      <div className="mt-2 grid gap-2">
        {lanes.map((lane) => (
          <LooperTrackLane
            key={lane.trackIndex}
            trackIndex={lane.trackIndex}
            volume={lane.volume}
            progress={lane.progress}
            workletMode={lane.workletMode}
            onVolumeChange={lane.onVolumeChange}
            onArmRecord={lane.onArmRecord}
            armDisabled={lane.armDisabled}
            armLabel={lane.armLabel}
            onResetTrack={lane.onResetTrack}
            resetDisabled={lane.resetDisabled}
            isFocused={lane.isFocused}
            onRequestFocus={lane.onRequestFocus}
            isOverdubArmedWaiting={lane.isOverdubArmedWaiting}
          />
        ))}
      </div>
    </div>
  );
}
