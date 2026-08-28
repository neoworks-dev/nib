import type { Plugin } from '@nib-ui/kernel';
import { createNibAdapter } from './adapter';
import { NibServer } from './server';

export const nibPlugin: Plugin = {
	name: 'nib',
	inject: ['harnesses'],
	apply(ctx) {
		const harnesses = ctx.require('harnesses');
		const server = new NibServer();
		ctx.effect(() => {
			const dispose = harnesses.register(createNibAdapter(server));
			return () => {
				dispose();
				void server.stop();
			};
		});
	},
};
