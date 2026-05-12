"use client";

import { AgentConnectFlow } from "./agent-connect-flow";

interface AgentConnectModalProps {
  slug: string;
  onClose: () => void;
}

export default function AgentConnectModal({ slug, onClose }: AgentConnectModalProps) {
  return (
    <div className="agent-overlay" onClick={onClose}>
      <div className="agent-modal" onClick={(e) => e.stopPropagation()}>
        <div className="agent-modal-header">
          <span className="agent-modal-title">Connect an agent</span>
          <button className="agent-modal-close" onClick={onClose}>
            &#x2715;
          </button>
        </div>
        <AgentConnectFlow slug={slug} temporary />
      </div>
    </div>
  );
}
