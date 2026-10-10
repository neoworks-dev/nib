import { agentToolNames, isAgentTool, type MessageItem, type ToolItem } from "@nib-ui/protocol";
import { countedNoun, describeCall } from "@nib-ui/ui-contracts";

/** A run of adjacent calls that did the same kind of work. */
export interface ToolGroup {
  id: string;
  label: string;
  noun: string;
  tools: ToolItem[];
}

export type TurnEntry =
  { kind: "item"; item: MessageItem | ToolItem } | { kind: "group"; group: ToolGroup };

/**
 * Tool calls read as activity, not as documents: adjacent calls of the same kind
 * collapse under one header, and anything else (prose, thinking) stays where the
 * harness put it.
 *
 * Starting an agent is the exception. Its card is not a record of a call but the
 * agent itself — the only way into that conversation from here — so it stands in
 * the turn rather than folding into a run nobody would open.
 */
export function groupTurnItems(items: Array<MessageItem | ToolItem>): TurnEntry[] {
  const entries: TurnEntry[] = [];
  for (const item of items) {
    if (item.type !== "tool" || isAgentTool(item.name, agentToolNames.spawn)) {
      entries.push({ kind: "item", item });
      continue;
    }

    const { label, noun } = describeCall(item);
    const previous = entries.at(-1);
    if (
      previous?.kind === "group" &&
      previous.group.label === label &&
      previous.group.noun === noun
    ) {
      previous.group.tools.push(item);
      continue;
    }
    entries.push({ kind: "group", group: { id: item.id, label, noun, tools: [item] } });
  }
  return entries;
}

/** The header's right half: `3 commands`, `1 search`. */
export function groupCount(group: ToolGroup): string {
  return countedNoun(group.tools.length, group.noun);
}

/** A finished stretch of tool work and reasoning, folded into one line the reader can open again. */
export interface ToolSummary {
  id: string;
  /** What ran, as one line: `3 commands, 2 searches`. */
  line: string;
  /** The groups and thoughts it holds, in the order they happened. */
  entries: TurnEntry[];
}

export type CollapsedEntry = TurnEntry | { kind: "summary"; summary: ToolSummary };

/** Whether an entry is reasoning rather than something said to the user. */
function isThought(entry: TurnEntry): boolean {
  return entry.kind === "item" && entry.item.type === "thought";
}

/**
 * Folds each run of adjacent tool groups and thoughts into one summary, for a
 * turn that has finished. They were there to be watched while they ran;
 * afterwards the reply is what matters, and a line saying what ran is enough
 * until it is opened.
 */
export function collapseToolRuns(entries: TurnEntry[]): CollapsedEntry[] {
  const collapsed: CollapsedEntry[] = [];
  let run: TurnEntry[] = [];
  const flush = (): void => {
    const first = run[0];
    if (!first) return;
    collapsed.push({
      kind: "summary",
      summary: { id: summaryId(first), line: summarizeRun(run), entries: run },
    });
    run = [];
  };
  for (const entry of entries) {
    if (entry.kind === "group" || isThought(entry)) {
      run.push(entry);
      continue;
    }
    flush();
    collapsed.push(entry);
  }
  flush();
  return collapsed;
}

/** A stable key for a summary: the id of whatever opened the run. */
function summaryId(first: TurnEntry): string {
  if (first.kind === "group") return first.group.id;
  return first.item.id;
}

/** What a run did: its tool calls counted by kind, or just that it reasoned. */
function summarizeRun(run: TurnEntry[]): string {
  const groups: ToolGroup[] = [];
  for (const entry of run) {
    if (entry.kind === "group") groups.push(entry.group);
  }
  if (groups.length === 0) return "Thought";
  return `Used ${summarizeGroups(groups)}`;
}

/** What a run of groups did, counted by kind of work: `3 commands, 2 searches`. */
export function summarizeGroups(groups: ToolGroup[]): string {
  const counts = new Map<string, number>();
  for (const group of groups) {
    const before = counts.get(group.noun);
    if (before === undefined) counts.set(group.noun, group.tools.length);
    else counts.set(group.noun, before + group.tools.length);
  }
  return [...counts].map(([noun, count]) => countedNoun(count, noun)).join(", ");
}
