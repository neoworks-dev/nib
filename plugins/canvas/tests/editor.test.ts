import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { EditorStore } from "../src/editor.svelte";

const files: Record<string, string> = {
  "a.md": "# Alpha\n\nfirst\n",
  "b.md": "# Beta\n\nsecond\n",
  "fm.md": "---\nid: abc\n---\n# Gamma\n",
};

/**
 * Notes are read over `fetch` and written through the vault, and neither is here:
 * both ends are stubbed so what is under test is the store holding several open
 * notes at once, which is what a pane per sheet needs. The url a note is read
 * from is its path, because that is all the stub needs to answer.
 */
const realFetch = globalThis.fetch;

beforeAll(() => {
  globalThis.fetch = ((url: string) => {
    const body = files[url];
    return Promise.resolve(
      body === undefined ? new Response("", { status: 404 }) : new Response(body),
    );
  }) as unknown as typeof fetch;
});

afterAll(() => {
  globalThis.fetch = realFetch;
});

function store(): {
  editor: EditorStore;
  written: { path: string; text: string }[];
} {
  const editor = new EditorStore();
  const written: { path: string; text: string }[] = [];

  editor.fileUrl = (path) => path;
  editor.save = (path, text) => {
    written.push({ path, text });
    return Promise.resolve();
  };

  return { editor, written };
}

describe("open notes", () => {
  it("holds one note per path, so two sheets are two pages", async () => {
    const { editor } = store();
    await editor.open("a.md");
    await editor.open("b.md");

    expect(editor.note("a.md")?.text).toBe("# Alpha\n\nfirst\n");
    expect(editor.note("b.md")?.text).toBe("# Beta\n\nsecond\n");
  });

  it("opening a note that is already open keeps the edits it has", async () => {
    const { editor } = store();
    await editor.open("a.md");
    editor.setText("a.md", "Changed");
    await editor.open("a.md");

    expect(editor.note("a.md")?.text).toBe("Changed");
  });

  it("a file that will not read says so on that note alone", async () => {
    const { editor } = store();

    await editor.open("missing.md");
    await editor.open("a.md");

    expect(editor.note("missing.md")?.error).toContain("missing.md");
    expect(editor.note("a.md")?.error).toBeNull();
  });

  it("keeps frontmatter out of the text and writes it back untouched", async () => {
    const { editor, written } = store();
    await editor.open("fm.md");
    expect(editor.note("fm.md")?.text).toBe("# Gamma\n");

    editor.setText("fm.md", "# Gamma edited\n");
    await editor.flush();

    expect(written[0]?.text).toBe("---\nid: abc\n---\n# Gamma edited\n");
  });
});

describe("editing and saving", () => {
  it("an edit reaches the file it was made in, and no other", async () => {
    const { editor, written } = store();
    await editor.open("a.md");
    await editor.open("b.md");

    editor.setText("a.md", "# Alpha edited\n");
    await editor.flush();

    expect(written.map((entry) => entry.path)).toEqual(["a.md"]);
    expect(written[0]?.text).toBe("# Alpha edited\n");
  });

  it("two notes edited at once both reach disk", async () => {
    const { editor, written } = store();
    await editor.open("a.md");
    await editor.open("b.md");

    editor.setText("a.md", "one");
    editor.setText("b.md", "two");
    await editor.flush();

    expect(written.map((entry) => entry.path).sort()).toEqual(["a.md", "b.md"]);
  });

  it("the same text again is not an edit and writes nothing", async () => {
    const { editor, written } = store();
    await editor.open("a.md");

    editor.setText("a.md", "# Alpha\n\nfirst\n");
    await editor.flush();

    expect(written).toHaveLength(0);
  });

  it("closing a note writes what is unsaved and drops it", async () => {
    const { editor, written } = store();
    await editor.open("a.md");
    editor.setText("a.md", "closing");
    await editor.close("a.md");

    expect(written).toHaveLength(1);
    expect(editor.note("a.md")).toBeNull();
  });

  it("closing one note leaves the others open", async () => {
    const { editor } = store();
    await editor.open("a.md");
    await editor.open("b.md");
    await editor.close("a.md");

    expect(editor.note("a.md")).toBeNull();
    expect(editor.note("b.md")?.text).not.toBeNull();
  });
});

describe("the sticky", () => {
  const origin = { centre: { x: 100, y: 60 }, size: { w: 200, h: 120 }, zoom: 1, tilt: 0 };

  it("is one note laid over its own card, and closing it writes it", async () => {
    const { editor, written } = store();
    await editor.openSticky("a.md", origin);
    editor.setText("a.md", "typed");
    await editor.closeSticky();

    expect(editor.sticky).toBeNull();
    expect(editor.note("a.md")).toBeNull();
    expect(written[0]?.text).toBe("typed");
  });

  it("opening a second sticky closes the first", async () => {
    const { editor } = store();
    await editor.openSticky("a.md", origin);
    await editor.openSticky("b.md", origin);

    expect(editor.sticky?.path).toBe("b.md");
    expect(editor.note("a.md")).toBeNull();
    expect(editor.stickyNote()?.text).toBe("# Beta\n\nsecond\n");
  });
});
