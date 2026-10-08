import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  launchPicksStorageKey,
  loadLaunchPicks,
  parseLaunchPicks,
  saveLaunchPicks,
} from "../src/launch-picks";

describe("launch picks", () => {
  let store: Map<string, string>;

  beforeEach(() => {
    store = new Map();
    globalThis.localStorage = {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
    } as Storage;
  });

  afterEach(() => {
    Reflect.deleteProperty(globalThis, "localStorage");
  });

  test("a saved pick comes back on the next load", () => {
    saveLaunchPicks({ harnessId: "codex", model: "gpt-5", effort: "high" });
    expect(loadLaunchPicks()).toEqual({ harnessId: "codex", model: "gpt-5", effort: "high" });
  });

  test("nothing stored means no picks", () => {
    expect(loadLaunchPicks()).toEqual({});
  });

  test("garbage and wrong types are dropped", () => {
    expect(parseLaunchPicks("{not json")).toEqual({});
    expect(parseLaunchPicks("[1,2]")).toEqual({});
    store.set(launchPicksStorageKey, JSON.stringify({ harnessId: 3, model: "opus", extra: "x" }));
    expect(loadLaunchPicks()).toEqual({ model: "opus" });
  });
});
