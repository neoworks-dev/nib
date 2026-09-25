// The half of the debug harness that touches the app, over the devtools port
// the session was launched with.
//
// Runs under **node**, not bun: `connectOverCDP` never completes its websocket
// handshake under bun. It is invoked once per action and keeps nothing in
// memory between calls; refs handed out by `probe` survive as a file on disk.
//
//   node scripts/debug/driver/main.ts <port> <refsPath> '<commandJson>'

import type { Page } from "playwright-core";
import {
  type Command,
  click,
  drag,
  evaluate,
  hover,
  key,
  paste,
  type Photographer,
  pictureRequest,
  scroll,
  shot,
  type,
  wait,
} from "./actions.ts";
import { connect, rendererPage } from "./connect.ts";
import { attachErrorDrain, consoleLog, installConsoleCapture } from "./console.ts";
import { pane, paneTypes } from "./panes.ts";
import { installPointerTracking, photograph as takePicture } from "./pictures.ts";
import { probe, snapshot } from "./probe.ts";
import type { NibWindow } from "./window.ts";

/** Parse the command line, run one command, print its JSON result. */
async function main(): Promise<void> {
  const [portArgument, refsPath, commandJson] = process.argv.slice(2);
  if (!portArgument || !refsPath || !commandJson) {
    throw new Error("usage: main.ts <port> <refsPath> <commandJson>");
  }
  const command: Command = JSON.parse(commandJson);
  const browser = await connect(Number(portArgument));
  const page = rendererPage(browser);

  const result = await run(page, refsPath, command);
  console.log(JSON.stringify(result ?? { ok: true }, null, 2));
  // Not `browser.close()`: on a CDP connection that closes the app itself.
  process.exit(0);
}

/**
 * Run one command, and photograph the result if it asked for that.
 *
 * Same connection, deliberately: a menu opened by a click can close again when
 * the driver disconnects, and a screenshot taken by the next invocation would
 * show a screen the action never produced.
 */
async function run(page: Page, refsPath: string, command: Command): Promise<unknown> {
  // Before the action: the errors worth catching are the ones it causes.
  await installConsoleCapture(page);
  await installPointerTracking(page);
  const drain = await attachErrorDrain(page);

  const screenshot = command.screenshot;
  let photograph: Photographer = () => Promise.resolve();
  if (typeof screenshot === "string") {
    photograph = () => takePicture(page, screenshot, pictureRequest(command));
  }

  const result = await perform(page, refsPath, command, photograph);
  // A held drag has already been photographed, with the button still down.
  if (command.hold !== true) await photograph();
  await drain.detach().catch(() => undefined);
  if (typeof screenshot !== "string") return result;
  return { ...(result as Record<string, unknown>), screenshot };
}

/** Dispatch a command to the action that carries it out. */
function perform(
  page: Page,
  refsPath: string,
  command: Command,
  photograph: Photographer,
): Promise<unknown> {
  if (command.action === "ready") return ready(page, refsPath, Number(command.timeout ?? 60_000));
  if (command.action === "console") return consoleLog(page);
  if (command.action === "probe") return probe(page, refsPath, command.filter);
  if (command.action === "panes") return paneTypes(page);
  if (command.action === "pane") return pane(page, refsPath, command);
  if (command.action === "shot") return shot(page, refsPath, command);
  if (command.action === "click") return click(page, refsPath, command);
  if (command.action === "drag") return drag(page, refsPath, command, photograph);
  if (command.action === "hover") return hover(page, refsPath, command);
  if (command.action === "paste") return paste(page, refsPath, command);
  if (command.action === "type") return type(page, command);
  if (command.action === "key") return key(page, command);
  if (command.action === "scroll") return scroll(page, refsPath, command);
  if (command.action === "wait") return wait(page, refsPath, command);
  if (command.action === "eval") return evaluate(page, command);
  throw new Error(`unknown action: ${command.action}`);
}

/**
 * Wait until the app is worth driving: the debug handle is up, the board is
 * mounted, and the demo project has been opened on it.
 */
async function ready(page: Page, refsPath: string, timeout: number): Promise<unknown> {
  await page.waitForFunction(
    () => {
      const debug = (window as unknown as NibWindow).__nib_debug;
      return (
        Boolean(debug?.canvas.vault.cwd) && document.querySelector("[data-pane-root]") !== null
      );
    },
    undefined,
    { timeout },
  );
  return { ready: true, ...(await snapshot(page, refsPath)) };
}

main().catch((error: unknown) => {
  let message = String(error);
  if (error instanceof Error) message = error.message;
  console.error(message.split("\n").slice(0, 6).join("\n"));
  process.exit(1);
});
