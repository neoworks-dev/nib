import { sveltekit } from "@sveltejs/kit/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [tailwindcss(), sveltekit()],
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
