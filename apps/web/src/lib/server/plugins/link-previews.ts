import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Plugin } from "@nib-ui/kernel";
import { assetsDirectory, linkPreviewsDirectory } from "../data-dir";
import { fetchLinkPreview, type LinkPreview } from "../link-preview";
import type { LinkPreviewService } from "../services";

/**
 * Bumped whenever `LinkPreview` changes shape. Without it a cached entry from an
 * older build is served forever under a key that says nothing about its fields.
 */
const CACHE_VERSION = 2;

class LinkPreviewStore implements LinkPreviewService {
  /** Collapses the burst a board reload produces onto one scrape per url. */
  private readonly inFlight = new Map<string, Promise<LinkPreview>>();

  constructor(
    private readonly directory: string,
    private readonly assets: string,
  ) {}

  preview(url: string): Promise<LinkPreview> {
    const pending = this.inFlight.get(url);
    if (pending) return pending;

    const work = this.resolve(url).finally(() => this.inFlight.delete(url));
    this.inFlight.set(url, work);
    return work;
  }

  private async resolve(url: string): Promise<LinkPreview> {
    const key = createHash("sha256").update(`${CACHE_VERSION}\n${url}`).digest("hex");
    const path = join(this.directory, `${key}.json`);
    try {
      return JSON.parse(await readFile(path, "utf8")) as LinkPreview;
    } catch {
      // Not scraped before, or the cache entry is unreadable.
    }

    const preview = await fetchLinkPreview(url, this.assets);
    await mkdir(this.directory, { recursive: true });
    await writeFile(path, `${JSON.stringify(preview, null, "\t")}\n`, "utf8").catch(
      () => undefined,
    );
    return preview;
  }
}

export const linkPreviewsPlugin: Plugin = {
  name: "linkPreviews",
  apply(ctx) {
    ctx.provide("linkPreviews", new LinkPreviewStore(linkPreviewsDirectory(), assetsDirectory()));
  },
};
