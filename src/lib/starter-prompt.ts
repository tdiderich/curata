// The first thing a new user asks their agent. Tested for real against a
// fresh instance (Claude Code, 2026-11-09): it creates a folder, rules for it,
// and three pages without stopping to ask. The shorter "Set up curata from
// what we've been working on." made the agent ask clarifying questions and
// write nothing, so keep the explicit steps and the "don't ask" line.
//
// The welcome video types this exact text (scripts/help-videos/welcome.beats.yaml);
// tests/help-videos.test.ts keeps the two in sync.
export const STARTER_PROMPT =
  "Set up curata from what we've been working on: make a folder for it, add a rule for pages written there, and save the 3 pages a new teammate would need. Don't ask first, just do it.";

export function mcpAddCommand(origin: string): string {
  return `claude mcp add --transport http curata ${origin}/api/mcp/stream`;
}

/**
 * What "Copy setup prompt for agent" puts on the clipboard: connect, then run
 * the starter prompt. Written for an agent that may not have curata yet, so it
 * says what to do if it can't add the server itself.
 */
export function setupPrompt(origin: string): string {
  return [
    "Connect to my curata brain and set it up.",
    "",
    `1. Add the curata MCP server. In Claude Code: ${mcpAddCommand(origin)}`,
    `   Other agents: add ${origin}/api/mcp/stream as an MCP connector.`,
    "   If you can't add it yourself, give me the exact step to do it and stop there.",
    "",
    `2. Once curata's tools are available: ${STARTER_PROMPT}`,
  ].join("\n");
}
