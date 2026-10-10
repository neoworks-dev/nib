import { existsSync, mkdirSync, realpathSync, symlinkSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

/**
 * Makes a fresh git worktree runnable: installs dependencies, fetches the
 * Electron binary that bun's install leaves out, and links the design system.
 * Run by the `post-checkout` hook in `.githooks/`, or by hand with
 * `bun scripts/setup-worktree.ts` from inside a worktree.
 */

/** Runs a command in a directory and stops the script if it fails. */
function run(command: string[], cwd: string): string {
  const result = Bun.spawnSync(command, { cwd, stdout: "pipe", stderr: "inherit" });
  if (result.exitCode !== 0) {
    console.error(`[setup-worktree] \`${command.join(" ")}\` failed in ${cwd}`);
    process.exit(result.exitCode);
  }
  return result.stdout.toString().trim();
}

/** The root of the repository this worktree belongs to, where `main` is checked out. */
function mainCheckout(worktree: string): string {
  const commonDirectory = run(
    ["git", "rev-parse", "--path-format=absolute", "--git-common-dir"],
    worktree,
  );
  return dirname(commonDirectory);
}

/**
 * bun runs Electron's postinstall only when it unpacks the package itself, and
 * not when it reuses a store entry, so a worktree can end up with the package
 * and no `dist/`. The installer reads Electron's download cache, so this is
 * instant once any checkout has fetched the binary.
 */
function ensureElectronBinary(worktree: string): void {
  const electronDirectory = join(worktree, "node_modules", "electron");
  if (!existsSync(electronDirectory)) return;
  if (existsSync(join(electronDirectory, "dist"))) return;
  console.log("[setup-worktree] fetching the Electron binary");
  run(["node", "install.js"], electronDirectory);
}

/** Points `node_modules/@neoworks-dev/ui` at the design system the main checkout is linked to. */
function ensureDesignSystemLink(worktree: string, mainRoot: string): void {
  const link = join(worktree, "node_modules", "@neoworks-dev", "ui");
  if (existsSync(link)) return;
  const source = join(mainRoot, "node_modules", "@neoworks-dev", "ui");
  if (!existsSync(source)) {
    console.error(
      `[setup-worktree] ${source} does not resolve; run \`bun link @neoworks-dev/ui\` there`,
    );
    return;
  }
  mkdirSync(dirname(link), { recursive: true });
  symlinkSync(realpathSync(source), link);
}

const worktree = resolve(run(["git", "rev-parse", "--show-toplevel"], process.cwd()));
const mainRoot = mainCheckout(worktree);

if (worktree === mainRoot) {
  console.log("[setup-worktree] this is the main checkout; nothing to do");
  process.exit(0);
}

run(["bun", "install", "--frozen-lockfile"], worktree);
ensureDesignSystemLink(worktree, mainRoot);
ensureElectronBinary(worktree);
console.log(`[setup-worktree] ${worktree} is ready`);
