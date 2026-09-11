import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  AssetTooLargeError,
  assetPath,
  contentTypeOf,
  isAssetId,
  MAX_ASSET_BYTES,
  readAsset,
  sniffAsset,
  storeAsset,
  UnsupportedAssetError,
} from "../src/lib/server/asset-store";

function bytes(...values: (number | string)[]): Uint8Array {
  const flat: number[] = [];
  for (const value of values) {
    if (typeof value === "number") flat.push(value);
    else for (const character of value) flat.push(character.charCodeAt(0));
  }
  return new Uint8Array(flat);
}

const png = bytes(0x89, "PNG", 0x0d, 0x0a, 0x1a, 0x0a, "body");
const jpeg = bytes(0xff, 0xd8, 0xff, 0xe0, "body");
const gif = bytes("GIF89a", "body");
const webp = bytes("RIFF", 0, 0, 0, 0, "WEBP", "body");
const pdf = bytes("%PDF-1.7", "body");
const mp4 = bytes(0, 0, 0, 0x18, "ftypmp42", "body");
const webm = bytes(0x1a, 0x45, 0xdf, 0xa3, "body");

let directory: string;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "nib-assets-"));
});

afterEach(() => {
  rmSync(directory, { recursive: true, force: true });
});

describe("sniffAsset", () => {
  it("reads the type out of the bytes, not the caller", () => {
    expect(sniffAsset(png)?.contentType).toBe("image/png");
    expect(sniffAsset(jpeg)?.contentType).toBe("image/jpeg");
    expect(sniffAsset(gif)?.contentType).toBe("image/gif");
    expect(sniffAsset(webp)?.contentType).toBe("image/webp");
    expect(sniffAsset(pdf)?.contentType).toBe("application/pdf");
    expect(sniffAsset(mp4)?.contentType).toBe("video/mp4");
    expect(sniffAsset(webm)?.contentType).toBe("video/webm");
  });

  it("reads a model out of its bytes: glb by magic, stl by arithmetic", () => {
    const stl = new Uint8Array(84 + 2 * 50);
    new DataView(stl.buffer).setUint32(80, 2, true);

    expect(sniffAsset(bytes("glTF", 2, 0, 0, 0))?.contentType).toBe("model/gltf-binary");
    expect(sniffAsset(stl)?.contentType).toBe("model/stl");
    expect(sniffAsset(bytes("solid part\nfacet normal 0 0 1\n"))?.contentType).toBe("model/stl");
  });

  it("refuses a truncated stl and prose that only looks like one", () => {
    const truncated = new Uint8Array(84 + 50);
    new DataView(truncated.buffer).setUint32(80, 2, true);

    expect(sniffAsset(truncated)).toBeNull();
    expect(sniffAsset(bytes("solid ground, liquid water"))).toBeNull();
  });

  it("reads an obj out of the grammar of its head, faces or not", () => {
    const cube = bytes("# blender\nmtllib cube.mtl\no Cube\nv 1 1 -1\nv 1 -1 -1\nvn 0 1 0\n");
    const facesPastTheWindow = bytes(`# big\n${"v 1 1 -1\n".repeat(2000)}`);

    expect(sniffAsset(cube)?.contentType).toBe("model/obj");
    expect(sniffAsset(facesPastTheWindow)?.contentType).toBe("model/obj");
  });

  it("reads an obj a windows exporter opened with a byte order mark", () => {
    expect(
      sniffAsset(bytes(0xef, 0xbb, 0xbf, "# blender\r\nv 1 1 -1\r\nf 1 1 1\r\n"))?.contentType,
    ).toBe("model/obj");
  });

  it("refuses text that is not an obj, and an obj with no vertices at all", () => {
    expect(sniffAsset(bytes("v 1 1 -1\nthis is prose about a model\n"))).toBeNull();
    expect(sniffAsset(bytes("# a comment and nothing else\no Empty\n"))).toBeNull();
    expect(sniffAsset(bytes("v 1 1 -1\n", 0x00, "binary\n"))).toBeNull();
  });

  it("refuses svg, which is a script-carrying document however it is served", () => {
    expect(sniffAsset(bytes('<svg xmlns="http://www.w3.org/2000/svg"></svg>'))).toBeNull();
  });

  it("refuses html dressed up with an image extension", () => {
    expect(sniffAsset(bytes("<!DOCTYPE html><script>alert(1)</script>"))).toBeNull();
  });

  it("a run of bytes shorter than the magic is not a match", () => {
    expect(sniffAsset(bytes(0x89, "PN"))).toBeNull();
    expect(sniffAsset(new Uint8Array(0))).toBeNull();
  });
});

describe("storeAsset", () => {
  it("names the file after the hash of its content", async () => {
    const stored = await storeAsset(directory, png);

    expect(stored.assetId).toBe(`${createHash("sha256").update(png).digest("hex")}.png`);
    expect(stored.contentType).toBe("image/png");
    expect(stored.byteLength).toBe(png.byteLength);
  });

  it("stores the same bytes once however often they are pasted", async () => {
    await storeAsset(directory, png);
    await storeAsset(directory, png);

    expect(readdirSync(directory)).toHaveLength(1);
  });

  it("leaves no temp file behind", async () => {
    await storeAsset(directory, mp4);

    expect(readdirSync(directory).some((name) => name.endsWith(".tmp"))).toBe(false);
  });

  it("rejects a type it cannot serve safely", async () => {
    expect(storeAsset(directory, bytes("just text"))).rejects.toBeInstanceOf(UnsupportedAssetError);
  });

  it("rejects anything past the size cap", async () => {
    const huge = new Uint8Array(MAX_ASSET_BYTES + 1);
    huge.set(png);

    expect(storeAsset(directory, huge)).rejects.toBeInstanceOf(AssetTooLargeError);
  });

  describe("with the text fallback", () => {
    const options = { allowText: true };

    it("keeps a payload no signature claims as plain text", async () => {
      const stored = await storeAsset(directory, bytes("name,count\nwidgets,3\n"), options);

      expect(stored.contentType).toBe("text/plain");
      expect(stored.assetId.endsWith(".txt")).toBe(true);
      expect(await readAsset(directory, stored.assetId)).toMatchObject({
        contentType: "text/plain",
      });
    });

    it("stores svg as text, so it can never come back out as an image", async () => {
      const svg = bytes('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
      const stored = await storeAsset(directory, svg, options);

      expect(stored.contentType).toBe("text/plain");
      expect(contentTypeOf(stored.assetId)).toBe("text/plain");
    });

    it("leaves a payload the signatures do claim on its own type", async () => {
      expect((await storeAsset(directory, png, options)).contentType).toBe("image/png");
    });

    it("refuses binary junk, an empty payload, and broken utf-8", async () => {
      expect(
        storeAsset(directory, bytes("text", 0x00, "and a nul"), options),
      ).rejects.toBeInstanceOf(UnsupportedAssetError);
      expect(
        storeAsset(directory, new Uint8Array([0xc3, 0x28, 0xff, 0xfe]), options),
      ).rejects.toBeInstanceOf(UnsupportedAssetError);
      expect(storeAsset(directory, new Uint8Array(0), options)).rejects.toBeInstanceOf(
        UnsupportedAssetError,
      );
    });

    it("still refuses anything past the size cap", async () => {
      const huge = new Uint8Array(MAX_ASSET_BYTES + 1).fill(0x61);

      expect(storeAsset(directory, huge, options)).rejects.toBeInstanceOf(AssetTooLargeError);
    });
  });
});

describe("assetPath", () => {
  it("answers with the file the id names, and null once it is gone", async () => {
    const stored = await storeAsset(directory, png);

    expect(await assetPath(directory, stored.assetId)).toBe(join(directory, stored.assetId));
    expect(await assetPath(directory, `${"a".repeat(64)}.png`)).toBeNull();
    expect(await assetPath(directory, "../../etc/passwd")).toBeNull();
  });
});

describe("readAsset", () => {
  it("round trips what was stored", async () => {
    const stored = await storeAsset(directory, gif);
    const loaded = await readAsset(directory, stored.assetId);

    expect(loaded?.contentType).toBe("image/gif");
    expect([...loaded!.bytes]).toEqual([...gif]);
  });

  it("refuses an id that is not one this store could have minted", async () => {
    expect(await readAsset(directory, "../../etc/passwd")).toBeNull();
    expect(await readAsset(directory, "not-a-hash.png")).toBeNull();
    expect(await readAsset(directory, `${"a".repeat(64)}.exe`)).toBeNull();
  });

  it("a well-formed id for a file that is not there is a miss, not a throw", async () => {
    expect(await readAsset(directory, `${"a".repeat(64)}.png`)).toBeNull();
  });
});

describe("isAssetId and contentTypeOf", () => {
  it("accept only a sha256 with a known extension", () => {
    expect(isAssetId(`${"0".repeat(64)}.webp`)).toBe(true);
    expect(isAssetId(`${"0".repeat(63)}.webp`)).toBe(false);
    expect(isAssetId(`${"0".repeat(64)}/x.webp`)).toBe(false);
    expect(contentTypeOf(`${"0".repeat(64)}.webm`)).toBe("video/webm");
    expect(contentTypeOf(`${"0".repeat(64)}.svg`)).toBeNull();
  });
});
