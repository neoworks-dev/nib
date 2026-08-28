import type { Plugin } from '@nib-ui/kernel';
import { createCodexAdapter } from './adapter';

export const codexPlugin: Plugin = {
	name: 'codex',
	inject: ['harnesses'],
	apply(ctx) {
		const harnesses = ctx.require('harnesses');
		ctx.effect(() => harnesses.register(createCodexAdapter()));
	},
};
