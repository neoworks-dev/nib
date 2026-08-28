import type { BlockView } from '@nib-ui/protocol';
import { countedNoun, describeCall } from '@nib-ui/ui-contracts';

/** A run of adjacent calls that did the same kind of work. */
export interface ToolGroup {
	id: string;
	label: string;
	noun: string;
	blocks: BlockView[];
}

export type TurnItem = { kind: 'block'; block: BlockView } | { kind: 'group'; group: ToolGroup };

/**
 * Tool calls read as activity, not as documents: adjacent calls of the same kind
 * collapse under one header, and anything else (prose, thinking, an unpaired
 * result) stays where the harness put it.
 */
export function groupTurnBlocks(blocks: BlockView[]): TurnItem[] {
	const items: TurnItem[] = [];
	for (const block of blocks) {
		if (block.kind !== 'tool_use') {
			items.push({ kind: 'block', block });
			continue;
		}

		const { label, noun } = describeCall(block);
		const previous = items.at(-1);
		if (previous?.kind === 'group' && previous.group.label === label && previous.group.noun === noun) {
			previous.group.blocks.push(block);
			continue;
		}
		items.push({ kind: 'group', group: { id: block.id, label, noun, blocks: [block] } });
	}
	return items;
}

/** The header's right half: `3 commands`, `1 search`. */
export function groupCount(group: ToolGroup): string {
	return countedNoun(group.blocks.length, group.noun);
}
