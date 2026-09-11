import type { MessageView, SessionView } from "@nib-ui/protocol";

export type PaneRole = "builder" | "critic";

/** Which direction handoffs may travel between the two panes. */
export type RelayMode = "off" | "critic-to-builder" | "both";

export const relayModes: { id: RelayMode; label: string; hint: string }[] = [
  { id: "off", label: "No contact", hint: "The panes never message each other" },
  {
    id: "critic-to-builder",
    label: "Critic → builder",
    hint: "Critiques are forwarded to the builder",
  },
  { id: "both", label: "Two-way", hint: "Each finished turn is forwarded to the other pane" },
];

export function relayAllowed(mode: RelayMode, from: PaneRole): boolean {
  if (mode === "off") return false;
  if (mode === "both") return true;
  return from === "critic";
}

export function peerRole(role: PaneRole): PaneRole {
  return role === "builder" ? "critic" : "builder";
}

/** The last completed assistant turn, which is what a handoff carries. */
export function lastAssistantMessage(view: SessionView | null): MessageView | null {
  if (!view) return null;
  for (let index = view.messages.length - 1; index >= 0; index -= 1) {
    const message = view.messages[index]!;
    if (message.role === "assistant" && message.completed) return message;
  }
  return null;
}

export function messageText(message: MessageView): string {
  return message.blocks
    .filter((block) => block.kind === "text")
    .map((block) =>
      block.content?.kind === "text" ? (block.content as { text: string }).text : block.text,
    )
    .join("\n")
    .trim();
}

export function composeHandoff(from: PaneRole, text: string): string {
  const header =
    from === "critic"
      ? "Review from the critic agent. Address every point or explain why not:"
      : "Report from the builder agent. Review it critically and list concrete problems:";
  return `${header}\n\n${text}`;
}

export interface HandoffCandidate {
  from: PaneRole;
  view: SessionView | null;
  relayedMessageId: string | null;
}

/**
 * A handoff fires once per finished turn: the pane must be idle, its last
 * assistant turn must carry text, and that turn must not have been forwarded yet.
 */
export function nextHandoff(
  mode: RelayMode,
  candidate: HandoffCandidate,
): { messageId: string; text: string } | null {
  if (!relayAllowed(mode, candidate.from)) return null;
  if (!candidate.view || candidate.view.status !== "idle") return null;

  const message = lastAssistantMessage(candidate.view);
  if (!message || message.id === candidate.relayedMessageId) return null;

  const text = messageText(message);
  if (text.length === 0) return null;
  return { messageId: message.id, text: composeHandoff(candidate.from, text) };
}
