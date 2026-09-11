import { describe, expect, test } from "bun:test";
import { displayHost, normalizeUrl } from "../src/url";

describe("normalizeUrl", () => {
  test("adds https to a bare host", () => {
    expect(normalizeUrl("example.com")).toBe("https://example.com/");
    expect(normalizeUrl("  example.com/docs?q=1  ")).toBe("https://example.com/docs?q=1");
    expect(normalizeUrl("sub.example.co.uk")).toBe("https://sub.example.co.uk/");
  });

  test("passes http and https through", () => {
    expect(normalizeUrl("https://example.com/a")).toBe("https://example.com/a");
    expect(normalizeUrl("http://example.com")).toBe("http://example.com/");
  });

  test("treats host:port as an authority, not a scheme", () => {
    expect(normalizeUrl("localhost:5173")).toBe("http://localhost:5173/");
    expect(normalizeUrl("example.com:8443/health")).toBe("https://example.com:8443/health");
  });

  test("searches for anything that is not host-like", () => {
    expect(normalizeUrl("svelte runes")).toBe("https://duckduckgo.com/?q=svelte%20runes");
    expect(normalizeUrl("svelte")).toBe("https://duckduckgo.com/?q=svelte");
    expect(normalizeUrl("what is a proxy?")).toBe(
      "https://duckduckgo.com/?q=what%20is%20a%20proxy%3F",
    );
  });

  test("rejects non-http schemes", () => {
    expect(normalizeUrl("javascript:alert(1)")).toBeNull();
    expect(normalizeUrl("JavaScript:alert(1)")).toBeNull();
    expect(normalizeUrl("file:///etc/passwd")).toBeNull();
    expect(normalizeUrl("data:text/html,<h1>hi</h1>")).toBeNull();
    expect(normalizeUrl("chrome://settings")).toBeNull();
  });

  test("rejects empty input", () => {
    expect(normalizeUrl("")).toBeNull();
    expect(normalizeUrl("   ")).toBeNull();
  });
});

describe("displayHost", () => {
  test("returns the hostname without the www prefix", () => {
    expect(displayHost("https://www.example.com/a/b")).toBe("example.com");
    expect(displayHost("http://localhost:5173/")).toBe("localhost");
    expect(displayHost("https://duckduckgo.com/?q=svelte")).toBe("duckduckgo.com");
  });

  test("returns an empty string when there is no host", () => {
    expect(displayHost("")).toBe("");
    expect(displayHost("not a url")).toBe("");
    expect(displayHost("file:///etc/passwd")).toBe("");
  });
});
