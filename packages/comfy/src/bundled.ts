/**
 * The workflows nib ships. Imported rather than read from disk, so they travel
 * inside whatever bundle the server is built into.
 */

import type { ComfyWorkflowManifest } from "@nib-ui/ui-contracts";
import assetVariation from "../workflows/asset-variation.json";
import imageTo3d from "../workflows/image-to-3d.json";
import removeBackground from "../workflows/remove-background.json";
import splitAssets from "../workflows/split-assets.json";
import tileableTexture from "../workflows/tileable-texture.json";
import upscale from "../workflows/upscale.json";
import { parseManifest } from "./manifest";

const FILES: Record<string, unknown> = {
  "asset-variation.json": assetVariation,
  "image-to-3d.json": imageTo3d,
  "remove-background.json": removeBackground,
  "split-assets.json": splitAssets,
  "upscale.json": upscale,
  "tileable-texture.json": tileableTexture,
};

/** The bundled manifests; a malformed one is a bug in this repo, so it throws. */
export function bundledWorkflows(): ComfyWorkflowManifest[] {
  const manifests: ComfyWorkflowManifest[] = [];
  for (const [file, content] of Object.entries(FILES)) {
    const parsed = parseManifest(content);
    if (!parsed.ok) throw new Error(`bundled workflow ${file} is invalid: ${parsed.error}`);
    manifests.push(parsed.manifest);
  }
  return manifests;
}
