import { describe, expect, it } from "bun:test";
import { Assets, path } from "pixi.js";
import { configureAssetRoot, parserFor, videoMimeFor } from "../src/engine/utils/texture";

/**
 * Pixi picks a loader from the url's extension, and every url the board loads
 * from is an extensionless route — `/api/vault/file?path=…`, `/api/assets/<id>`.
 * Naming the parser is what stops a picture in the vault drawing as a blank card,
 * so the choice is made from the vault path rather than from the url.
 */
describe("parserFor", () => {
  it("decodes a picture with the texture loader", () => {
    expect(parserFor("shot.png", false)).toBe("loadTextures");
    expect(parserFor("a/b/photo.JPEG", false)).toBe("loadTextures");
  });

  it("rasterises an svg with its own loader", () => {
    expect(parserFor("icon.svg", false)).toBe("loadSVG");
  });

  it("gives a clip the video loader, whatever its extension says", () => {
    expect(parserFor("clip.mp4", true)).toBe("loadVideo");
    expect(parserFor("clip.svg", true)).toBe("loadVideo");
  });

  it("falls back to the texture loader for a file carrying no extension", () => {
    expect(parserFor("capture", false)).toBe("loadTextures");
  });
});

/**
 * The `<source>` a clip is played from has to be told what it is: the url is a
 * route with no extension of its own, and a type read off that one is unplayable,
 * so the element never reaches `canplay` and the card stays empty.
 */
describe("videoMimeFor", () => {
  it("names the type from the vault path", () => {
    expect(videoMimeFor("clip.mp4")).toBe("video/mp4");
    expect(videoMimeFor("a/b/clip.WEBM")).toBe("video/webm");
  });

  it("says nothing for a file carrying no extension, rather than guessing", () => {
    expect(videoMimeFor("capture")).toBeUndefined();
  });
});

/**
 * Pixi's own url helper treats only `http(s):` as a url, so under the desktop
 * app's `app://nib` origin it reads the root of a root-relative src as bare
 * `app://` and drops the host. Naming the root is what keeps a card's bytes
 * reachable in the packaged app.
 */
describe("configureAssetRoot", () => {
  const route = "/api/vault/file?cwd=%2Fhome%2Fmoritz%2Fproject&path=image.png&v=3";

  it("keeps the host of a custom scheme Pixi does not recognise", () => {
    configureAssetRoot("app://nib/board");
    expect(Assets.resolver.rootPath).toBe("app://nib/");
    expect(path.toAbsolute(route, "app://nib/", Assets.resolver.rootPath)).toBe(
      "app://nib/api/vault/file?cwd=%2Fhome%2Fmoritz%2Fproject&path=image.png&v=3",
    );
  });

  it("resolves over http to what Pixi derives on its own", () => {
    configureAssetRoot("http://localhost:5173/board");
    expect(Assets.resolver.rootPath).toBe("http://localhost:5173/");
    expect(path.toAbsolute(route, "http://localhost:5173/", Assets.resolver.rootPath)).toBe(
      path.toAbsolute(route, "http://localhost:5173/"),
    );
  });
});
