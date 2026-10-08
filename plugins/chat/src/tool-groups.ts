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
