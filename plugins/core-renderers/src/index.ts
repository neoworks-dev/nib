import type { Plugin } from '@nib-ui/kernel';
import { askUserQuestionToolName } from '@nib-ui/protocol';
import AskQuestionCard from './AskQuestionCard.svelte';
import FoldedResultBlock from './FoldedResultBlock.svelte';
import ImageBlock from './ImageBlock.svelte';
import ReadBlock from './ReadBlock.svelte';
import TextBlock from './TextBlock.svelte';
import ThinkingBlock from './ThinkingBlock.svelte';
import ToolUseBlock from './ToolUseBlock.svelte';

const readTools = ['Read', 'NotebookRead'];

export const coreRenderersPlugin: Plugin = {
	name: 'core-renderers',
	inject: ['renderers'],
	apply(ctx) {
		const renderers = ctx.require('renderers');
		ctx.effect(() => renderers.register({ kind: 'text', component: TextBlock }));
		ctx.effect(() => renderers.register({ kind: 'thinking', component: ThinkingBlock }));
		ctx.effect(() => renderers.register({ kind: 'tool_use', component: ToolUseBlock }));
		// A result belongs to the call that made it, and the turn already shows that
		// call: only an orphan or a failure earns a row of its own.
		ctx.effect(() => renderers.register({ kind: 'tool_result', component: FoldedResultBlock }));
		ctx.effect(() => renderers.register({ kind: 'image', component: ImageBlock }));
		for (const toolName of readTools) {
			ctx.effect(() => renderers.register({ kind: 'tool_use', toolName, priority: 10, component: ReadBlock }));
		}
		ctx.effect(() =>
			renderers.registerPermission({ toolName: askUserQuestionToolName, component: AskQuestionCard }),
		);
	},
};
