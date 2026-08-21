import { describe, expect, test } from 'bun:test';
import { createSessionView, reduceSessionAll, type AnyAgentEvent } from '@nib-ui/protocol';
import { isReadBlock, readPath, readRun } from '../src/read-group';

let seq = 0;
function event(type: string, data: unknown): AnyAgentEvent {
	seq += 1;
	return { id: `e${seq}`, sessionId: 's1', seq, ts: seq, type, data } as AnyAgentEvent;
}

function viewWithReads(paths: string[]) {
	seq = 0;
	const events = [event('message.started', { messageId: 'm1', role: 'assistant' })];
	paths.forEach((path, index) => {
		events.push(
			event('block.started', {
				messageId: 'm1',
				blockId: `b${index}`,
				kind: 'tool_use',
				toolName: 'Read',
				toolUseId: `t${index}`,
			}),
			event('block.completed', {
				blockId: `b${index}`,
				content: { kind: 'tool_use', toolName: 'Read', toolUseId: `t${index}`, input: { file_path: path } },
			}),
		);
	});
	return reduceSessionAll(createSessionView('s1'), events);
}

describe('read grouping', () => {
	test('the first read of a run owns the whole group', () => {
		const view = viewWithReads(['a.ts', 'b.ts', 'c.ts']);
		const blocks = view.messages[0]!.blocks;

		expect(readRun(view, blocks[0]!)?.map((entry) => entry.path)).toEqual(['a.ts', 'b.ts', 'c.ts']);
		expect(readRun(view, blocks[1]!)).toBeNull();
		expect(readRun(view, blocks[2]!)).toBeNull();
	});

	test('a run stops at a block that is not a read', () => {
		seq = 0;
		const view = reduceSessionAll(createSessionView('s1'), [
			event('message.started', { messageId: 'm1', role: 'assistant' }),
			event('block.started', { messageId: 'm1', blockId: 'b0', kind: 'tool_use', toolName: 'Read', toolUseId: 't0' }),
			event('block.completed', {
				blockId: 'b0',
				content: { kind: 'tool_use', toolName: 'Read', toolUseId: 't0', input: { file_path: 'a.ts' } },
			}),
			event('block.started', { messageId: 'm1', blockId: 'b1', kind: 'tool_use', toolName: 'Bash', toolUseId: 't1' }),
		]);

		expect(readRun(view, view.messages[0]!.blocks[0]!)).toHaveLength(1);
	});

	test('identifies read blocks and their paths', () => {
		const view = viewWithReads(['src/app.ts']);
		const block = view.messages[0]!.blocks[0]!;

		expect(isReadBlock(block)).toBe(true);
		expect(readPath(block)).toBe('src/app.ts');
	});
});
