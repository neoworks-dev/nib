// Building and launching the desktop app for a session.
//
// The built app rather than the dev server, because that is what ships and the
// two do not fail the same way: production serves the SvelteKit build through
// the `app://` protocol in-process, development talks to Vite over a socket.

import { spawn, spawnSync } from "node:child_process";
import { existsSync, openSync } from "node:fs";
import { join } from "node:path";
import { displayEnvironment } from "./display.ts";
import { paths, repoRoot } from "./paths.ts";
import { type Profile, profileEnvironment } from "./profile.ts";

const desktopDir = join(repoRoot, "apps", "desktop");
const webBuildEntry = join(repoRoot, "apps", "web", "build", "entry.js");
const mainBuildEntry = join(desktopDir, "out", "main", "index.js");

/** Build the web app, then the Electron main and preload processes. */
export function build(): void {
  console.log("building…");
  const web = spawnSync("bun", ["run", "build"], { cwd: repoRoot, stdio: "inherit" });
  if (web.status !== 0) throw new Error("the web build failed");
  const desktop = spawnSync("bun", ["run", "build"], { cwd: desktopDir, stdio: "inherit" });
  if (desktop.status !== 0) throw new Error("the desktop build failed");
}

/** Throw unless both halves of the app have been built. */
export function requireBuild(): void {
  if (existsSync(webBuildEntry) && existsSync(mainBuildEntry)) return;
  throw new Error('no build to launch — "bun run debug start --build"');
}

/** Start Electron on the display and profile, detached, and return its pid. */
export function launchApp(target: Profile, display: string, port: number): number {
  const log = openSync(paths.appLog, "a");
  const environment: Record<string, string> = {
    ...(process.env as Record<string, string>),
    ...profileEnvironment(target),
    ...displayEnvironment(display),
  };
  delete environment.WAYLAND_DISPLAY;
  // Set by the dev script; left in, the built app would load a dev server URL.
  delete environment.NIB_APP_URL;

  const child = spawn(
    join(repoRoot, "node_modules", ".bin", "electron"),
    [
      // The package directory, not out/main/index.js: Electron takes the app
      // name, and with it the userData directory, from the package.json beside
      // the entry point.
      desktopDir,
      `--remote-debugging-port=${port}`,
      // Chromium refuses a devtools websocket from an unlisted origin, and
      // Playwright's CDP connection sends one.
      "--remote-allow-origins=*",
      // The virtual display has no pointer device, so Chromium reports
      // `hover: none` and every `hover:` rule is dead. Declare a mouse.
      "--blink-settings=primaryHoverType=2,availableHoverTypes=2,primaryPointerType=4,availablePointerTypes=4",
      // Xvnc has no GPU, so Chromium blocklists WebGL and Pixi finds no
      // renderer at all — the board stays blank. SwiftShader is Chromium's
      // software GL, and is slow but draws.
      "--use-gl=angle",
      "--use-angle=swiftshader",
      "--enable-unsafe-swiftshader",
      "--ignore-gpu-blocklist",
    ],
    { cwd: repoRoot, env: environment, detached: true, stdio: ["ignore", log, log] },
  );
  child.unref();
  if (child.pid === undefined) throw new Error(`electron did not start — see ${paths.appLog}`);
  return child.pid;
}

/** Wait until Electron's devtools endpoint answers. */
export async function waitForDebugPort(port: number): Promise<void> {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (response.ok) return;
    } catch {
      // Not up yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`the app never opened its debug port — see ${paths.appLog}`);
}
