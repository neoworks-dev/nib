import { describe, expect, test } from 'bun:test';
import type { Component } from 'svelte';
import type { BlockView } from '@nib-ui/protocol';
import type {
	PermissionRendererProps,
	PermissionRendererRegistration,
	RendererProps,
	RendererRegistration,
} from '@nib-ui/ui-contracts';
import { matchBlockRenderer, matchPermissionRenderer } from '../src/lib/client/renderer-matching';

const generic = {} as Component<RendererProps>;
const bash = {} as Component<RendererProps>;
const askQuestion = {} as Component<PermissionRendererProps>;
const askQuestionOverride = {} as Component<PermissionRendererProps>;

const blockRegistrations: RendererRegistration[] = [
	{ kind: 'tool_use', component: generic },
	{ kind: 'tool_use', toolName: 'Bash', priority: 10, component: bash },
];

const permissionRegistrations: PermissionRendererRegistration[] = [
	{ toolName: 'AskUserQuestion', component: askQuestion },
	{ toolName: 'AskUserQuestion', priority: 5, component: askQuestionOverride },
];

function block(kind: string, toolName: string | null): BlockView {
	return {
		id: 'b1',
		messageId: 'm1',
		kind,
		toolName,
		toolUseId: null,
		text: '',
		inputJson: '',
		content: null,
		completed: false,
	};
}

describe('matchBlockRenderer', () => {
	test('prefers an exact tool match over the kind default', () => {
		expect(matchBlockRenderer(blockRegistrations, block('tool_use', 'Bash'))?.component).toBe(bash);
		expect(matchBlockRenderer(blockRegistrations, block('tool_use', 'Read'))?.component).toBe(generic);
		expect(matchBlockRenderer(blockRegistrations, block('text', null))).toBeUndefined();
	});
});

describe('matchPermissionRenderer', () => {
	test('routes a claimed tool to its highest-priority renderer', () => {
		expect(matchPermissionRenderer(permissionRegistrations, 'AskUserQuestion')?.component).toBe(askQuestionOverride);
	});

	test('leaves unclaimed tools to the fallback card', () => {
		expect(matchPermissionRenderer(permissionRegistrations, 'Bash')).toBeUndefined();
		expect(matchPermissionRenderer([], 'AskUserQuestion')).toBeUndefined();
	});
});
