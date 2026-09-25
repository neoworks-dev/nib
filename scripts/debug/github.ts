// Writing to GitHub as neoworks-bot: findings, evidence, and the screenshots
// both embed.

import {
  spawnSync,
  type SpawnSyncOptionsWithStringEncoding,
  type SpawnSyncReturns,
} from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { basename } from "node:path";
import { repoRoot } from "./paths.ts";
import { slug, stamp } from "./shots.ts";

/** Where findings are filed, and the label that says a model found them. */
export const FINDINGS_REPO = "neoworks-dev/nib";
export const AI_LABEL = "ai-found";

/**
 * The branch screenshots are committed to.
 *
 * GitHub has no public API for attaching a file to an issue. What works is a
 * URL the body embeds that GitHub's image proxy will fetch: raw.githubusercontent
 * serves a committed PNG as `image/png`, while a release asset comes back as
 * `application/octet-stream` and does not render. A branch of its own keeps
 * them off the default branch.
 */
const SHOT_BRANCH = "debug-screenshots";

/**
 * Run `gh bot`, so what the harness writes shows as neoworks-bot. There is no
 * fallback to plain `gh`: a write under the user's own name is the one outcome
 * CLAUDE.md rules out.
 */
export function github(
  args: string[],
  options: Partial<SpawnSyncOptionsWithStringEncoding> = {},
): SpawnSyncReturns<string> {
  const result = spawnSync("gh", ["bot", ...args], { cwd: repoRoot, ...options, encoding: "utf8" });
  if (result.error) throw new Error(`gh bot could not run: ${result.error.message}`);
  return result;
}

/** Put a screenshot somewhere GitHub will render it from, and return that URL. */
export function uploadScreenshot(path: string): string {
  if (!existsSync(path)) throw new Error(`no such screenshot: ${path}`);
  ensureShotBranch();

  // Under a timestamp: two runs finding the same thing must not overwrite
  // each other's evidence.
  const name = `${stamp()}-${slug(basename(path, ".png"))}.png`;
  // The request goes in on stdin: as a `-f content=…` argument, a full-window
  // screenshot is past Linux's 128 KiB limit on a single argument.
  const request = JSON.stringify({
    message: "debug: screenshot for an issue",
    branch: SHOT_BRANCH,
    content: readFileSync(path).toString("base64"),
  });
  const committed = github(
    ["api", "--method", "PUT", `repos/${FINDINGS_REPO}/contents/shots/${name}`, "--input", "-"],
    { input: request, maxBuffer: 64 * 1024 * 1024 },
  );
  if (committed.status !== 0)
    throw new Error(`could not upload ${path}:\n${committed.stderr.trim()}`);
  return `https://raw.githubusercontent.com/${FINDINGS_REPO}/${SHOT_BRANCH}/shots/${name}`;
}

/** Create the screenshot branch off the repository's default branch, once. */
function ensureShotBranch(): void {
  const found = github(["api", `repos/${FINDINGS_REPO}/git/ref/heads/${SHOT_BRANCH}`]);
  if (found.status === 0) return;

  const repository = github(["api", `repos/${FINDINGS_REPO}`, "--jq", ".default_branch"]);
  if (repository.status !== 0)
    throw new Error(`could not read ${FINDINGS_REPO}:\n${repository.stderr.trim()}`);
  const defaultBranch = repository.stdout.trim();

  const head = github([
    "api",
    `repos/${FINDINGS_REPO}/git/ref/heads/${defaultBranch}`,
    "--jq",
    ".object.sha",
  ]);
  if (head.status !== 0) throw new Error(`could not read ${defaultBranch}:\n${head.stderr.trim()}`);

  const created = github([
    "api",
    "--method",
    "POST",
    `repos/${FINDINGS_REPO}/git/refs`,
    "-f",
    `ref=refs/heads/${SHOT_BRANCH}`,
    "-f",
    `sha=${head.stdout.trim()}`,
  ]);
  if (created.status !== 0) {
    throw new Error(`could not create the screenshot branch:\n${created.stderr.trim()}`);
  }
}

/** Markdown embedding each screenshot, uploaded. */
export function screenshotSection(screenshots: string[]): string | null {
  if (screenshots.length === 0) return null;
  return screenshots
    .map(uploadScreenshot)
    .map((url) => `![screenshot](${url})`)
    .join("\n\n");
}

/** `--body` names a file, or is the text itself. */
export function bodyText(value: string): string {
  if (existsSync(value)) return readFileSync(value, "utf8");
  return value;
}

/** The short hash checked out in a directory. */
export function headCommit(directory: string): string {
  const result = spawnSync("git", ["rev-parse", "--short", "HEAD"], {
    cwd: directory,
    encoding: "utf8",
  });
  if (result.status !== 0) return "an unknown build";
  return result.stdout.trim();
}
