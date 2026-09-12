import { afterEach, describe, expect, it } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { VAULT_DIRECTORY } from "../src/lib/server/vault";
import {
  deleteVaultEntry,
  moveVaultEntry,
  VaultWriteError,
  writeVaultFile,
  writeVaultText,
} from "../src/lib/server/vault-write";

const created: string[] = [];

afterEach(() => {
  for (const root of created.splice(0)) rmSync(root, { recursive: true, force: true });
});

function project(files: Record<string, string> = {}): string {
  const root = mkdtempSync(join(tmpdir(), "nib-vault-write-"));
  created.push(root);
  mkdirSync(join(root, VAULT_DIRECTORY), { recursive: true });

  for (const [path, body] of Object.entries(files)) {
    const absolute = join(root, VAULT_DIRECTORY, path);
    mkdirSync(dirname(absolute), { recursive: true });
    writeFileSync(absolute, body);
  }
  return root;
}

function read(root: string, path: string): string {
  return readFileSync(join(root, VAULT_DIRECTORY, path), "utf8");
}

describe("moveVaultEntry", () => {
  it("moves a file into a topic and rewrites the links that named its old path", async () => {
    const root = project({
      "topic-a/note.md": "body",
      "index.md": "see [[note]] and [[topic-a/note]] and [[topic-a/note.md]]",
    });

    const result = await moveVaultEntry(root, "topic-a/note.md", "topic-b");

    expect(result).toEqual({
      from: "topic-a/note.md",
      to: "topic-b/note.md",
      rewritten: ["index.md"],
    });
    expect(existsSync(join(root, VAULT_DIRECTORY, "topic-b/note.md"))).toBe(true);
    expect(existsSync(join(root, VAULT_DIRECTORY, "topic-a/note.md"))).toBe(false);
    // The bare name is left alone: it still resolves, which is the point of names.
    expect(read(root, "index.md")).toBe(
      "see [[note]] and [[topic-b/note]] and [[topic-b/note.md]]",
    );
  });

  it("leaves every link alone when a file moves out of the vault root", async () => {
    const root = project({ "note.md": "body", "index.md": "see [[note]]" });

    const result = await moveVaultEntry(root, "note.md", "topic-x");

    expect(result.rewritten).toEqual([]);
    expect(read(root, "index.md")).toBe("see [[note]]");
  });

  it("moves a topic with everything under it", async () => {
    const root = project({
      "topic-a/deep/note.md": "body",
      "index.md": "[[topic-a/deep/note]]",
    });

    const result = await moveVaultEntry(root, "topic-a", "archive");

    expect(result.to).toBe("archive/topic-a");
    expect(existsSync(join(root, VAULT_DIRECTORY, "archive/topic-a/deep/note.md"))).toBe(true);
    expect(read(root, "index.md")).toBe("[[archive/topic-a/deep/note]]");
  });

  it("moves back to the vault root", async () => {
    const root = project({ "topic-x/note.md": "body" });
    expect((await moveVaultEntry(root, "topic-x/note.md", "")).to).toBe("note.md");
  });

  it("reverses exactly, when handed the files the forward move rewrote", async () => {
    const root = project({ "topic-a/note.md": "body", "index.md": "[[topic-a/note]]" });

    const forward = await moveVaultEntry(root, "topic-a/note.md", "topic-b");
    const back = await moveVaultEntry(root, forward.to, "topic-a", { rewrite: forward.rewritten });

    expect(back.to).toBe("topic-a/note.md");
    expect(read(root, "index.md")).toBe("[[topic-a/note]]");
  });

  it("is a no-op when the destination is where the item already is", async () => {
    const root = project({ "topic-x/note.md": "body" });
    const result = await moveVaultEntry(root, "topic-x/note.md", "topic-x");

    expect(result).toEqual({ from: "topic-x/note.md", to: "topic-x/note.md", rewritten: [] });
  });

  it("refuses to overwrite what is already there", async () => {
    const root = project({ "note.md": "new", "topic-x/note.md": "old" });

    await expect(moveVaultEntry(root, "note.md", "topic-x")).rejects.toMatchObject({ status: 409 });
    expect(read(root, "topic-x/note.md")).toBe("old");
    expect(read(root, "note.md")).toBe("new");
  });

  it("refuses to move a topic inside itself", async () => {
    const root = project({ "topic-a/deep/note.md": "body" });
    await expect(moveVaultEntry(root, "topic-a", "topic-a/deep")).rejects.toMatchObject({
      status: 400,
    });
  });

  it("refuses a path that climbs out of the vault", async () => {
    const root = project({ "note.md": "body" });
    await expect(moveVaultEntry(root, "../escape.md", "")).rejects.toBeInstanceOf(VaultWriteError);
    await expect(moveVaultEntry(root, "note.md", "../..")).rejects.toBeInstanceOf(VaultWriteError);
  });

  it("reports a source that is gone rather than creating one", async () => {
    const root = project();
    await expect(moveVaultEntry(root, "nope.md", "topic-x")).rejects.toMatchObject({ status: 404 });
  });
});

describe("writeVaultFile", () => {
  it("writes into a topic directory, creating it", async () => {
    const root = project();
    const result = await writeVaultFile(root, "topic-x", "shot.png", new Uint8Array([1, 2, 3]));

    expect(result.path).toBe("topic-x/shot.png");
    expect(readFileSync(join(root, VAULT_DIRECTORY, "topic-x/shot.png")).length).toBe(3);
  });

  it("suffixes rather than overwriting a name that is taken", async () => {
    const root = project({ "shot.png": "old" });
    const result = await writeVaultFile(root, "", "shot.png", new Uint8Array([1]));

    expect(result.path).toBe("shot-1.png");
    expect(read(root, "shot.png")).toBe("old");
  });

  it("strips a name down to something a directory will hold", async () => {
    const root = project();
    const result = await writeVaultFile(root, "", "../../etc/passwd", new Uint8Array([1]));

    expect(result.path).toBe("passwd");
  });

  it("refuses a directory outside the vault", async () => {
    const root = project();
    await expect(
      writeVaultFile(root, "../..", "x.png", new Uint8Array([1])),
    ).rejects.toBeInstanceOf(VaultWriteError);
  });
});

describe("deleteVaultEntry", () => {
  it("deletes a file", async () => {
    const root = project({ "note.md": "body" });
    await deleteVaultEntry(root, "note.md");
    expect(existsSync(join(root, VAULT_DIRECTORY, "note.md"))).toBe(false);
  });

  it("takes a topic's contents with it", async () => {
    const root = project({ "topic-a/deep/note.md": "body" });
    await deleteVaultEntry(root, "topic-a");
    expect(existsSync(join(root, VAULT_DIRECTORY, "topic-a"))).toBe(false);
  });

  it("refuses the vault root itself", async () => {
    const root = project({ "note.md": "body" });
    await expect(deleteVaultEntry(root, "")).rejects.toMatchObject({ status: 400 });
    expect(existsSync(join(root, VAULT_DIRECTORY, "note.md"))).toBe(true);
  });
});

describe("writeVaultText", () => {
  it("writes the body back to the path it was given", async () => {
    const root = project({ "note.md": "old" });

    await writeVaultText(root, "note.md", "# Today\n- [x] did it");

    expect(read(root, "note.md")).toBe("# Today\n- [x] did it");
  });

  /**
   * The link-safe guarantee. Every `[[link]]` resolves by the name the file has
   * (PLAN §4), so a save that renamed the file to match a new title would break
   * every reference to it. The app owns `mv`; a save is not one.
   */
  it("never renames, so the links pointing at the note still resolve", async () => {
    const root = project({
      "note.md": "# Old title",
      "index.md": "see [[note]]",
    });

    await writeVaultText(root, "note.md", "# A completely different title");

    expect(existsSync(join(root, VAULT_DIRECTORY, "note.md"))).toBe(true);
    expect(read(root, "index.md")).toBe("see [[note]]");
    // Nothing else was touched, and no second file appeared under the new title.
    expect(existsSync(join(root, VAULT_DIRECTORY, "A completely different title.md"))).toBe(false);
  });

  it("leaves every other note alone", async () => {
    const root = project({ "a.md": "a", "b.md": "b" });

    await writeVaultText(root, "a.md", "changed");

    expect(read(root, "b.md")).toBe("b");
  });

  it("takes an empty body: clearing a note is a real edit", async () => {
    const root = project({ "note.md": "something" });

    await writeVaultText(root, "note.md", "");

    expect(read(root, "note.md")).toBe("");
  });

  it("refuses a path that climbs out of the vault", async () => {
    const root = project();

    await expect(writeVaultText(root, "../escaped.md", "x")).rejects.toBeInstanceOf(
      VaultWriteError,
    );
    expect(existsSync(join(root, "escaped.md"))).toBe(false);
  });

  it("refuses to replace a directory with a file", async () => {
    const root = project({ "topic/note.md": "body" });

    await expect(writeVaultText(root, "topic", "x")).rejects.toBeInstanceOf(VaultWriteError);
    expect(read(root, "topic/note.md")).toBe("body");
  });

  it("refuses a path whose directory is not there: writing does not create", async () => {
    const root = project();

    await expect(writeVaultText(root, "nowhere/note.md", "x")).rejects.toBeInstanceOf(
      VaultWriteError,
    );
    expect(existsSync(join(root, VAULT_DIRECTORY, "nowhere"))).toBe(false);
  });

  it("leaves no temporary file behind", async () => {
    const root = project({ "note.md": "old" });

    await writeVaultText(root, "note.md", "new");

    const left = readdirSync(join(root, VAULT_DIRECTORY));
    expect(left).toEqual(["note.md"]);
  });
});
