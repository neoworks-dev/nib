import adapter from './adapter-electron.js';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

export default {
	preprocess: vitePreprocess(),
	kit: { adapter: adapter() },
};
