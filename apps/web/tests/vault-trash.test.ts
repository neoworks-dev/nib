/**
 * The recycling bin. A delete has to be reversible, which is why it is a move into
 * `.nib/.trash` rather than an unlink: these tests pin the round trip, including
 * the case the reversal has to survive — the path being taken again while the
 * entry sat in the bin.
 */

import { afterEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { TRASH_DIRECTORY, VAULT_DIRECTORY } from "@nib-ui/vault";
import {
  listTrash,
  purgeTrash,
  restoreTrashEntry,
  trashVaultEntry,
} from "../src/lib/server/vault-trash";
import { VaultWriteError } from "../src/lib/server/vault-write";

const created: string[] = [];

afterEach(() => {
  for (const root of created.splice(0)) rmSync(root, { recursive: true, force: true });
});

function project(files: Record<string, string> = {}): string {
  const root = mkdtempSync(join(tmpdir(), "nib-vault-trash-"));
  created.push(root);
  mkdirSync(join(root, VAULT_DIRECTORY), { recursive: true });

  for (const [path, body] of Object.entries(files)) {
    const absolute = join(root, VAULT_DIRECTORY, path);
    mkdirSync(dirname(absolute), { recursive: true });
    writeFileSync(absolute, body);
  }
  return root;
}

function vaultPath(root: string, path: string): string {
  return join(root, VAULT_DIRECTORY, path);
}

describe("trashVaultEntry", () => {
  it("moves the file out of the vault and files where it came from", async () => {
    const root = project({ "topic/note.md": "body" });

    const entry = await trashVaultEntry(root, "topic/note.md");

    expect(entry).toMatchObject({ path: "topic/note.md", name: "note.md", kind: "file" });
    expect(existsSync(vaultPath(root, "topic/note.md"))).toBe(false);
    expect(
      readFileSync(join(root, VAULT_DIRECTORY, TRASH_DIRECTORY, entry.id, "note.md"), "utf8"),
    ).toBe("body");
  });

  it("takes a topic with everything inside it", async () => {
    const root = project({ "topic/note.md": "body", "topic/deep/other.md": "more" });

    const entry = await trashVaultEntry(root, "topic");

    expect(entry.kind).toBe("topic");
    expect(existsSync(vaultPath(root, "topic"))).toBe(false);
    const binned = join(root, VAULT_DIRECTORY, TRASH_DIRECTORY, entry.id, "topic");
    expect(readFileSync(join(binned, "deep/other.md"), "utf8")).toBe("more");
  });

  it("refuses a path that is not there, and one that climbs out", async () => {
    const root = project();

    await expect(trashVaultEntry(root, "gone.md")).rejects.toThrow(VaultWriteError);
    await expect(trashVaultEntry(root, "../outside.md")).rejects.toThrow(VaultWriteError);
  });
});

describe("restoreTrashEntry", () => {
  it("puts the file back where it was, recreating the topic it lived in", async () => {
    const root = project({ "topic/note.md": "body" });
    const entry = await trashVaultEntry(root, "topic");

    const restored = await restoreTrashEntry(root, entry.id);

    expect(restored).toEqual({ path: "topic" });
    expect(readFileSync(vaultPath(root, "topic/note.md"), "utf8")).toBe("body");
    expect(await listTrash(root)).toEqual([]);
  });

  it("lands beside a file that took the name while it was binned", async () => {
    const root = project({ "note.md": "first" });
    const entry = await trashVaultEntry(root, "note.md");
    writeFileSync(vaultPath(root, "note.md"), "second");

    const restored = await restoreTrashEntry(root, entry.id);

    expect(restored).toEqual({ path: "note-1.md" });
    expect(readFileSync(vaultPath(root, "note.md"), "utf8")).toBe("second");
    expect(readFileSync(vaultPath(root, "note-1.md"), "utf8")).toBe("first");
  });

  it("refuses an id that is not a bin entry", async () => {
    const root = project();

    await expect(restoreTrashEntry(root, "../..")).rejects.toThrow(VaultWriteError);
    await expect(restoreTrashEntry(root, "abc-123")).rejects.toThrow(VaultWriteError);
  });
});

describe("listTrash", () => {
  it("is empty for a project nothing has been deleted in", async () => {
    expect(await listTrash(project())).toEqual([]);
  });

  it("reports what is in the bin, newest first", async () => {
    const root = project({ "a.md": "a", "b.md": "b" });

    const first = await trashVaultEntry(root, "a.md");
    const second = await trashVaultEntry(root, "b.md");
    // Two deletions can land in the same millisecond, so the order is pinned by
    // rewriting the timestamps rather than by waiting for the clock.
    const bin = join(root, VAULT_DIRECTORY, TRASH_DIRECTORY);
    writeFileSync(join(bin, first.id, "meta.json"), JSON.stringify({ ...first, deletedAt: 1_000 }));
    writeFileSync(
      join(bin, second.id, "meta.json"),
      JSON.stringify({ ...second, deletedAt: 2_000 }),
    );

    expect((await listTrash(root)).map((entry) => entry.name)).toEqual(["b.md", "a.md"]);
  });

  it("skips an entry whose metadata cannot be read", async () => {
    const root = project({ "a.md": "a" });
    const entry = await trashVaultEntry(root, "a.md");
    writeFileSync(join(root, VAULT_DIRECTORY, TRASH_DIRECTORY, entry.id, "meta.json"), "not json");

    expect(await listTrash(root)).toEqual([]);
  });
});

describe("purgeTrash", () => {
  it("throws one entry away, and then the whole bin", async () => {
    const root = project({ "a.md": "a", "b.md": "b" });
    const first = await trashVaultEntry(root, "a.md");
    await trashVaultEntry(root, "b.md");

    await purgeTrash(root, first.id);
    expect((await listTrash(root)).map((entry) => entry.name)).toEqual(["b.md"]);

    await purgeTrash(root);
    expect(await listTrash(root)).toEqual([]);
    expect(existsSync(join(root, VAULT_DIRECTORY, TRASH_DIRECTORY))).toBe(false);
  });
});
