import { documentTheme } from "../src/document-theme.svelte";

/** Reads the theme the way a renderer does: from inside a `$derived`, where state is read-only. */
export function themeReadInDerived(): string {
  const theme = $derived(documentTheme());
  return theme;
}
