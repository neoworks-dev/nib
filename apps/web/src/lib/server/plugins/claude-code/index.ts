import type { Plugin } from '@nib-ui/kernel';
import { createClaudeCodeAdapter } from './adapter';

export const claudeCodePlugin: Plugin = {
	name: 'claude-code',
	inject: ['harnesses'],
	apply(ctx) {
		const harnesses = ctx.require('harnesses');
		ctx.effect(() => harnesses.register(createClaudeCodeAdapter()));
	},
};
