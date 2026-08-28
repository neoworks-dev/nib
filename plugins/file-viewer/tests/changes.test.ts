import { describe, expect, test } from 'bun:test';
import { createSessionView, type BlockView, type MessageView, type SessionView } from '@nib-ui/protocol';
import {
	hunkRange,
	latestEdits,
	placeHunks,
	reviewLines,
	reviewMessage,
	type FileEdit,
	type ReviewOutcome,
} from '../src/changes';

function editBlock(id: string, toolName: string, input: unknown): BlockView {
	return {
		id,
		messageId: 'm',
		kind: 'tool_use',
		toolName,
		toolUseId: `tu-${id}`,
		text: '',
		inputJson: '',
		content: { kind: 'tool_use', toolName, toolUseId: `tu-${id}`, input },
		completed: true,
	};
}

function resultBlock(id: string): BlockView {
	return {
		id: `r-${id}`,
		messageId: 'm',
		kind: 'tool_result',
		toolName: 'Edit',
		toolUseId: `tu-${id}`,
		text: '',
		inputJson: '',
		content: { kind: 'tool_result', toolUseId: `tu-${id}`, output: 'ok' },
		completed: true,
	};
}

function session(messages: { id: string; blocks: BlockView[] }[]): SessionView {
	return {
		...createSessionView('s1'),
		messages: messages.map(
			({ id, blocks }): MessageView => ({ id, role: 'assistant', blocks, completed: true, stopReason: null }),
		),
	};
}

describe('latestEdits', () => {
	test('reads applied edits for the file', () => {
		const view = session([
			{
				id: 'm1',
				blocks: [
					editBlock('b1', 'Edit', { file_path: '/repo/a.ts', old_string: 'one', new_string: 'ONE' }),
					resultBlock('b1'),
				],
			},
		]);
		expect(latestEdits(view, '/repo/a.ts')).toEqual([
			{ id: 'b1', path: '/repo/a.ts', before: 'one', after: 'ONE' },
		]);
	});

	test('takes the whole content of a Write as the change', () => {
		const view = session([
			{ id: 'm1', blocks: [editBlock('b1', 'Write', { file_path: '/repo/a.ts', content: 'new file' }), resultBlock('b1')] },
		]);
		expect(latestEdits(view, '/repo/a.ts')[0]).toEqual({ id: 'b1', path: '/repo/a.ts', before: '', after: 'new file' });
	});

	test('only the newest turn that touched the file is reviewable', () => {
		const view = session([
			{ id: 'm1', blocks: [editBlock('b1', 'Edit', { file_path: '/repo/a.ts', new_string: 'first' }), resultBlock('b1')] },
			{ id: 'm2', blocks: [editBlock('b2', 'Edit', { file_path: '/repo/b.ts', new_string: 'other' }), resultBlock('b2')] },
			{ id: 'm3', blocks: [editBlock('b3', 'Edit', { file_path: '/repo/a.ts', new_string: 'second' }), resultBlock('b3')] },
		]);
		expect(latestEdits(view, '/repo/a.ts').map((edit) => edit.id)).toEqual(['b3']);
	});

	test('ignores edits to other files and calls that have not returned', () => {
		const view = session([
			{ id: 'm1', blocks: [editBlock('b1', 'Edit', { file_path: '/repo/other.ts', new_string: 'x' }), resultBlock('b1')] },
			{ id: 'm2', blocks: [editBlock('b2', 'Edit', { file_path: '/repo/a.ts', new_string: 'pending' })] },
		]);
		expect(latestEdits(view, '/repo/a.ts')).toEqual([]);
	});
});

const text = ['alpha', 'beta', 'gamma', 'delta'].join('\n');

describe('placeHunks', () => {
	test('locates an edit by its replacement text', () => {
		const edits: FileEdit[] = [{ id: 'b1', path: 'a', before: 'BETA', after: 'beta' }];
		expect(placeHunks(text, edits)).toEqual([
			{ editId: 'b1', startLine: 1, removed: ['BETA'], added: ['beta'] },
		]);
	});

	test('drops an edit whose replacement was overwritten since', () => {
		expect(placeHunks(text, [{ id: 'b1', path: 'a', before: 'x', after: 'not in the file' }])).toEqual([]);
	});

	test('keeps the earlier of two overlapping edits', () => {
		const edits: FileEdit[] = [
			{ id: 'b2', path: 'a', before: '', after: 'gamma' },
			{ id: 'b1', path: 'a', before: '', after: 'beta\ngamma' },
		];
		expect(placeHunks(text, edits).map((hunk) => hunk.editId)).toEqual(['b1']);
	});

	test('reports the range a hunk covers', () => {
		const [hunk] = placeHunks(text, [{ id: 'b1', path: 'a', before: '', after: 'beta\ngamma' }]);
		expect(hunkRange(hunk!)).toEqual([2, 3]);
	});
});

describe('reviewLines', () => {
	test('puts removals above additions and numbers only real lines', () => {
		const hunks = placeHunks(text, [{ id: 'b1', path: 'a', before: 'BETA', after: 'beta' }]);
		expect(reviewLines(text, hunks)).toEqual([
			{ kind: 'context', number: 1, text: 'alpha', editId: null, startsHunk: false },
			{ kind: 'removed', number: null, text: 'BETA', editId: 'b1', startsHunk: true },
			{ kind: 'added', number: 2, text: 'beta', editId: 'b1', startsHunk: false },
			{ kind: 'context', number: 3, text: 'gamma', editId: null, startsHunk: false },
			{ kind: 'context', number: 4, text: 'delta', editId: null, startsHunk: false },
		]);
	});

	test('an insertion with nothing removed starts the hunk on its first added line', () => {
		const hunks = placeHunks(text, [{ id: 'b1', path: 'a', before: '', after: 'beta\ngamma' }]);
		const lines = reviewLines(text, hunks);
		expect(lines.filter((line) => line.startsHunk)).toEqual([
			{ kind: 'added', number: 2, text: 'beta', editId: 'b1', startsHunk: true },
		]);
		expect(lines.map((line) => line.kind)).toEqual(['context', 'added', 'added', 'context']);
	});

	test('a file with no hunks is all context', () => {
		expect(reviewLines(text, []).every((line) => line.kind === 'context')).toBe(true);
	});
});

describe('reviewMessage', () => {
	const accepted: ReviewOutcome = { editId: 'b1', verdict: 'accepted', lines: [2, 3] };
	const rejected: ReviewOutcome = { editId: 'b2', verdict: 'rejected', lines: [8, 9] };

	test('says nothing when everything was accepted', () => {
		expect(reviewMessage('/repo/a.ts', [accepted])).toBeNull();
	});

	test('asks for a revert when everything was rejected', () => {
		expect(reviewMessage('/repo/a.ts', [rejected])).toBe(
			'I reviewed /repo/a.ts in the editor and rejected your change. Revert it and tell me what you would do instead — do not re-apply it.',
		);
	});

	test('names the rejected range when only part was rejected', () => {
		const message = reviewMessage('/repo/a.ts', [accepted, rejected]);
		expect(message).toContain('rejected the change at lines 8–9');
		expect(message).toContain('Keep everything else');
	});
});
