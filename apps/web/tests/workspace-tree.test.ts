import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { GitFileChange } from "../src/lib/server/git-cli";
import { listWorkspaceTree } from "../src/lib/server/workspace-tree";

let root = "";

function change(path: string, patch: Partial<GitFileChange> = {}): GitFileChange {
  return {
    path,
    indexStatus: " ",
    worktreeStatus: "M",
    staged: false,
    added: 0,
    removed: 0,
    ...patch,
  };
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "workspace-tree-"));
  mkdirSync(join(root, ".git"));
  mkdirSync(join(root, "node_modules"));
  mkdirSync(join(root, "src"));
  writeFileSync(join(root, ".gitignore"), "");
  writeFileSync(join(root, "readme.md"), "");
  writeFileSync(join(root, "src/main.ts"), "");
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("listWorkspaceTree", () => {
  it("lists directories first, then files, and never .git", async () => {
    const listing = await listWorkspaceTree(root, "");
    expect(listing?.entries.map((entry) => entry.name)).toEqual([
      "node_modules",
      "src",
      ".gitignore",
      "readme.md",
    ]);
  });

  it("keeps dotfiles and dependencies: the project is shown as it is on disk", async () => {
    const listing = await listWorkspaceTree(root, "");
    expect(listing?.entries.some((entry) => entry.name === "node_modules")).toBe(true);
    expect(listing?.entries.some((entry) => entry.name === ".gitignore")).toBe(true);
  });

  it("leaves out what the caller asks it to", async () => {
    const listing = await listWorkspaceTree(root, "", { skip: new Set(["node_modules"]) });
    expect(listing?.entries.map((entry) => entry.name)).toEqual(["src", ".gitignore", "readme.md"]);
  });

  it("lists one level at a time, with paths relative to the root", async () => {
    const listing = await listWorkspaceTree(root, "src");
    expect(listing).toEqual({
      path: "src",
      entries: [{ name: "main.ts", path: "src/main.ts", directory: false, status: null }],
    });
  });

  it("tags a file with its worktree status and its parents as changed subtrees", async () => {
    const listing = await listWorkspaceTree(root, "", { changes: [change("src/main.ts")] });
    const byName = new Map(listing?.entries.map((entry) => [entry.name, entry.status]));
    expect(byName.get("src")).toBe("child");
    expect(byName.get("readme.md")).toBe(null);

    const inner = await listWorkspaceTree(root, "src", { changes: [change("src/main.ts")] });
    expect(inner?.entries[0]?.status).toBe("M");
  });

  it("reports the index status of a staged file", async () => {
    const listing = await listWorkspaceTree(root, "src", {
      changes: [change("src/main.ts", { staged: true, indexStatus: "A", worktreeStatus: " " })],
    });
    expect(listing?.entries[0]?.status).toBe("A");
  });

  it("refuses a path that climbs out of the root", async () => {
    expect(await listWorkspaceTree(root, "../..")).toBeNull();
    expect(await listWorkspaceTree(root, "src/../..")).toBeNull();
  });

  it("is empty rather than broken for a directory that is not there", async () => {
    expect(await listWorkspaceTree(root, "nowhere")).toEqual({ path: "nowhere", entries: [] });
  });
});
