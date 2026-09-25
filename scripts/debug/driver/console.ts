// What the renderer complains about, kept where the next command can read it.
//
// The driver connects for one action at a time, and both Playwright's console
// events and CDP's reports only reach a connected client. A ring buffer on
// `window` outlives the connection, which is what makes "what did it complain
// about while I was not looking" answerable at all.

import type { CDPSession, Page } from "playwright-core";
import type { ConsoleEntry, NibWindow } from "./window.ts";

/** Everything the renderer has logged since the capture went in. */
export async function consoleLog(page: Page): Promise<ConsoleEntry[]> {
  await installConsoleCapture(page);
  return page.evaluate(() => (window as unknown as NibWindow).__debug_console ?? []);
}

/** Patch `console` and the error events to append to a buffer on `window`, once. */
export async function installConsoleCapture(page: Page): Promise<void> {
  await page
    .evaluate(() => {
      const view = window as unknown as NibWindow;
      if (view.__debug_console) return;
      const entries: ConsoleEntry[] = [];
      view.__debug_console = entries;

      const record = (level: string, text: string): void => {
        // The same fault often arrives twice — `window.onerror` and CDP's
        // exception report are the same throw — so a repeat of the last line
        // within a second is dropped.
        const last = entries[entries.length - 1];
        const now = Date.now();
        if (last && last.level === level && last.text === text && now - last.atMs < 1000) return;
        entries.push({ level, at: new Date(now).toISOString(), atMs: now, text });
        if (entries.length > 500) entries.splice(0, entries.length - 500);
      };
      view.__debug_record = record;

      const format = (args: unknown[]): string =>
        args
          .map((argument) => {
            if (typeof argument === "string") return argument;
            try {
              return JSON.stringify(argument);
            } catch {
              return String(argument);
            }
          })
          .join(" ");

      for (const level of ["log", "info", "warn", "error"] as const) {
        const original = console[level].bind(console);
        console[level] = (...args: unknown[]): void => {
          record(level, format(args));
          original(...args);
        };
      }
      window.addEventListener("error", (event) => record("error", event.message));
      window.addEventListener("unhandledrejection", (event) =>
        record("error", `unhandled rejection: ${format([event.reason])}`),
      );
    })
    .catch(() => undefined);
}

/**
 * Push what Chromium knows and the page never logs — a failed request, a CSP
 * violation, an uncaught throw — into the page's buffer while this action runs.
 */
export async function attachErrorDrain(page: Page): Promise<{ detach: () => Promise<void> }> {
  const record = (level: string, text: string): void => {
    void page
      .evaluate(
        (entry) => (window as unknown as NibWindow).__debug_record?.(entry.level, entry.text),
        {
          level,
          text,
        },
      )
      .catch(() => undefined);
  };

  let session: CDPSession;
  try {
    session = await page.context().newCDPSession(page);
  } catch {
    // A page that went away mid-connection: the console patch still holds.
    return { detach: () => Promise.resolve() };
  }

  session.on("Log.entryAdded", (event) => {
    let level = "warn";
    if (event.entry.level === "error") level = "error";
    let text = `${event.entry.source}: ${event.entry.text}`;
    if (event.entry.url) text = `${text} (${event.entry.url})`;
    record(level, text);
  });
  session.on("Runtime.exceptionThrown", (event) => {
    const details = event.exceptionDetails;
    let text = details.text;
    if (details.exception?.description) text = details.exception.description;
    record("error", text);
  });
  await session.send("Log.enable").catch(() => undefined);
  await session.send("Runtime.enable").catch(() => undefined);

  return { detach: () => session.detach() };
}
