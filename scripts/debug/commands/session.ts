// start, stop, view: bringing a session up, taking it down, and watching it.

import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { rm } from "node:fs/promises";
import type { Command } from "commander";
import { build, launchApp, requireBuild, waitForDebugPort } from "../app.ts";
import { hasCommand, startDisplay, stopDisplay, viewerAddress } from "../display.ts";
import { drive } from "../drive.ts";
import { paths } from "../paths.ts";
import { freePort, killByEnvironment } from "../processes.ts";
import { prepareProfile, profile, profileMarker, resetProfile } from "../profile.ts";
import { clearSession, readSession, requireSession, writeSession } from "../session.ts";
import { printable } from "./output.ts";

/** Register the session commands. */
export function registerSessionCommands(program: Command): void {
  program
    .command("start")
    .description("launch the built app on a VNC display and an isolated profile")
    .option("--fresh", "throw the profile and demo project away first")
    .option("--build", "rebuild the web and desktop app first")
    .action((options: { fresh?: boolean; build?: boolean }) => start(options));

  program
    .command("stop")
    .description("kill the app, everything it spawned, and the display")
    .action(() => stop());

  program
    .command("view")
    .description("open vncviewer on the session's display, for a person to watch")
    .action(() => view());
}

/** Bring up a session: a display, the built app on the profile, a CDP port. */
async function start(options: { fresh?: boolean; build?: boolean }): Promise<void> {
  if (readSession()) {
    console.log('a session is already running — "debug stop" first, or "debug probe" to see it');
    return;
  }
  if (options.fresh) await resetProfile();
  if (options.build) build();
  requireBuild();

  mkdirSync(paths.shots, { recursive: true });
  mkdirSync(paths.reports, { recursive: true });
  const target = profile();
  prepareProfile(target);

  const display = await startDisplay();
  const port = await freePort();
  const appPid = launchApp(target, display.display, port);
  const session = {
    display: display.display,
    displayPid: display.pid,
    appPid,
    port,
    project: target.project,
    startedAt: new Date().toISOString(),
  };
  writeSession(session);
  await rm(paths.pace, { force: true });

  await waitForDebugPort(port);
  const ready = drive(session, { action: "ready", timeout: 90_000 });

  console.log(
    `display:  ${display.display}  (watch it: vncviewer ${viewerAddress(display.display)}, or "bun run debug view")`,
  );
  console.log(`profile:  ${paths.profile}`);
  console.log(`project:  ${target.project}`);
  console.log(`app log:  ${paths.appLog}`);
  console.log("");
  console.log(printable("probe", ready));
}

/** Take the session down: the app, everything it spawned, and the display. */
async function stop(): Promise<void> {
  const session = readSession();
  const killed = killByEnvironment(profileMarker(profile()));
  if (session) stopDisplay(session.display, session.displayPid);
  await clearSession();
  console.log(`stopped ${killed} of the debug profile's processes`);
}

/** Open a VNC viewer on the session's display, detached from this process. */
function view(): void {
  const session = requireSession();
  if (!hasCommand("vncviewer"))
    throw new Error("vncviewer is not installed — sudo pacman -S tigervnc");
  const address = viewerAddress(session.display);
  const viewer = spawn("vncviewer", [address], { stdio: "ignore", detached: true });
  viewer.unref();
  console.log(`vncviewer ${address}`);
}
