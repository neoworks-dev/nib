// Reaching the app's window over the devtools port the session opened.

import { type Browser, chromium, type Page } from "playwright-core";

/** Attach to Electron's CDP endpoint. */
export function connect(port: number): Promise<Browser> {
  return chromium.connectOverCDP(`http://127.0.0.1:${port}`, { timeout: 15_000 });
}

/**
 * The window the app is in.
 *
 * Electron exposes every WebContents as a page, including any open devtools;
 * nib's own renderer is the one on the `app://nib` origin.
 */
export function rendererPage(browser: Browser): Page {
  for (const context of browser.contexts()) {
    for (const page of context.pages()) {
      if (page.url().startsWith("app://nib")) return page;
    }
  }
  throw new Error("no nib window is open on this CDP port");
}
