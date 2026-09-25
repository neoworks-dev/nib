import { describe, expect, it } from "bun:test";
import { toSnapshot } from "../src/snapshot";
import { buildVaultIndex, unlinkedMentions, type VaultSource } from "../src/tree";

function source(files: Record<string, string>): VaultSource {
  const bodies = new Map(Object.entries(files));
  return {
    entries: [...bodies.keys()].map((path) => ({ path, kind: "file" as const })),
    bodies,
  };
}

describe("toSnapshot", () => {
  it("carries a plain value with no Maps", () => {
    const snapshot = toSnapshot(buildVaultIndex(source({ "a.md": "Body", "b.md": "[[a]]" })));
    expect(Array.isArray(snapshot.items)).toBe(true);
    expect(snapshot.backlinks).toEqual({ "a.md": ["b.md"] });
    expect(JSON.parse(JSON.stringify(snapshot))).toEqual(snapshot);
  });

  it("clips a body and says so", () => {
    const index = buildVaultIndex(source({ "a.md": "x".repeat(50) }));
    const short = toSnapshot(index, { previewChars: 10 });
    expect(short.items[0]?.preview).toBe("x".repeat(10));
    expect(short.items[0]?.truncated).toBe(true);

    const whole = toSnapshot(index);
    expect(whole.items[0]?.truncated).toBe(false);
    expect(whole.items[0]?.preview).toHaveLength(50);
  });

  it("carries id, title and links so a card can render without another request", () => {
    const index = buildVaultIndex(
      source({ "a.md": '---\nid: note-1\ntitle: "The Cottage"\n---\nsee [[b]]' }),
    );
    const item = toSnapshot(index).items[0];
    expect(item?.id).toBe("note-1");
    expect(item?.title).toBe("The Cottage");
    expect(item?.links).toEqual([{ target: "b", alias: null }]);
  });

  it("leaves mentions empty unless they were computed", () => {
    const index = buildVaultIndex(source({ "a.md": "the cottage", "cottage.md": "" }));
    expect(toSnapshot(index).mentions).toEqual([]);
    expect(toSnapshot(index, { mentions: unlinkedMentions(index) }).mentions).toEqual([
      { source: "a.md", target: "cottage.md", count: 1 },
    ]);
  });
});
