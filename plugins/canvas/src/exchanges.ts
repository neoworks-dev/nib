import { type ChangedFile, summarizeChanges } from "@nib-ui/plugin-renderer-diff/changed-files";
import { type AgentTurn, type SessionView, transcriptTurns } from "@nib-ui/protocol";
import { describeCall } from "@nib-ui/ui-contracts";
import type { Exchange } from "./model";

export function exchangeId(sessionId: string, messageId: string): string {
  return `${sessionId}#${messageId}`;
}

/**
 * Folds a transcript into the unit the canvas draws: a prompt plus the turn that
 * answered it.
 */
export function toExchanges(session: SessionView): Exchange[] {
  const exchanges: Exchange[] = [];

  for (const turn of transcriptTurns(session)) {
    if (turn.type === "user") {
      exchanges.push({
        id: exchangeId(session.sessionId, turn.id),
        sessionId: session.sessionId,
        messageId: turn.id,
        prompt: turn.item.text.trim(),
        reply: "",
        steps: [],
        changes: [],
        working: false,
        messageIds: [turn.id],
      });
      continue;
    }

    // A transcript that opens with harness output (a resumed session, a slash
    // command) still needs somewhere to put it.
    if (exchanges.length === 0) {
      exchanges.push({
        id: exchangeId(session.sessionId, turn.id),
        sessionId: session.sessionId,
        messageId: turn.id,
        prompt: "",
        reply: "",
        steps: [],
        changes: [],
        working: false,
        messageIds: [],
      });
    }
    foldTurn(exchanges[exchanges.length - 1]!, turn);
  }

  const last = exchanges.at(-1);
  if (last && (session.status === "working" || session.status === "awaiting-permission"))
    last.working = true;
  return exchanges;
}

/** Adds what the agent said, did and changed in a turn to the exchange it answers. */
function foldTurn(exchange: Exchange, turn: AgentTurn): void {
  exchange.messageIds.push(turn.id);

  const reply = turn.items
    .flatMap((item) => (item.type === "text" ? [item.text.trim()] : []))
    .filter((text) => text.length > 0)
    .join("\n\n");
  if (reply.length > 0) {
    exchange.reply = exchange.reply.length > 0 ? `${exchange.reply}\n\n${reply}` : reply;
  }

  for (const item of turn.items) {
    if (item.type !== "tool") continue;
    const call = describeCall(item);
    if (call.label !== "Edit") {
      exchange.steps.push({ ...call, turnId: turn.id, toolCallId: item.toolCallId });
    }
  }
  mergeChanges(exchange.changes, summarizeChanges(turn).files);
}

function mergeChanges(target: ChangedFile[], incoming: ChangedFile[]): void {
  for (const file of incoming) {
    const existing = target.find((entry) => entry.path === file.path);
    if (!existing) {
      target.push({ ...file });
      continue;
    }
    existing.added += file.added;
    existing.removed += file.removed;
  }
}
