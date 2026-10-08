import { type AgentTurn, type SessionView, transcriptTurns, type UserItem } from "@nib-ui/protocol";
import { describeStep } from "@nib-ui/ui-contracts";

/**
 * Characters of transcript a hand-over carries. Beyond it the oldest turns drop
 * off: the recent work is what the new harness has to continue, and a prompt too
 * large to accept is worse than one that starts mid-conversation.
 */
export const HANDOVER_BUDGET = 60_000;

export const DROPPED_MARKER = "[earlier turns dropped to fit]";

/**
 * A harness taking a conversation over never saw any of it: nothing but the
 * prompt travels between two harnesses, so the transcript has to be written out
 * as text. Tool calls become the same one-line phrases the turn cards show —
 * what ran matters to the hand-over, its output belongs to the session that ran it.
 */
export function transcriptText(session: SessionView, budget = HANDOVER_BUDGET): string {
  const turns = replayTurns(session);
  if (turns.length === 0) return "";

  const kept: string[] = [];
  let used = 0;
  for (let index = turns.length - 1; index >= 0; index -= 1) {
    const turn = turns[index]!;
    // The newest turn goes in whatever it costs: a hand-over with no turns at
    // all is worse than one over budget.
    if (used + turn.length > budget && kept.length > 0) {
      kept.push(DROPPED_MARKER);
      break;
    }
    kept.push(turn);
    used += turn.length;
  }
  return kept.reverse().join("\n\n");
}

/**
 * The whole prompt the new session starts from. It says plainly that the work
 * below already happened, so the harness continues it instead of redoing it.
 */
export function handoverSeed(session: SessionView, budget = HANDOVER_BUDGET): string {
  const body = transcriptText(session, budget);
  if (body.length === 0) {
    return "You are taking over a conversation that has not said anything yet. Wait for the next instruction.";
  }
  return [
    "You are taking over a conversation that ran on another agent. Everything between the markers is a replay of that transcript as text, oldest first. The tool calls it mentions were run by the previous agent, not by you, and their output is not included.",
    "",
    "--- transcript begins ---",
    body,
    "--- transcript ends ---",
    "",
    "Treat that work as already done. Do not repeat it. Say what state the work is in, then wait for the next instruction.",
  ].join("\n");
}

/** Each turn that said anything, as the line block it replays as. */
export function replayTurns(session: SessionView): string[] {
  const written: string[] = [];
  for (const turn of transcriptTurns(session)) {
    const text = replayText(turn);
    if (text.length > 0) written.push(text);
  }
  return written;
}

function replayText(turn: { type: "user"; item: UserItem } | AgentTurn): string {
  if (turn.type === "user") {
    const prompt = turn.item.text.trim();
    if (prompt.length === 0) return "";
    return `User: ${prompt}`;
  }
  const lines: string[] = [];
  for (const item of turn.items) {
    if (item.type === "text") {
      const text = item.text.trim();
      if (text.length > 0) lines.push(text);
      continue;
    }
    if (item.type === "tool") lines.push(`[${describeStep(item)}]`);
  }
  if (lines.length === 0) return "";
  return `Assistant: ${lines.join("\n")}`;
}
