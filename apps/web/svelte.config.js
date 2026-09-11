import { vitePreprocess } from "@sveltejs/vite-plugin-svelte";
import adapter from "./adapter-electron.js";

export default {
  preprocess: vitePreprocess(),
  kit: { adapter: adapter() },
};
