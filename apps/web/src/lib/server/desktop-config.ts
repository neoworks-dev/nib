import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

/**
 * Per-application desktop-agent rules, beside the `config.json` the rest of the app writes.
 *
 * The server stores the document and does not interpret it: what a rule means is the
 * plugin's business, and a parser here would be a second one to keep in step. What the
 * server does own is the merge discipline — unknown keys survive, so an older build never
 * eats a newer one's fields.
 */
export function desktopConfigPath(): string {
  const base = process.env.XDG_CONFIG_HOME?.trim();
  return join(
    base && base.length > 0 ? base : join(homedir(), ".config"),
    "nib",
    "desktop-agent.json",
  );
}

export async function readDesktopConfig(): Promise<Record<string, unknown>> {
  try {
    const parsed: unknown = JSON.parse(await readFile(desktopConfigPath(), "utf8"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    // A missing or corrupt file is not an error: every application falls back to `ask`.
    return {};
  }
}

export async function writeDesktopConfig(
  patch: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const path = desktopConfigPath();
  const merged = { ...(await readDesktopConfig()), ...patch };
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(merged, null, "\t")}\n`, "utf8");
  return merged;
}
