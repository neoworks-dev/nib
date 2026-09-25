import { defineConfig, externalizeDepsPlugin } from "electron-vite";

// The renderer is the SvelteKit server in apps/web — it owns the agent API routes,
// so electron-vite only builds the main and preload processes here.

// electron-builder packages no node_modules, and bun links workspace packages as
// symlinks to raw TypeScript, so anything left external here fails to resolve in
// the packaged app. Bundle the workspace dependency instead.
const workspaceDeps = ["@nib-ui/ui-contracts"];

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin({ exclude: workspaceDeps })],
    build: { rollupOptions: { input: { index: "src/main/index.ts" } } },
  },
  preload: {
    plugins: [externalizeDepsPlugin({ exclude: workspaceDeps })],
    build: {
      rollupOptions: {
        input: { index: "src/preload/index.ts" },
        // Sandboxed preload scripts only run CommonJS, so the ESM default would silently fail.
        output: { format: "cjs", entryFileNames: "index.cjs" },
      },
    },
  },
});
