import { plugin, Transpiler } from 'bun';
import { compileModule } from 'svelte/compiler';

/**
 * `bun test` has no Svelte pipeline of its own, so a `.svelte.ts` module — a
 * reactive store, not a component — would hit `$state` as an undefined global.
 * Types come off first: the rune compiler parses JavaScript only.
 */
const typescript = new Transpiler({ loader: 'ts' });

plugin({
	name: 'svelte-runes',
	setup(build) {
		build.onLoad({ filter: /\.svelte\.(ts|js)$/ }, async (args) => {
			const source = await Bun.file(args.path).text();
			const script = args.path.endsWith('.ts') ? typescript.transformSync(source) : source;
			return { contents: compileModule(script, { filename: args.path, generate: 'client' }).js.code, loader: 'js' };
		});
	},
});
