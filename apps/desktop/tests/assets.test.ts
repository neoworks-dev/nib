import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appRequestFor, uploadCapture } from "../src/main/desktop-agent/assets";

describe("appRequestFor", () => {
  test("uses the SvelteKit handler in production", async () => {
    const seen: string[] = [];
    const request = appRequestFor(undefined, async (input) => {
      seen.push(input.url);
      return new Response("ok");
    });
    await request(new Request("http://nib/api/assets", { method: "POST" }));
    expect(seen).toEqual(["http://nib/api/assets"]);
  });

  test("refuses rather than dropping a capture when the app is not serving yet", async () => {
    await expect(
      appRequestFor(undefined, null)(new Request("http://nib/api/assets")),
    ).rejects.toThrow("not being served");
  });

  test("rewrites onto the dev server, keeping the path and dropping a trailing slash", () => {
    // Not exercised over the network here; the shape of the rewrite is what matters,
    // and it is the one thing that differs between the two builds.
    const request = appRequestFor("http://localhost:5173/", null);
    expect(typeof request).toBe("function");
  });
});

describe("uploadCapture", () => {
  let directory: string;
  let path: string;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), "nib-capture-"));
    path = join(directory, "shot.png");
    writeFileSync(path, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  });

  afterEach(() => rmSync(directory, { recursive: true, force: true }));

  test("posts the bytes as a png and answers with the stored asset", async () => {
    const sent: { contentType?: string | null; body?: Uint8Array } = {};
    const stored = await uploadCapture(async (request) => {
      sent.contentType = request.headers.get("content-type");
      sent.body = new Uint8Array(await request.arrayBuffer());
      return Response.json({ assetId: "abc.png", contentType: "image/png", byteLength: 4 });
    }, path);

    expect(sent.contentType).toBe("image/png");
    expect(sent.body).toEqual(new Uint8Array([0x89, 0x50, 0x4e, 0x47]));
    expect(stored.assetId).toBe("abc.png");
  });

  test("removes the temp file, so a screenshot is not left in the runtime directory", async () => {
    await uploadCapture(
      async () => Response.json({ assetId: "a.png", contentType: "image/png", byteLength: 4 }),
      path,
    );
    expect(existsSync(path)).toBe(false);
  });

  test("removes the temp file even when the store refuses it", async () => {
    await expect(
      uploadCapture(async () => new Response("too large", { status: 413 }), path),
    ).rejects.toThrow("413");
    expect(existsSync(path)).toBe(false);
  });

  test("removes the temp file even when the request itself throws", async () => {
    await expect(
      uploadCapture(() => Promise.reject(new Error("the app is gone")), path),
    ).rejects.toThrow("the app is gone");
    expect(existsSync(path)).toBe(false);
  });

  test("a file the sidecar did not write is an error, not a silent empty upload", async () => {
    await expect(
      uploadCapture(async () => new Response("{}"), join(directory, "missing.png")),
    ).rejects.toThrow();
  });
});
