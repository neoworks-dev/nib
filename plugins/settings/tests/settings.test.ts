import { afterEach, describe, expect, test } from "bun:test";
import {
  defaultSettings,
  loadSettings,
  parseSettings,
  resolveTheme,
  saveSettings,
  settingsStorageKey,
  type UserSettings,
} from "../src/settings";

function useStorage(entries: Record<string, string> = {}): Map<string, string> {
  const store = new Map(Object.entries(entries));
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    writable: true,
    value: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
      removeItem: (key: string) => void store.delete(key),
    },
  });
  return store;
}

afterEach(() => {
  Reflect.deleteProperty(globalThis, "localStorage");
});

describe("parseSettings", () => {
  test("falls back to defaults when nothing is stored", () => {
    expect(parseSettings(null)).toEqual(defaultSettings);
    expect(parseSettings("")).toEqual(defaultSettings);
  });

  test("falls back to defaults on malformed JSON", () => {
    expect(parseSettings('{"theme":')).toEqual(defaultSettings);
    expect(parseSettings("not json at all")).toEqual(defaultSettings);
  });

  test("falls back to defaults when the stored value is not an object", () => {
    expect(parseSettings("42")).toEqual(defaultSettings);
    expect(parseSettings('"dark"')).toEqual(defaultSettings);
    expect(parseSettings("null")).toEqual(defaultSettings);
    expect(parseSettings('["dark"]')).toEqual(defaultSettings);
  });

  test("keeps recognised fields and defaults the rest of a partial object", () => {
    expect(parseSettings('{"theme":"light"}')).toEqual({ ...defaultSettings, theme: "light" });
    expect(parseSettings('{"defaultHarnessId":"claude-code"}')).toEqual({
      ...defaultSettings,
      defaultHarnessId: "claude-code",
    });
  });

  test("drops values of the wrong type or an unknown theme", () => {
    const stored = JSON.stringify({
      theme: "neon",
      defaultHarnessId: 7,
      defaultPermissionMode: { mode: "plan" },
    });
    expect(parseSettings(stored)).toEqual(defaultSettings);
  });

  test("ignores unknown keys instead of carrying them through", () => {
    expect(parseSettings('{"theme":"dark","fontSize":18}')).toEqual({
      ...defaultSettings,
      theme: "dark",
    });
  });

  test("round-trips a fully populated object", () => {
    const settings: UserSettings = {
      theme: "dark",
      defaultHarnessId: "codex",
      defaultPermissionMode: "acceptEdits",
    };
    expect(parseSettings(JSON.stringify(settings))).toEqual(settings);
  });

  test("returns a fresh object so callers cannot mutate the defaults", () => {
    const parsed = parseSettings(null);
    parsed.theme = "light";
    expect(defaultSettings.theme).toBe("system");
  });
});

describe("resolveTheme", () => {
  test("follows the operating system for the system preference", () => {
    expect(resolveTheme("system", true)).toBe("dark");
    expect(resolveTheme("system", false)).toBe("light");
  });

  test("ignores the operating system for an explicit preference", () => {
    expect(resolveTheme("dark", false)).toBe("dark");
    expect(resolveTheme("light", true)).toBe("light");
  });
});

describe("settingsStorageKey", () => {
  test("is namespaced with the other browser-stored keys", () => {
    expect(settingsStorageKey).toBe("nib-ui.settings");
  });
});

describe("loadSettings and saveSettings", () => {
  test("round-trips through localStorage under the settings key", () => {
    const store = useStorage();
    const settings: UserSettings = {
      theme: "light",
      defaultHarnessId: "claude-code",
      defaultPermissionMode: "plan",
    };
    saveSettings(settings);
    expect(store.has(settingsStorageKey)).toBe(true);
    expect(loadSettings()).toEqual(settings);
  });

  test("returns defaults for an absent entry", () => {
    useStorage();
    expect(loadSettings()).toEqual(defaultSettings);
  });

  test("returns defaults for a corrupted entry", () => {
    useStorage({ [settingsStorageKey]: '{"theme":"dark"' });
    expect(loadSettings()).toEqual(defaultSettings);
  });

  test("returns defaults when storage is unavailable", () => {
    expect(loadSettings()).toEqual(defaultSettings);
  });

  test("swallows a failing write instead of throwing", () => {
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      writable: true,
      value: {
        getItem: () => null,
        setItem: () => {
          throw new Error("QuotaExceededError");
        },
      },
    });
    expect(() => saveSettings(defaultSettings)).not.toThrow();
  });
});
