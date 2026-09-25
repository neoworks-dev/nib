import { describe, expect, test } from "bun:test";
import { openFence, renderMarkdown } from "../src/markdown";

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

describe("mermaid", () => {
  test("leaves a mermaid fence as a placeholder carrying its source", () => {
    const html = renderMarkdown("```mermaid\nflowchart TD\n  a --> b\n```");
    expect(html).toContain('class="mermaid"');
    expect(html).toContain("flowchart TD");
    expect(html).not.toContain("<pre>");
  });

  test("renders every other fence as code", () => {
    const html = renderMarkdown("```ts\nconst a = 1;\n```");
    expect(html).toContain("<pre>");
    expect(html).not.toContain('class="mermaid"');
  });

  test("escapes a source that would otherwise close the attribute", () => {
    const html = renderMarkdown('```mermaid\ngraph TD\n  a["<b>"]\n```');
    expect(html).not.toContain('<b>"]');
    expect(html).toContain("&lt;b&gt;");
  });
});

describe("openFence", () => {
  test("is true while a fence is still open", () => {
    expect(openFence("text\n```mermaid\nflowchart TD")).toBe(true);
  });

  test("is false once it closes", () => {
    expect(openFence("```mermaid\nflowchart TD\n```")).toBe(false);
  });
});

describe("math", () => {
  test("sets an inline formula", () => {
    const html = renderMarkdown("mass is $E = mc^2$ here");
    expect(html).toContain("katex");
    expect(html).not.toContain("$E = mc^2$");
  });

  test("sets a display formula", () => {
    expect(renderMarkdown("$$E = mc^2$$")).toContain("katex-display");
  });

  test("leaves two prices alone", () => {
    const html = renderMarkdown("it went from $5 to $10 overnight");
    expect(html).not.toContain("katex");
    expect(html).toContain("$5");
  });

  test("leaves a dollar sign in code alone", () => {
    const html = renderMarkdown("the `$PATH` of it");
    expect(html).not.toContain("katex");
    expect(html).toContain("$PATH");
  });
});
