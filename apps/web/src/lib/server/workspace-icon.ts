import { readdir, readFile, stat } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import { expandHome } from "./workspace-probe";

export interface WorkspaceIcon {
  path: string;
  contentType: string;
  bytes: Uint8Array<ArrayBuffer>;
}

/** Conventional homes for a project favicon or logo, relative to the workspace root. */
const iconDirectories = [
  "",
  "static",
  "public",
  "assets",
  "images",
  "app",
  "src",
  "src/assets",
  "resources",
  "www",
  "docs",
  ".github",
];

/** Earlier prefixes win; a `favicon-32x32.png` still counts as a favicon. */
const namePrefixes = ["favicon", "icon", "logo", "app-icon", "appicon", "logomark", "brand"];

const contentTypes: Record<string, string> = {
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
};

const extensionOrder = [".svg", ".png", ".ico", ".webp", ".avif", ".jpg", ".jpeg", ".gif"];

const maxIconBytes = 1024 * 1024;
const lookupTtlMs = 60_000;
const lookupCache = new Map<string, { expiresAt: number; path: string | null }>();

/** Ranks a filename as a workspace icon candidate; lower is better, `null` means not a candidate. */
export function rankIconFile(name: string): number | null {
  const extension = extname(name).toLowerCase();
  const extensionRank = extensionOrder.indexOf(extension);
  if (extensionRank < 0) return null;

  const base = name.slice(0, name.length - extension.length).toLowerCase();
  const prefixRank = namePrefixes.findIndex(
    (prefix) => base === prefix || base.startsWith(`${prefix}-`),
  );
  if (prefixRank < 0) return null;

  // An exact `favicon.svg` should outrank `favicon-dark-32x32.svg` of the same family.
  return prefixRank * 100 + extensionRank * 10 + (base === namePrefixes[prefixRank] ? 0 : 1);
}

export async function findWorkspaceIcon(input: string): Promise<WorkspaceIcon | null> {
  const root = resolve(expandHome(input.trim()));
  const cached = lookupCache.get(root);
  const path = cached && cached.expiresAt > Date.now() ? cached.path : await locateIcon(root);
  lookupCache.set(root, { expiresAt: Date.now() + lookupTtlMs, path });
  if (!path) return null;

  try {
    if ((await stat(path)).size > maxIconBytes) return null;
    return {
      path,
      contentType: contentTypes[extname(path).toLowerCase()] ?? "application/octet-stream",
      bytes: Uint8Array.from(await readFile(path)),
    };
  } catch {
    lookupCache.delete(root);
    return null;
  }
}

async function locateIcon(root: string): Promise<string | null> {
  let best: { rank: number; path: string } | null = null;
  for (const directory of iconDirectories) {
    const base = join(root, directory);
    for (const entry of await safeReadDir(base)) {
      if (!entry.isFile()) continue;
      const rank = rankIconFile(entry.name);
      if (rank === null || (best && rank >= best.rank)) continue;
      best = { rank, path: join(base, entry.name) };
    }
    // A root-level favicon is authoritative; no need to keep scanning nested directories.
    if (best && best.rank < 100 && directory === "") break;
  }
  return best?.path ?? null;
}

async function safeReadDir(path: string) {
  try {
    return await readdir(path, { withFileTypes: true });
  } catch {
    return [];
  }
}
