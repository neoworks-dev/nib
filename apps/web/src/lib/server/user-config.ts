import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

/** Preferences that outlive a session, keyed by harness so each keeps its own default. */
export interface UserConfig {
  defaultModels: Record<string, string>;
  /** Board the app reopens on a cold start; null until a project has been opened. */
  lastProject: string | null;
}

export const emptyUserConfig: UserConfig = { defaultModels: {}, lastProject: null };

export function userConfigPath(): string {
  const base = process.env.XDG_CONFIG_HOME?.trim();
  return join(base && base.length > 0 ? base : join(homedir(), ".config"), "nib", "config.json");
}

/** Unknown keys are kept so a newer build's settings survive an older one writing the file. */
export function mergeUserConfig(
  raw: unknown,
  patch: Partial<UserConfig>,
): UserConfig & Record<string, unknown> {
  const existing = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const models = existing.defaultModels;
  const defaultModels: Record<string, string> = {};
  if (models && typeof models === "object") {
    for (const [harnessId, model] of Object.entries(models as Record<string, unknown>)) {
      if (typeof model === "string") defaultModels[harnessId] = model;
    }
  }
  const storedProject = existing.lastProject;
  const lastProject =
    patch.lastProject ??
    (typeof storedProject === "string" && storedProject.length > 0 ? storedProject : null);

  return { ...existing, defaultModels: { ...defaultModels, ...patch.defaultModels }, lastProject };
}

export async function readUserConfig(): Promise<UserConfig> {
  try {
    return mergeUserConfig(JSON.parse(await readFile(userConfigPath(), "utf8")), {});
  } catch {
    // A missing or corrupt file is not an error: the UI falls back to harness defaults.
    return emptyUserConfig;
  }
}

export async function updateUserConfig(patch: Partial<UserConfig>): Promise<UserConfig> {
  const path = userConfigPath();
  let raw: unknown = {};
  try {
    raw = JSON.parse(await readFile(path, "utf8"));
  } catch {
    raw = {};
  }
  const merged = mergeUserConfig(raw, patch);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(merged, null, "\t")}\n`, "utf8");
  return merged;
}
