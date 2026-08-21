import { blockToolInput, type BlockView, type SessionView } from '@nib-ui/protocol';

export interface ReadEntry {
	blockId: string;
	path: string;
}

const readTools = new Set(['Read', 'NotebookRead']);

export function isReadBlock(block: BlockView): boolean {
	return block.kind === 'tool_use' && block.toolName !== null && readTools.has(block.toolName);
}

export function readPath(block: BlockView): string {
	const input = blockToolInput(block);
	if (input && typeof input === 'object') {
		const candidate = (input as Record<string, unknown>).file_path ?? (input as Record<string, unknown>).notebook_path;
		if (typeof candidate === 'string') return candidate;
	}
	return 'unknown file';
}

/**
 * Consecutive reads in one turn collapse into a single row, so the first block
 * of a run renders the group and the rest render nothing.
 */
export function readRun(session: SessionView, block: BlockView): ReadEntry[] | null {
	const blocks = session.messages.find((message) => message.id === block.messageId)?.blocks ?? [];
	const index = blocks.findIndex((candidate) => candidate.id === block.id);
	if (index < 0) return null;

	const previous = blocks[index - 1];
	if (previous && isReadBlock(previous)) return null;

	const run: ReadEntry[] = [];
	for (let cursor = index; cursor < blocks.length; cursor += 1) {
		const candidate = blocks[cursor]!;
		if (!isReadBlock(candidate)) break;
		run.push({ blockId: candidate.id, path: readPath(candidate) });
	}
	return run;
}
