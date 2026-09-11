import { sveltekit } from "@sveltejs/kit/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [tailwindcss(), sveltekit()],
  // Keep the harness SDKs out of the build graph: the server bundle requires them
  // from node_modules and the client never sees them. pi in particular pulls in
  // `undici` and its own extension loader, neither of which survives bundling.
  ssr: {
    external: [
      "@anthropic-ai/claude-agent-sdk",
      "@earendil-works/pi-ai",
      "@earendil-works/pi-coding-agent",
    ],
    // Workspace packages ship TypeScript sources; Vite has to compile them
    // instead of handing extensionless imports to the Node resolver.
    noExternal: [/^@nib-ui\//],
  },
});
