import { webBrowserState } from "./state.svelte";
import { normalizeUrl } from "./url";

/**
 * Shows a url in the browser. A page already on a tab is brought forward rather
 * than opened twice, and at the tab cap the link takes the tab in front rather
 * than being dropped. Answers whether there is anything to show, so the caller
 * knows not to open an empty pane.
 */
export function showUrl(url: string): boolean {
  const target = normalizeUrl(url);
  if (!target) return false;

  const existing = webBrowserState.tabs.find((tab) => tab.url === target);
  if (existing) {
    webBrowserState.activeId = existing.id;
    return true;
  }
  if (webBrowserState.openTab(target)) return true;

  const active = webBrowserState.activeTab;
  if (!active) return false;
  return webBrowserState.navigate(active.id, target);
}
