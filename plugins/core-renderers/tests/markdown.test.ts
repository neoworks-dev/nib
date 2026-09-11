import { describe, expect, test } from "bun:test";
import { renderMarkdown } from "../src/markdown";

describe("renderMarkdown", () => {
  test("renders a bullet list as a single list element", () => {
    const html = renderMarkdown("- first\n- second\n- third");
    expect(html).toContain("<ul>");
    expect(html.match(/<li>/g)).toHaveLength(3);
    expect(html).not.toContain("<br>");
  });

  test("renders ordered lists and nested items", () => {
    const html = renderMarkdown("1. outer\n   - inner");
    expect(html).toContain("<ol>");
    expect(html).toContain("<ul>");
  });

  test("keeps single newlines inside a paragraph as line breaks", () => {
    expect(renderMarkdown("one\ntwo")).toContain("<br>");
  });

  test("renders fenced code with the language class", () => {
    const html = renderMarkdown("```ts\nconst value = 1;\n```");
    expect(html).toContain('<pre><code class="language-ts">');
    expect(html).toContain("const value = 1;");
  });

  test("escapes raw HTML instead of emitting markup", () => {
    const html = renderMarkdown('<img src=x onerror="alert(1)">');
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");
  });

  test("escapes HTML inside code spans", () => {
    expect(renderMarkdown("`<script>`")).toContain("<code>&lt;script&gt;</code>");
  });

  test("renders http links with a safe rel", () => {
    const html = renderMarkdown("[docs](https://example.com)");
    expect(html).toContain('href="https://example.com"');
    expect(html).toContain('rel="noreferrer noopener"');
  });

  test("drops links with an unsupported scheme but keeps their label", () => {
    const html = renderMarkdown("[click](javascript:alert(1))");
    expect(html).not.toContain("<a ");
    expect(html).toContain("click");
  });

  test("drops images with an unsupported scheme", () => {
    const html = renderMarkdown("![alt](javascript:alert(1))");
    expect(html).not.toContain("<img");
    expect(html).toContain("alt");
  });

  test("renders emphasis and inline code", () => {
    const html = renderMarkdown("**bold** and *italic* and `code`");
    expect(html).toContain("<strong>bold</strong>");
    expect(html).toContain("<em>italic</em>");
    expect(html).toContain("<code>code</code>");
  });
});
