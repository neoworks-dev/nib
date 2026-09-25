import { beforeEach, describe, expect, test } from "bun:test";
import { showUrl } from "../src/open";
import { maxTabCount, webBrowserState } from "../src/state.svelte";

describe("showUrl", () => {
  beforeEach(() => {
    webBrowserState.reset();
  });

  test("opens a tab on the url and makes it active", () => {
    expect(showUrl("example.com/docs")).toBe(true);
    expect(webBrowserState.tabs).toHaveLength(1);
    expect(webBrowserState.activeTab?.url).toBe("https://example.com/docs");
  });

  test("brings a page already on a tab forward instead of opening it twice", () => {
    showUrl("example.com");
    showUrl("other.example");
    expect(webBrowserState.tabs).toHaveLength(2);

    expect(showUrl("https://example.com/")).toBe(true);
    expect(webBrowserState.tabs).toHaveLength(2);
    expect(webBrowserState.activeTab?.url).toBe("https://example.com/");
  });

  test("at the tab cap the link takes the tab in front", () => {
    for (let index = 0; index < maxTabCount; index += 1) showUrl(`site-${index}.example`);
    expect(webBrowserState.tabs).toHaveLength(maxTabCount);
    const active = webBrowserState.activeId;

    expect(showUrl("late.example")).toBe(true);
    expect(webBrowserState.tabs).toHaveLength(maxTabCount);
    expect(webBrowserState.activeId).toBe(active);
    expect(webBrowserState.activeTab?.url).toBe("https://late.example/");
  });

  test("refuses a url that is not one, so no empty pane opens", () => {
    expect(showUrl("   ")).toBe(false);
    expect(webBrowserState.tabs).toHaveLength(0);
  });
});
