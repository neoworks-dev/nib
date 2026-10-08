import { sveltekit } from "@sveltejs/kit/vite";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vite";

/**
 * Watches the workspace's plugins and packages as directories. Vite watches a
 * file outside its root on its own, and under Bun that watch goes silent once
 * an editor saves by renaming a new copy over the file, so the edit never
 * hot-reloads. A directory watch sees the rename.
 */
function watchWorkspace(): Plugin {
  return {
    name: "nib:watch-workspace",
    configureServer(server) {
      server.watcher.add([
        fileURLToPath(new URL("../../plugins", import.meta.url)),
        fileURLToPath(new URL("../../packages", import.meta.url)),
      ]);
    },
  };
}

export default defineConfig({
  plugins: [tailwindcss(), sveltekit(), watchWorkspace()],
  // Keep the shared harness out of the build graph: it spawns its adapters from
  // paths inside its own package, so the server bundle requires it from
  // node_modules, and the client never sees it.
  ssr: {
    external: ["@neoworks/harness"],
    // Workspace packages ship TypeScript sources; Vite has to compile them
    // instead of handing extensionless imports to the Node resolver.
    noExternal: [/^@nib-ui\//],
  },
});
