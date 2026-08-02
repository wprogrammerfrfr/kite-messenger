"use client";

/**
 * Connected-view shell: builds engine port and mounts P2PJamPresenter.
 * Used behind ?ui=v2 flag from studio-bridge page.
 * Sync readiness cue lives inside P2PJamPresenter (inline banner).
 */

import { P2PJamPresenter } from "@/components/studio-bridge/P2PJamPresenter";
import { useP2PJamEnginePort } from "@/components/studio-bridge/useP2PJamEnginePort";
import type { UseKiteStudioEngineResult } from "@/hooks/useKiteStudioEngine.types";

export function P2PJamV2ConnectedView({
  engine,
  localJamSetupOwnerId,
  onCopyRoomCode,
  onEndSession,
}: {
  engine: UseKiteStudioEngineResult;
  localJamSetupOwnerId: string;
  onCopyRoomCode: () => void;
  onEndSession: () => void;
}): React.JSX.Element {
  const port = useP2PJamEnginePort(engine, {
    localJamSetupOwnerId,
    onCopyRoomCode,
    onEndSession,
  });

  return (
    <div className="relative min-h-screen w-full">
      {/* Audio elements stay on the parent page (shared engineRefs). */}
      <P2PJamPresenter port={port} />
    </div>
  );
}
