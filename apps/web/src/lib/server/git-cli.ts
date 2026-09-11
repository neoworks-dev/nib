export interface GitFileChange {
  path: string;
  /** Porcelain v1 codes: index column, worktree column. `?` means untracked. */
  indexStatus: string;
  worktreeStatus: string;
  staged: boolean;
  added: number;
  removed: number;
}

export interface GitStatus {
  repository: boolean;
  branch: string | null;
  ahead: number;
  behind: number;
  files: GitFileChange[];
}

export interface GitCommitResult {
  ok: boolean;
  output: string;
}

export interface GitLogEntry {
  hash: string;
  shortHash: string;
  parents: string[];
  authorName: string;
  /** ISO-8601 with offset, e.g. `2026-08-21T01:57:03+02:00`. */
  authorDate: string;
  subject: string;
  /** Short ref names decorating the commit, e.g. `HEAD`, `main`, `origin/main`, `v3.6`. */
  refs: string[];
}

/** Unit/record separators: neither can appear in a commit message. */
const fieldSeparator = "\x1f";
const recordSeparator = "\x1e";

async function git(
  cwd: string,
  args: string[],
): Promise<{ ok: boolean; stdout: string; stderr: string }> {
  const child = Bun.spawn(["git", ...args], { cwd, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  return { ok: code === 0, stdout, stderr };
}

export async function status(cwd: string): Promise<GitStatus> {
  const porcelain = await git(cwd, [
    "status",
    "--porcelain=v1",
    "--branch",
    "--untracked-files=all",
  ]);
  if (!porcelain.ok) return { repository: false, branch: null, ahead: 0, behind: 0, files: [] };

  const [staged, worktree] = await Promise.all([numstat(cwd, ["--cached"]), numstat(cwd, [])]);
  const lines = porcelain.stdout.split("\n").filter((line) => line.length > 0);
  const header = lines.find((line) => line.startsWith("## ")) ?? "";

  const files = lines
    .filter((line) => !line.startsWith("## "))
    .map((line) => toChange(line, staged, worktree));

  return {
    repository: true,
    branch: parseBranch(header),
    ahead: parseCount(header, "ahead"),
    behind: parseCount(header, "behind"),
    files,
  };
}

/** `HEAD` while detached, `null` when the directory is not a repository. */
export async function branch(cwd: string): Promise<string | null> {
  const result = await git(cwd, ["rev-parse", "--abbrev-ref", "HEAD"]);
  if (!result.ok) return null;
  const name = result.stdout.trim();
  return name.length > 0 ? name : null;
}

export async function diff(cwd: string, path: string, staged: boolean): Promise<string> {
  const args = ["diff", "--no-color", ...(staged ? ["--cached"] : []), "--", path];
  const result = await git(cwd, args);
  if (result.stdout.trim().length > 0) return result.stdout;
  // An untracked file has nothing to diff against; show it as an addition.
  const untracked = await git(cwd, ["diff", "--no-color", "--no-index", "/dev/null", path]);
  return untracked.stdout;
}

export async function stage(cwd: string, paths: string[]): Promise<GitCommitResult> {
  const result = await git(cwd, ["add", "--", ...paths]);
  return { ok: result.ok, output: result.stderr || result.stdout };
}

export async function unstage(cwd: string, paths: string[]): Promise<GitCommitResult> {
  const result = await git(cwd, ["restore", "--staged", "--", ...paths]);
  return { ok: result.ok, output: result.stderr || result.stdout };
}

/** Commits what is staged; `paths` stages those files first. */
export async function commit(
  cwd: string,
  message: string,
  paths: string[] = [],
): Promise<GitCommitResult> {
  if (paths.length > 0) {
    const staged = await stage(cwd, paths);
    if (!staged.ok) return staged;
  }
  const result = await git(cwd, ["commit", "-m", message]);
  return { ok: result.ok, output: result.stdout || result.stderr };
}

export async function log(cwd: string, limit: number): Promise<GitLogEntry[]> {
  const format = ["%H", "%h", "%P", "%an", "%ad", "%s", "%D"].join("%x1f") + "%x1e";
  const result = await git(cwd, [
    "log",
    "--parents",
    "--decorate=full",
    "--date=iso-strict",
    `--max-count=${limit}`,
    `--pretty=format:${format}`,
  ]);
  if (!result.ok) return [];

  const entries: GitLogEntry[] = [];
  for (const record of result.stdout.split(recordSeparator)) {
    // Git joins records with a newline, so every record but the first is prefixed by one.
    const fields = record.trimStart().split(fieldSeparator);
    if (fields.length < 7) continue;

    entries.push({
      hash: fields[0]!,
      shortHash: fields[1]!,
      parents: fields[2]!.split(" ").filter((parent) => parent.length > 0),
      authorName: fields[3]!,
      authorDate: fields[4]!,
      subject: fields[5]!,
      refs: parseRefs(fields[6]!),
    });
  }
  return entries;
}

/** `%D` under `--decorate=full` reads `HEAD -> refs/heads/main, refs/tags/v3.6`. */
function parseRefs(decoration: string): string[] {
  return decoration
    .split(",")
    .flatMap((ref) => ref.split("->"))
    .map((ref) => ref.trim().replace(/^refs\/(heads|remotes|tags)\//, ""))
    .filter((ref) => ref.length > 0);
}

async function numstat(
  cwd: string,
  extra: string[],
): Promise<Map<string, { added: number; removed: number }>> {
  const result = await git(cwd, ["diff", "--numstat", ...extra]);
  const stats = new Map<string, { added: number; removed: number }>();
  if (!result.ok) return stats;

  for (const line of result.stdout.split("\n")) {
    const [added, removed, path] = line.split("\t");
    if (!path) continue;
    stats.set(path, { added: toCount(added), removed: toCount(removed) });
  }
  return stats;
}

function toChange(
  line: string,
  staged: Map<string, { added: number; removed: number }>,
  worktree: Map<string, { added: number; removed: number }>,
): GitFileChange {
  const indexStatus = line[0] ?? " ";
  const worktreeStatus = line[1] ?? " ";
  const rest = line.slice(3);
  // A rename reads `old -> new`; the new path is the one worth showing.
  const path = rest.includes(" -> ") ? rest.slice(rest.indexOf(" -> ") + 4) : rest;
  const stats = staged.get(path) ?? worktree.get(path) ?? { added: 0, removed: 0 };

  return {
    path,
    indexStatus,
    worktreeStatus,
    staged: indexStatus !== " " && indexStatus !== "?",
    added: stats.added,
    removed: stats.removed,
  };
}

function parseBranch(header: string): string | null {
  const name = header.slice(3).split("...")[0]?.split(" ")[0];
  return name && name.length > 0 ? name : null;
}

function parseCount(header: string, key: "ahead" | "behind"): number {
  const match = new RegExp(`${key} (\\d+)`).exec(header);
  return match ? Number(match[1]) : 0;
}

function toCount(value: string | undefined): number {
  const count = Number(value);
  return Number.isFinite(count) ? count : 0;
}
