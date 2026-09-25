// A display of its own for the session, that a person can watch with vncviewer.
//
// Windows opening on the desktop the user is working on is unusable, and the
// window cannot simply stay hidden: an unmapped window has a hidden document,
// Chromium stops requestAnimationFrame, and the Pixi board never gets a frame.
// So it needs a real X display somewhere else. Xvnc (tigervnc) is that display
// and a VNC server in one, so `vncviewer :90` shows the run as it happens.

import { spawn } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { isRunning } from "./processes.ts";

export const GEOMETRY = { width: 1440, height: 900, depth: 24 };

/**
 * The numbers reserved for debug displays. The user's own is far below this,
 * and Grove's QA harness holds :90–:99.
 */
const DISPLAY_RANGE = { first: 100, last: 109 };

export interface VirtualDisplay {
  /** What to put in DISPLAY, and what to hand vncviewer. */
  display: string;
  pid: number;
}

/** Bring up an Xvnc display that outlives this process, or throw why not. */
export async function startDisplay(): Promise<VirtualDisplay> {
  if (!hasCommand("Xvnc")) {
    throw new Error("Xvnc is not installed — sudo pacman -S tigervnc");
  }
  reapAbandonedDisplays();

  const number = freeDisplayNumber();
  if (number === null) {
    throw new Error(
      `every display from :${DISPLAY_RANGE.first} to :${DISPLAY_RANGE.last} is taken`,
    );
  }

  const display = `:${number}`;
  // Loopback only and no password: this is a display for a local debug run,
  // not a remote desktop. AlwaysShared lets a viewer attach without kicking
  // another one off.
  const server = spawn(
    "Xvnc",
    [
      display,
      "-geometry",
      `${GEOMETRY.width}x${GEOMETRY.height}`,
      "-depth",
      String(GEOMETRY.depth),
      "-SecurityTypes",
      "None",
      "-localhost",
      "-AlwaysShared",
    ],
    { stdio: "ignore", detached: true },
  );
  server.on("error", () => {
    // Reported by the readiness check below, which decides the outcome.
  });

  const ready = await waitForSocket(number);
  if (!ready || server.pid === undefined) {
    server.kill("SIGKILL");
    throw new Error(`Xvnc did not come up on ${display}`);
  }
  server.unref();
  return { display, pid: server.pid };
}

/** Stop a display started earlier, and clean up its lock and socket. */
export function stopDisplay(display: string, pid: number): void {
  const number = Number(display.replace(":", ""));
  if (!Number.isInteger(number)) return;
  if (pid > 0) {
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      // Already gone, which is the outcome either way.
    }
  }
  removeDisplayFiles(number);
}

/**
 * The environment a child needs to land on `display` rather than the desktop.
 *
 * Electron picks Wayland on a Wayland session and ignores DISPLAY entirely, so
 * the hint and the session type both have to say x11.
 */
export function displayEnvironment(display: string): Record<string, string> {
  return {
    DISPLAY: display,
    ELECTRON_OZONE_PLATFORM_HINT: "x11",
    XDG_SESSION_TYPE: "x11",
  };
}

/** Whether an executable of this name is on PATH. */
export function hasCommand(command: string): boolean {
  for (const directory of (process.env.PATH ?? "").split(":")) {
    if (directory && existsSync(`${directory}/${command}`)) return true;
  }
  return false;
}

/**
 * Remove the lock and socket of every display whose server has died.
 *
 * An X server deletes both on the way out, and does not get the chance when
 * the run holding it is killed. Ten interrupted runs would otherwise take the
 * whole range.
 */
function reapAbandonedDisplays(): void {
  for (let number = DISPLAY_RANGE.first; number <= DISPLAY_RANGE.last; number += 1) {
    const owner = lockOwner(number);
    if (owner === null) continue;
    if (isRunning(owner)) continue;
    removeDisplayFiles(number);
  }
}

/** The pid written into a display's lock file, or null if there is no usable lock. */
function lockOwner(number: number): number | null {
  try {
    const pid = Number(readFileSync(lockPath(number), "utf8").trim());
    if (!Number.isInteger(pid) || pid <= 0) return null;
    return pid;
  } catch {
    return null;
  }
}

/** Delete a display's lock file and socket. */
function removeDisplayFiles(number: number): void {
  rmSync(lockPath(number), { force: true });
  rmSync(socketPath(number), { force: true });
}

/** The first display number nothing else has claimed. */
function freeDisplayNumber(): number | null {
  for (let number = DISPLAY_RANGE.first; number <= DISPLAY_RANGE.last; number += 1) {
    if (!existsSync(socketPath(number)) && !existsSync(lockPath(number))) return number;
  }
  return null;
}

/** Wait for the server to publish its socket, which is when clients can connect. */
async function waitForSocket(number: number): Promise<boolean> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (existsSync(socketPath(number))) return true;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return false;
}

/** The X socket for a display number. */
function socketPath(number: number): string {
  return `/tmp/.X11-unix/X${number}`;
}

/** The X lock file for a display number. */
function lockPath(number: number): string {
  return `/tmp/.X${number}-lock`;
}
