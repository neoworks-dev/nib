import svelte from "eslint-plugin-svelte";
import svelteParser from "svelte-eslint-parser";
import tseslint from "typescript-eslint";
import local from "./tools/eslint-local-plugin.js";

/**
 * ESLint is scoped to `.svelte` templates only — the one thing oxlint and Biome cannot do,
 * because they parse `<script>` blocks and ignore the markup. Everything else is oxlint's.
 *
 * No `projectService` anywhere here: type-aware linting through the Svelte parser costs
 * roughly 0.8s per component, and oxlint already covers those rules via tsgolint.
 */
export default [
  {
    ignores: ["**/node_modules/**", "**/.svelte-kit/**", "**/build/**", "**/dist/**", "**/out/**"],
  },
  ...svelte.configs.recommended,
  {
    files: ["**/*.svelte"],
    languageOptions: {
      parser: svelteParser,
      parserOptions: { parser: tseslint.parser },
    },
    plugins: { local },
    rules: {
      "svelte/prefer-style-directive": "error",
      "svelte/prefer-class-directive": "error",
      "local/no-class-ternary": "error",
    },
  },
  ...svelte.configs.prettier,
];
