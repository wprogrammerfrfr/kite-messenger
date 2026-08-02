"use client";

/**
 * P2P Jam Session — Dummy UI sandbox (visual only).
 * Preview: /sandbox/p2p-jam
 * Feeds P2PJamPresenter via useP2PJamDummyPort — no engine wiring.
 */

import { P2PJamPresenter } from "@/components/studio-bridge/P2PJamPresenter";
import { useP2PJamDummyPort } from "@/components/studio-bridge/useP2PJamDummyPort";

export function P2PJamSandbox(): React.JSX.Element {
  const port = useP2PJamDummyPort();
  return <P2PJamPresenter port={port} />;
}

export default P2PJamSandbox;
