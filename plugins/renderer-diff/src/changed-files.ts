import { blockToolInput, type MessageView } from '@nib-ui/protocol';
import { diffLines } from './diff';

export interface ChangedFile {
	path: string;
	added: number;
	removed: number;
}

export interface ChangeSummary {
	files: ChangedFile[];
	added: number;
	removed: number;
}

const editTools = new Set(['Edit', 'Write', 'NotebookEdit']);

/** One entry per file: repeated edits to the same path accumulate. */
export function summarizeChanges(message: MessageView): ChangeSummary {
	const byPath = new Map<string, ChangedFile>();

	for (const block of message.blocks) {
		if (block.kind !== 'tool_use' || !block.toolName || !editTools.has(block.toolName)) continue;
		const input = (blockToolInput(block) ?? {}) as Record<string, unknown>;
		const path = typeof input.file_path === 'string' ? input.file_path : null;
		if (!path) continue;

		const before = typeof input.old_string === 'string' ? input.old_string : '';
		const after =
			typeof input.new_string === 'string' ? input.new_string : typeof input.content === 'string' ? input.content : '';
		const lines = diffLines(before, after);
		const entry = byPath.get(path) ?? { path, added: 0, removed: 0 };
		entry.added += lines.filter((line) => line.kind === 'added').length;
		entry.removed += lines.filter((line) => line.kind === 'removed').length;
		byPath.set(path, entry);
	}

	const files = [...byPath.values()];
	return {
		files,
		added: files.reduce((total, file) => total + file.added, 0),
		removed: files.reduce((total, file) => total + file.removed, 0),
	};
}
