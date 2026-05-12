"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import AgentConnectModal from "./agent-connect-modal";

interface AgentConnectButtonProps {
  slug: string;
}

export default function AgentConnectButton({ slug }: AgentConnectButtonProps) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button className="agent-bar-btn" onClick={() => setOpen(true)}>
        Add agent
      </button>
      {open &&
        createPortal(
          <AgentConnectModal slug={slug} onClose={() => setOpen(false)} />,
          document.body,
        )}
    </>
  );
}
