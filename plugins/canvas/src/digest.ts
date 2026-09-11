export interface DigestEntry {
  prompt: string;
  reply: string;
}

/**
 * How much of a source workstream travels with the workstream started off it.
 * `compact` is the goal and the conclusion; `full` is every turn it took.
 */
export type ContextMode = "compact" | "full";

const promptLimit = 240;
const replyLimit = 700;

/** Characters of transcript a full hand-over carries before older turns drop off. */
export const FULL_CONTEXT_BUDGET = 24_000;

/**
 * A branch and a join both start a session that never saw the work they came
 * from, so the thread has to travel with the prompt. Only the goal and the prose
 * answer go: tool calls are the old session's business.
 */
export function digestOf(prompt: string, reply: string): DigestEntry | null {
  if (prompt.trim().length === 0 && reply.trim().length === 0) return null;
  return { prompt: clip(prompt, promptLimit), reply: clip(reply, replyLimit) };
}

/**
 * Every turn, verbatim, newest kept first when the budget runs out — the recent
 * work is what a follow-up needs, and the opening turns are the ones a goal
 * already summarises. The result stays in transcript order.
 */
export function transcriptDigest(
  turns: DigestEntry[],
  budget = FULL_CONTEXT_BUDGET,
): DigestEntry[] {
  const kept: DigestEntry[] = [];
  let used = 0;

  for (let index = turns.length - 1; index >= 0; index -= 1) {
    const turn = turns[index]!;
    const prompt = turn.prompt.trim();
    const reply = turn.reply.trim();
    if (prompt.length === 0 && reply.length === 0) continue;

    const cost = prompt.length + reply.length;
    // The newest turn goes in whatever it costs: a hand-over with no turns at
    // all is worse than one over budget.
    if (used + cost > budget && kept.length > 0) break;
    kept.push({ prompt, reply });
    used += cost;
  }
  return kept.reverse();
}

export function branchSeed(context: DigestEntry[], question: string): string {
  const body = question.trim();
  if (context.length === 0) return body;
  return [
    "Context from the thread this question branches off, oldest first:",
    "",
    formatEntries(context),
    "",
    "Answer only the side question below. Do not continue the work above unless it asks you to.",
    "",
    body,
  ].join("\n");
}

export function joinSeed(sources: DigestEntry[], instruction: string): string {
  const body = instruction.trim();
  if (sources.length === 0) return body;
  return [
    "These threads ran separately. Their prompts and conclusions, in the order they were picked:",
    "",
    formatEntries(sources),
    "",
    "Take all of them together and do the following:",
    "",
    body,
  ].join("\n");
}

/**
 * Names what a task was started from that is not a thread — a link, a picture, a
 * model. The files themselves travel as attachments; this is the line that says
 * they are there and what they were on the board.
 */
export function referenceSeed(references: string[], instruction: string): string {
  const body = instruction.trim();
  if (references.length === 0) return body;
  return [
    "Working from what is attached or linked:",
    "",
    ...references.map((entry) => `- ${entry}`),
    "",
    body,
  ].join("\n");
}

/** Short enough for a node header, specific enough to tell two joins apart. */
export function joinLabel(sources: DigestEntry[]): string {
  if (sources.length === 0) return "Join";
  const first = clip(sources[0]!.prompt, 40);
  if (sources.length === 1) return first;
  return `${first} +${sources.length - 1}`;
}

function formatEntries(entries: DigestEntry[]): string {
  return entries
    .map((entry, index) => {
      const lines = [`${index + 1}. Asked: ${entry.prompt || "(no prompt)"}`];
      if (entry.reply.length > 0) lines.push(`   Answered: ${indent(entry.reply)}`);
      return lines.join("\n");
    })
    .join("\n\n");
}

function indent(text: string): string {
  return text.split("\n").join("\n   ");
}

function clip(text: string, limit: number): string {
  const trimmed = text.trim();
  return trimmed.length <= limit ? trimmed : `${trimmed.slice(0, limit).trimEnd()}…`;
}
