import { afterAll, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  absoluteUrl,
  assertPublicUrl,
  BlockedUrlError,
  fetchLinkPreview,
  isBlockedAddress,
  parseLinkMetadata,
} from "../src/lib/server/link-preview";

describe("isBlockedAddress", () => {
  const blocked = [
    ["loopback v4", "127.0.0.1"],
    ["loopback, not just .0.1", "127.9.9.9"],
    ["this network", "0.0.0.0"],
    ["private 10/8", "10.1.2.3"],
    ["private 172.16/12", "172.16.0.1"],
    ["private 172.31, still in range", "172.31.255.255"],
    ["private 192.168/16", "192.168.1.1"],
    ["link local", "169.254.169.254"],
    ["carrier grade nat", "100.64.0.1"],
    ["benchmarking", "198.18.0.1"],
    ["ietf protocol assignments", "192.0.0.1"],
    ["multicast", "224.0.0.1"],
    ["broadcast", "255.255.255.255"],
    ["loopback v6", "::1"],
    ["unspecified v6", "::"],
    ["unique local v6", "fd00::1"],
    ["link local v6", "fe80::1"],
    ["multicast v6", "ff02::1"],
    ["v4-mapped loopback", "::ffff:127.0.0.1"],
    ["not an address at all", "localhost"],
  ] as const;

  for (const [reason, address] of blocked) {
    it(`blocks ${reason} (${address})`, () => {
      expect(isBlockedAddress(address)).toBe(true);
    });
  }

  const allowed = [
    "1.1.1.1",
    "8.8.8.8",
    "172.32.0.1",
    "192.167.1.1",
    "99.1.1.1",
    "2606:4700::1111",
  ];

  for (const address of allowed) {
    it(`allows the public address ${address}`, () => {
      expect(isBlockedAddress(address)).toBe(false);
    });
  }
});

describe("assertPublicUrl", () => {
  const resolvesTo =
    (...addresses: string[]) =>
    () =>
      Promise.resolve(addresses);

  it("accepts a host that resolves to a public address", async () => {
    await assertPublicUrl(new URL("https://example.com/page"), resolvesTo("93.184.216.34"));
  });

  it("rejects a scheme that is not http", async () => {
    expect(assertPublicUrl(new URL("file:///etc/passwd"))).rejects.toBeInstanceOf(BlockedUrlError);
    expect(assertPublicUrl(new URL("data:text/html,<b>hi</b>"))).rejects.toBeInstanceOf(
      BlockedUrlError,
    );
  });

  it("rejects a host that resolves to a private address", async () => {
    expect(
      assertPublicUrl(new URL("http://intranet.test/"), resolvesTo("10.0.0.5")),
    ).rejects.toBeInstanceOf(BlockedUrlError);
  });

  it("rejects when any record is private, not just the first", async () => {
    expect(
      assertPublicUrl(new URL("http://rebind.test/"), resolvesTo("1.1.1.1", "127.0.0.1")),
    ).rejects.toBeInstanceOf(BlockedUrlError);
  });

  it("rejects a literal private address without consulting dns", async () => {
    expect(
      assertPublicUrl(new URL("http://127.0.0.1:8080/"), resolvesTo("1.1.1.1")),
    ).rejects.toBeInstanceOf(BlockedUrlError);
    expect(
      assertPublicUrl(new URL("http://[::1]:8080/"), resolvesTo("1.1.1.1")),
    ).rejects.toBeInstanceOf(BlockedUrlError);
  });

  it("rejects a host that resolves to nothing", async () => {
    expect(assertPublicUrl(new URL("http://nowhere.test/"), resolvesTo())).rejects.toBeInstanceOf(
      BlockedUrlError,
    );
  });
});

describe("parseLinkMetadata", () => {
  it("prefers open graph over everything else", () => {
    const metadata = parseLinkMetadata(`
			<html><head>
				<title>Tab title</title>
				<meta name="description" content="plain description">
				<meta property="og:title" content="Graph title">
				<meta property="og:description" content="Graph description">
				<meta property="og:image" content="https://cdn.test/card.png">
			</head><body></body></html>
		`);

    expect(metadata).toEqual({
      title: "Graph title",
      description: "Graph description",
      image: "https://cdn.test/card.png",
    });
  });

  it("falls back to twitter tags when there is no open graph", () => {
    const metadata = parseLinkMetadata(`
			<head>
				<meta name="twitter:title" content="Bird title">
				<meta name="twitter:image" content="/card.png">
			</head>
		`);

    expect(metadata.title).toBe("Bird title");
    expect(metadata.image).toBe("/card.png");
  });

  it("falls back to the title tag and the plain description", () => {
    const metadata = parseLinkMetadata(
      '<head><title>Only a title</title><meta name="description" content="d"></head>',
    );

    expect(metadata).toEqual({ title: "Only a title", description: "d" });
  });

  it("reports nothing found rather than guessing", () => {
    expect(parseLinkMetadata("<html><body><h1>No head here</h1></body></html>")).toEqual({
      title: "",
    });
  });

  it("takes a relative favicon as written, for the caller to resolve", () => {
    const metadata = parseLinkMetadata('<head><link rel="icon" href="../favicon.ico"></head>');

    expect(metadata.favicon).toBe("../favicon.ico");
  });

  it("accepts shortcut icon and apple touch icon", () => {
    expect(parseLinkMetadata('<head><link rel="shortcut icon" href="/a.ico"></head>').favicon).toBe(
      "/a.ico",
    );
    expect(
      parseLinkMetadata('<head><link rel="apple-touch-icon" href="/b.png"></head>').favicon,
    ).toBe("/b.png");
  });

  it("decodes entities and collapses whitespace", () => {
    const metadata = parseLinkMetadata(
      '<head><title>Bread &amp;  butter&#39;s\n  best</title><meta property="og:description" content="a &lt;b&gt; c"></head>',
    );

    expect(metadata.title).toBe("Bread & butter's best");
    expect(metadata.description).toBe("a <b> c");
  });

  it("reads single-quoted and unquoted attributes", () => {
    const metadata = parseLinkMetadata(`<head><meta property='og:title' content=Terse></head>`);

    expect(metadata.title).toBe("Terse");
  });

  it("ignores tags in the body, so a comment cannot forge a preview", () => {
    const metadata = parseLinkMetadata(
      '<head><title>Real</title></head><body><meta property="og:title" content="Forged"></body>',
    );

    expect(metadata.title).toBe("Real");
  });

  it("the first of a repeated tag wins", () => {
    const metadata = parseLinkMetadata(
      '<head><meta property="og:title" content="First"><meta property="og:title" content="Second"></head>',
    );

    expect(metadata.title).toBe("First");
  });
});

describe("absoluteUrl", () => {
  const base = new URL("https://example.com/blog/post");

  it("resolves a relative href against the url the redirects ended at", () => {
    expect(absoluteUrl("/card.png", base)).toBe("https://example.com/card.png");
    expect(absoluteUrl("../icon.ico", base)).toBe("https://example.com/icon.ico");
  });

  it("leaves an absolute href alone", () => {
    expect(absoluteUrl("https://cdn.test/a.png", base)).toBe("https://cdn.test/a.png");
  });

  it("reports an unreadable href rather than throwing", () => {
    expect(absoluteUrl("http://[bad", base)).toBeUndefined();
  });
});

describe("fetchLinkPreview redirects", () => {
  const directory = mkdtempSync(join(tmpdir(), "nib-preview-"));
  afterAll(() => rmSync(directory, { recursive: true, force: true }));

  function page(html: string): Response {
    return new Response(html, { status: 200, headers: { "content-type": "text/html" } });
  }

  function redirect(to: string): Response {
    return new Response(null, { status: 302, headers: { location: to } });
  }

  it("follows a redirect and reports the url it landed on", async () => {
    const seen: string[] = [];
    const preview = await fetchLinkPreview("https://start.test/a", directory, {
      resolve: () => Promise.resolve(["1.1.1.1"]),
      fetchImpl: ((input: URL) => {
        seen.push(input.toString());
        return Promise.resolve(
          seen.length === 1
            ? redirect("https://end.test/b")
            : page("<head><title>Landed</title></head>"),
        );
      }) as unknown as typeof fetch,
    });

    expect(seen).toEqual(["https://start.test/a", "https://end.test/b"]);
    expect(preview.url).toBe("https://end.test/b");
    expect(preview.domain).toBe("end.test");
    expect(preview.title).toBe("Landed");
  });

  it("refuses a redirect that points at a private address", async () => {
    const attempted: string[] = [];
    const work = fetchLinkPreview("https://start.test/a", directory, {
      resolve: (hostname) =>
        Promise.resolve(hostname === "start.test" ? ["1.1.1.1"] : ["127.0.0.1"]),
      fetchImpl: ((input: URL) => {
        attempted.push(input.toString());
        return Promise.resolve(redirect("http://internal.test/admin"));
      }) as unknown as typeof fetch,
    });

    expect(work).rejects.toBeInstanceOf(BlockedUrlError);
    // The guard runs before the hop, so the private host is never requested.
    await work.catch(() => undefined);
    expect(attempted).toEqual(["https://start.test/a"]);
  });

  it("gives up rather than following a redirect loop", async () => {
    const work = fetchLinkPreview("https://loop.test/a", directory, {
      resolve: () => Promise.resolve(["1.1.1.1"]),
      fetchImpl: (() =>
        Promise.resolve(redirect("https://loop.test/a"))) as unknown as typeof fetch,
    });

    expect(work).rejects.toBeInstanceOf(BlockedUrlError);
  });

  it("a preview whose image cannot be fetched keeps everything else", async () => {
    const preview = await fetchLinkPreview("https://img.test/a", directory, {
      resolve: (hostname) => Promise.resolve(hostname === "img.test" ? ["1.1.1.1"] : ["10.0.0.1"]),
      fetchImpl: ((input: URL) => {
        if (input.hostname !== "img.test") return Promise.resolve(page("nope"));
        return Promise.resolve(
          page(
            '<head><title>Has image</title><meta property="og:image" content="http://cdn.internal/x.png"></head>',
          ),
        );
      }) as unknown as typeof fetch,
    });

    expect(preview.title).toBe("Has image");
    expect(preview.imageAssetId).toBeUndefined();
  });
});
