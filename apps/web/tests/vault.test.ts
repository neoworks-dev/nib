import { afterEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { VAULT_GUIDE, VAULT_GUIDE_FILE } from "@nib-ui/vault";
import {
  openVault,
  parseByteRange,
  readVaultFile,
  statVaultFile,
  VAULT_DIRECTORY,
  vaultFileStream,
} from "../src/lib/server/vault";

const created: string[] = [];

afterEach(() => {
  for (const root of created.splice(0)) rmSync(root, { recursive: true, force: true });
});

function project(files: Record<string, string> = {}): string {
  const root = mkdtempSync(join(tmpdir(), "nib-project-"));
  created.push(root);

  for (const [path, body] of Object.entries(files)) {
    const absolute = join(root, path);
    mkdirSync(dirname(absolute), { recursive: true });
    writeFileSync(absolute, body);
  }
  return root;
}

describe("openVault", () => {
  it("creates the vault when a project is opened", async () => {
    const root = project();
    const opened = await openVault(root);

    expect(opened.root).toBe(join(root, VAULT_DIRECTORY));
    expect(existsSync(opened.root)).toBe(true);
    expect(opened.writable).toBe(true);
    expect(opened.reason).toBeNull();
    expect(opened.items.map((item) => item.path)).toEqual([VAULT_GUIDE_FILE]);
    expect(readFileSync(join(opened.root, VAULT_GUIDE_FILE), "utf8")).toBe(VAULT_GUIDE);
  });

  it("leaves a guide the user changed or deleted alone", async () => {
    const root = project();
    await openVault(root);

    const guide = join(root, VAULT_DIRECTORY, VAULT_GUIDE_FILE);
    writeFileSync(guide, "our own rules");
    expect((await openVault(root)).items[0]?.preview).toBe("our own rules");

    rmSync(guide);
    expect((await openVault(root)).items).toEqual([]);
  });

  it("is idempotent, and reads what the vault already holds", async () => {
    const root = project({ [join(VAULT_DIRECTORY, "topic-x/a-note.md")]: "Body" });
    const opened = await openVault(root);

    expect(opened.items.map((item) => item.path).sort()).toEqual(["topic-x", "topic-x/a-note.md"]);
    expect(opened.items.find((item) => item.path === "topic-x")?.kind).toBe("topic");
  });

  it("reports a vault it cannot create without failing the open", async () => {
    const file = join(project({ "a.txt": "not a directory" }), "a.txt");
    const opened = await openVault(file);

    expect(opened.writable).toBe(false);
    expect(opened.reason).not.toBeNull();
    expect(opened.items).toEqual([]);
    expect(opened.cwd).toBe(file);
  });

  it("clips a preview to the requested length", async () => {
    const root = project({ [join(VAULT_DIRECTORY, "a.md")]: "x".repeat(100) });
    const opened = await openVault(root, { previewChars: 12 });

    expect(opened.items[0]?.preview).toBe("x".repeat(12));
    expect(opened.items[0]?.truncated).toBe(true);
  });

  it("resolves links and backlinks across the vault", async () => {
    const root = project({
      [join(VAULT_DIRECTORY, "intro.md")]: "see [[a-note]] and [[nope]]",
      [join(VAULT_DIRECTORY, "topic-x/a-note.md")]: "Body",
    });
    const opened = await openVault(root);

    expect(opened.links).toEqual([
      { from: "intro.md", target: "a-note", to: "topic-x/a-note.md", ambiguous: false },
      { from: "intro.md", target: "nope", to: null, ambiguous: false },
    ]);
    expect(opened.backlinks).toEqual({ "topic-x/a-note.md": ["intro.md"] });
    expect(opened.unresolved).toEqual(["nope"]);
  });

  it("computes mentions only when asked", async () => {
    const root = project({
      [join(VAULT_DIRECTORY, "intro.md")]: "the cottage",
      [join(VAULT_DIRECTORY, "cottage.md")]: "",
    });

    expect((await openVault(root)).mentions).toEqual([]);
    expect((await openVault(root, { mentions: true })).mentions).toEqual([
      { source: "intro.md", target: "cottage.md", count: 1 },
    ]);
  });

  it("does not treat a session transcript as markdown", async () => {
    const root = project({
      [join(VAULT_DIRECTORY, "topic-x/sess-1.jsonl")]: '{"type":"session.send"}\n',
    });
    const opened = await openVault(root);

    const transcript = opened.items.find((item) => item.path.endsWith(".jsonl"));
    expect(transcript?.name).toBe("sess-1");
    expect(transcript?.preview).toBe("");
  });
});

describe("readVaultFile", () => {
  it("serves a file by its vault-relative path", async () => {
    const root = project({ [join(VAULT_DIRECTORY, "topic-x/shot.png")]: "bytes" });
    const file = await readVaultFile(root, "topic-x/shot.png");

    expect(file?.bytes.toString("utf8")).toBe("bytes");
    expect(file?.contentType).toBe("image/png");
  });

  it("reads a markdown file as text, never as a document", async () => {
    const root = project({ [join(VAULT_DIRECTORY, "note.md")]: "# hi" });
    expect((await readVaultFile(root, "note.md"))?.contentType).toMatch(/^text\/plain/);
  });

  it("will not serve html as a page", async () => {
    const root = project({ [join(VAULT_DIRECTORY, "evil.html")]: "<script>x()</script>" });
    expect((await readVaultFile(root, "evil.html"))?.contentType).toMatch(/^text\/plain/);
  });

  it("has no type for an extension it does not know", async () => {
    const root = project({ [join(VAULT_DIRECTORY, "thing.weird")]: "?" });
    expect((await readVaultFile(root, "thing.weird"))?.contentType).toBe(
      "application/octet-stream",
    );
  });

  it("refuses a path that leaves the vault", async () => {
    const root = project({ [join(VAULT_DIRECTORY, "a.md")]: "x", "outside.txt": "secret" });

    expect(await readVaultFile(root, "../outside.txt")).toBeNull();
    expect(await readVaultFile(root, "../../etc/passwd")).toBeNull();
    expect(await readVaultFile(root, "/etc/passwd")).toBeNull();
  });

  it("refuses a directory and a path that is not there", async () => {
    const root = project({ [join(VAULT_DIRECTORY, "topic-x/a.md")]: "x" });

    expect(await readVaultFile(root, "topic-x")).toBeNull();
    expect(await readVaultFile(root, "nothing.md")).toBeNull();
  });

  it("refuses a file over the cap", async () => {
    const root = project({ [join(VAULT_DIRECTORY, "big.bin")]: "0123456789" });

    expect(await readVaultFile(root, "big.bin", { maxBytes: 4 })).toBeNull();
    expect(await readVaultFile(root, "big.bin", { maxBytes: 10 })).not.toBeNull();
  });
});

describe("statVaultFile", () => {
  it("says how big a file is and what it is, without reading it", async () => {
    const root = project({ [join(VAULT_DIRECTORY, "clip.mp4")]: "0123456789" });
    const info = await statVaultFile(root, "clip.mp4");

    expect(info?.size).toBe(10);
    expect(info?.contentType).toBe("video/mp4");
  });

  it("has no cap: a clip is played out of the vault rather than loaded from it", async () => {
    const root = project({ [join(VAULT_DIRECTORY, "big.mp4")]: "x".repeat(64) });

    expect((await statVaultFile(root, "big.mp4"))?.size).toBe(64);
    // The reading path is where the cap belongs, and it still has one.
    expect(await readVaultFile(root, "big.mp4", { maxBytes: 8 })).toBeNull();
  });

  it("refuses a directory, a path that is not there, and one that leaves the vault", async () => {
    const root = project({ [join(VAULT_DIRECTORY, "topic-x/a.md")]: "x", "outside.txt": "secret" });

    expect(await statVaultFile(root, "topic-x")).toBeNull();
    expect(await statVaultFile(root, "nothing.md")).toBeNull();
    expect(await statVaultFile(root, "../outside.txt")).toBeNull();
  });
});

describe("parseByteRange", () => {
  it("reads the forms a media element sends", () => {
    expect(parseByteRange("bytes=0-", 100)).toEqual({ start: 0, end: 99 });
    expect(parseByteRange("bytes=10-19", 100)).toEqual({ start: 10, end: 19 });
    expect(parseByteRange("bytes=-20", 100)).toEqual({ start: 80, end: 99 });
  });

  it("clips an end past the file to the last byte there is", () => {
    expect(parseByteRange("bytes=90-500", 100)).toEqual({ start: 90, end: 99 });
  });

  it("serves the whole file for no range, and for one nobody could satisfy", () => {
    expect(parseByteRange(null, 100)).toBeNull();
    expect(parseByteRange("bytes=100-200", 100)).toBeNull();
    expect(parseByteRange("bytes=20-10", 100)).toBeNull();
    expect(parseByteRange("bytes=0-10, 20-30", 100)).toBeNull();
    expect(parseByteRange("kilograms=0-10", 100)).toBeNull();
    expect(parseByteRange("bytes=0-", 0)).toBeNull();
  });
});

describe("vaultFileStream", () => {
  it("streams the whole file", async () => {
    const root = project({ [join(VAULT_DIRECTORY, "clip.mp4")]: "0123456789" });
    const info = await statVaultFile(root, "clip.mp4");

    expect(await text(vaultFileStream(info!))).toBe("0123456789");
  });

  it("streams one range of it, both ends included", async () => {
    const root = project({ [join(VAULT_DIRECTORY, "clip.mp4")]: "0123456789" });
    const info = await statVaultFile(root, "clip.mp4");

    expect(await text(vaultFileStream(info!, { start: 2, end: 5 }))).toBe("2345");
  });
});

/** What a response body would carry, read back as a string. */
async function text(stream: ReadableStream<Uint8Array>): Promise<string> {
  return new Response(stream).text();
}
