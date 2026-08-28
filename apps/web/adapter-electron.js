import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Runtime dependencies that must stay real files on disk: both SDKs locate and
 * spawn their own CLI relative to their package directory, which a bundle breaks.
 */
const external = ['@anthropic-ai/claude-agent-sdk', '@openai/codex-sdk'];

/**
 * Emits `build/client` plus a single bundled `build/entry.js` exporting
 * `respond(request): Promise<Response>`. The Electron main process serves both
 * through a custom `app://` protocol, so the packaged app never opens a socket.
 */
export default function adapter({ out = 'build' } = {}) {
	return {
		name: 'adapter-electron',
		async adapt(builder) {
			const tmp = builder.getBuildDirectory('adapter-electron');
			builder.rimraf(out);
			builder.rimraf(tmp);
			builder.mkdirp(tmp);

			const base = builder.config.kit.paths.base;
			builder.writeClient(`${out}/client${base}`);
			builder.writePrerendered(`${out}/prerendered${base}`);
			builder.writeServer(`${tmp}/server`);

			writeFileSync(
				`${tmp}/manifest.js`,
				`export const manifest = ${builder.generateManifest({ relativePath: './server' })};\n`,
			);

			writeFileSync(
				`${tmp}/entry.js`,
				`import { Server } from ${JSON.stringify(resolve(tmp, 'server/index.js'))};
import { manifest } from ${JSON.stringify(resolve(tmp, 'manifest.js'))};

export const base = ${JSON.stringify(base)};
export const prerendered = new Set(${JSON.stringify(builder.prerendered.paths)});

const server = new Server(manifest);
let initialized;

export async function respond(request) {
	initialized ??= server.init({ env: process.env });
	await initialized;
	return server.respond(request, { getClientAddress: () => '127.0.0.1' });
}
`,
			);

			builder.log.minor('Bundling server');
			const bundle = await Bun.build({
				entrypoints: [`${tmp}/entry.js`],
				outdir: out,
				target: 'node',
				format: 'esm',
				external,
			});
			if (!bundle.success) {
				throw new AggregateError(bundle.logs, 'adapter-electron: bundling the server failed');
			}

			builder.log.minor(`Wrote ${out}/entry.js`);
		},
	};
}
