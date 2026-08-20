import { describe, expect, test } from 'bun:test';
import {
	createSessionView,
	findToolResultBlock,
	findToolUseBlock,
	parseAgentEvent,
	permissionPreviewBlock,
	reduceSessionAll,
	type AnyAgentEvent,
} from '@nib-ui/protocol';

const fixturePath = new URL('./fixtures/claude-session.jsonl', import.meta.url).pathname;

async function loadView() {
	const text = await Bun.file(fixturePath).text();
	const events: AnyAgentEvent[] = text
		.split('\n')
		.filter((line) => line.trim().length > 0)
		.map((line) => parseAgentEvent(JSON.parse(line)));
	return reduceSessionAll(createSessionView('s1'), events);
}

describe('tool block pairing', () => {
	test('pairs a call with the result it produced', async () => {
		const view = await loadView();
		const result = findToolResultBlock(view, 'tu-1');
		const call = findToolUseBlock(view, 'tu-1');

		expect(result?.id).toBe('m2-0');
		expect(call?.id).toBe('m1-1');
		expect(call?.toolName).toBe('Bash');
	});

	test('returns null for an unknown or missing id', async () => {
		const view = await loadView();
		expect(findToolResultBlock(view, 'tu-404')).toBeNull();
		expect(findToolResultBlock(view, null)).toBeNull();
		expect(findToolUseBlock(view, null)).toBeNull();
	});
});

describe('permissionPreviewBlock', () => {
	test('shapes a pending call as a completed tool_use block', () => {
		const block = permissionPreviewBlock({
			requestId: 'p1',
			toolName: 'Bash',
			input: { command: 'ls -la' },
			suggestions: [],
		});

		expect(block.kind).toBe('tool_use');
		expect(block.toolName).toBe('Bash');
		expect(block.completed).toBe(true);
		expect(block.content).toEqual({ kind: 'tool_use', toolName: 'Bash', toolUseId: '', input: { command: 'ls -la' } });
	});
});
