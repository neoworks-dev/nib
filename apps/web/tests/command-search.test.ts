import { describe, expect, test } from "bun:test";
import type { SearchResult } from "@nib-ui/ui-contracts";
import { ReactiveCommandRegistry } from "../src/lib/client/registries/commands.svelte";

function result(id: string): SearchResult {
  return { id, title: id, open: () => {} };
}

describe("palette search", () => {
  test("groups providers in contributed order", () => {
    const registry = new ReactiveCommandRegistry();
    registry.registerSearch({ group: "Files", order: 10, search: () => [result("a.ts")] });
    registry.registerSearch({ group: "Vault", order: 0, search: () => [result("note.md")] });

    expect(registry.search("n").map((group) => group.group)).toEqual(["Vault", "Files"]);
  });

  test("leaves out a provider with nothing to say", () => {
    const registry = new ReactiveCommandRegistry();
    registry.registerSearch({ group: "Vault", search: () => [] });
    registry.registerSearch({ group: "Files", search: () => [result("a.ts")] });

    const groups = registry.search("a");
    expect(groups.map((group) => group.group)).toEqual(["Files"]);
    expect(groups[0]?.results.map((entry) => entry.id)).toEqual(["a.ts"]);
  });

  test("hands the raw query to providers, not a trimmed one", () => {
    const registry = new ReactiveCommandRegistry();
    let seen = "";
    registry.registerSearch({
      group: "Vault",
      search: (query) => {
        seen = query;
        return [];
      },
    });

    registry.search("  Note  ");
    expect(seen).toBe("  Note  ");
  });

  test("disposing a provider takes its group out", () => {
    const registry = new ReactiveCommandRegistry();
    const dispose = registry.registerSearch({ group: "Vault", search: () => [result("note.md")] });
    expect(registry.search("note")).toHaveLength(1);

    dispose();
    expect(registry.search("note")).toHaveLength(0);
  });
});
