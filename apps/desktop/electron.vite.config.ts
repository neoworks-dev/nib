import { defineConfig, externalizeDepsPlugin } from "electron-vite";

// The renderer is the SvelteKit server in apps/web — it owns the agent API routes,
// so electron-vite only builds the main and preload processes here.
export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: { rollupOptions: { input: { index: "src/main/index.ts" } } },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: { index: "src/preload/index.ts" },
        // Sandboxed preload scripts only run CommonJS, so the ESM default would silently fail.
        output: { format: "cjs", entryFileNames: "index.cjs" },
      },
    },
  },
});
