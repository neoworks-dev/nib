// The isolated profile a session runs on, and the demo project it opens.
//
// nib keeps its config under XDG_CONFIG_HOME/nib and its sessions, boards and
// assets under XDG_DATA_HOME/nib-ui. Pointing both into `.nib-debug/profile`
// means the user's own instance keeps its state while this one runs beside it.
// HOME stays real, so the harnesses (claude, codex, pi) are still logged in.

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { paths } from "./paths.ts";

export interface Profile {
  configHome: string;
  dataHome: string;
  cacheHome: string;
  /** The project the app opens on start: a small vault with a git history. */
  project: string;
}

/** The profile's directories. Nothing is created. */
export function profile(): Profile {
  return {
    configHome: join(paths.profile, "config"),
    dataHome: join(paths.profile, "data"),
    cacheHome: join(paths.profile, "cache"),
    project: join(paths.profile, "demo"),
  };
}

/** The environment that points the app, and everything it spawns, at the profile. */
export function profileEnvironment(target: Profile): Record<string, string> {
  return {
    XDG_CONFIG_HOME: target.configHome,
    XDG_DATA_HOME: target.dataHome,
    XDG_CACHE_HOME: target.cacheHome,
  };
}

/** The line in /proc/<pid>/environ that marks a process as belonging to the profile. */
export function profileMarker(target: Profile): string {
  return `XDG_CONFIG_HOME=${target.configHome}`;
}

/**
 * Create the profile if it is missing: its directories, the demo project, and
 * a config that reopens that project on start. An existing profile is left as
 * it is, so a restarted session picks up where the last one was.
 */
export function prepareProfile(target: Profile): void {
  mkdirSync(target.configHome, { recursive: true });
  mkdirSync(target.dataHome, { recursive: true });
  mkdirSync(target.cacheHome, { recursive: true });
  if (!existsSync(target.project)) createDemoProject(target.project);

  const configPath = join(target.configHome, "nib", "config.json");
  if (existsSync(configPath)) return;
  mkdirSync(join(target.configHome, "nib"), { recursive: true });
  const config = { defaultModels: {}, lastProject: target.project };
  writeFileSync(configPath, `${JSON.stringify(config, null, "\t")}\n`, "utf8");
}

/** Throw the profile away, demo project included. */
export async function resetProfile(): Promise<void> {
  await rm(paths.profile, { recursive: true, force: true });
}

/** Markdown the demo vault starts with: enough for folders, links and a sticky. */
const DEMO_FILES: Record<string, string> = {
  "README.md": "# Demo project\n\nA vault for the debug harness. See [[notes/ideas]].\n",
  "notes/ideas.md": "# Ideas\n\n- a card per file\n- links between them: [[README]]\n",
  "notes/todo.md": "# Todo\n\n- [ ] try the board\n- [x] open the demo\n",
  "assets/palette.md": "# Palette\n\n| name | hex |\n| --- | --- |\n| ink | #141416 |\n",
};

/**
 * Write the demo vault into the project's `.nib/`, which is what the board
 * draws, and commit it so the git panes have a history to show.
 */
function createDemoProject(root: string): void {
  for (const [relativePath, contents] of Object.entries(DEMO_FILES)) {
    const path = join(root, ".nib", relativePath);
    mkdirSync(join(path, ".."), { recursive: true });
    writeFileSync(path, contents, "utf8");
  }
  const git = (...args: string[]): void => {
    spawnSync("git", ["-C", root, ...args], { stdio: "ignore" });
  };
  git("init", "--initial-branch", "main");
  git("add", ".");
  git(
    "-c",
    "user.name=nib debug",
    "-c",
    "user.email=debug@nib.invalid",
    "commit",
    "-m",
    "Demo project",
  );
}
