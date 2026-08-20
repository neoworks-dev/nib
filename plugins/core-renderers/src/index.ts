import type { Plugin } from '@nib-ui/kernel';
import { askUserQuestionToolName } from '@nib-ui/protocol';
import AskQuestionCard from './AskQuestionCard.svelte';
import ImageBlock from './ImageBlock.svelte';
import TextBlock from './TextBlock.svelte';
import ThinkingBlock from './ThinkingBlock.svelte';
import ToolResultBlock from './ToolResultBlock.svelte';
import ToolUseBlock from './ToolUseBlock.svelte';

export const coreRenderersPlugin: Plugin = {
	name: 'core-renderers',
	inject: ['renderers'],
	apply(ctx) {
		const renderers = ctx.require('renderers');
		ctx.effect(() => renderers.register({ kind: 'text', component: TextBlock }));
		ctx.effect(() => renderers.register({ kind: 'thinking', component: ThinkingBlock }));
		ctx.effect(() => renderers.register({ kind: 'tool_use', component: ToolUseBlock }));
		ctx.effect(() => renderers.register({ kind: 'tool_result', component: ToolResultBlock }));
		ctx.effect(() => renderers.register({ kind: 'image', component: ImageBlock }));
		ctx.effect(() =>
			renderers.registerPermission({ toolName: askUserQuestionToolName, component: AskQuestionCard }),
		);
	},
};
