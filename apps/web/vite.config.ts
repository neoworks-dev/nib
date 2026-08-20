import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

export default defineConfig({
	plugins: [tailwindcss(), sveltekit()],
	// Keep the Agent SDK out of the build graph: the server bundle requires it
	// from node_modules and the client never sees it.
	ssr: { external: ['@anthropic-ai/claude-agent-sdk'] },
});
