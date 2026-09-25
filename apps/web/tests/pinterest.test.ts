import { describe, expect, it } from "bun:test";
import {
  authorizeUrl,
  exchangeCode,
  fetchAllPages,
  type FetchImpl,
  isPinterestImageUrl,
  parseBoards,
  parsePins,
  parseTokens,
  PinterestApiError,
  refreshTokens,
  tokensExpired,
} from "../src/lib/server/pinterest";

const credentials = {
  appId: "app-1",
  appSecret: "secret-1",
  redirectUri: "https://pins.example.com/api/pinterest/callback",
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

describe("authorizeUrl", () => {
  it("asks for the read scopes and carries the state", () => {
    const url = new URL(authorizeUrl(credentials, "state-1"));
    expect(url.origin + url.pathname).toBe("https://www.pinterest.com/oauth/");
    expect(url.searchParams.get("client_id")).toBe("app-1");
    expect(url.searchParams.get("redirect_uri")).toBe(credentials.redirectUri);
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("scope")).toBe("boards:read,pins:read");
    expect(url.searchParams.get("state")).toBe("state-1");
  });
});

describe("parseTokens", () => {
  it("turns the lifetime into an absolute expiry", () => {
    const tokens = parseTokens(
      { access_token: "at", refresh_token: "rt", expires_in: 1800, scope: "pins:read" },
      1_000_000,
    );
    expect(tokens).toEqual({
      accessToken: "at",
      refreshToken: "rt",
      expiresAt: 1_000_000 + 1_800_000,
      scope: "pins:read",
    });
  });

  it("keeps the refresh token a refresh response left out", () => {
    const tokens = parseTokens({ access_token: "at2", expires_in: 60 }, 0, "rt-held");
    expect(tokens.refreshToken).toBe("rt-held");
  });

  it("refuses a response with no access token", () => {
    expect(() => parseTokens({ refresh_token: "rt" }, 0)).toThrow(PinterestApiError);
  });
});

describe("tokensExpired", () => {
  const tokens = { accessToken: "at", refreshToken: "rt", expiresAt: 100_000, scope: "" };

  it("is true before the token actually lapses", () => {
    expect(tokensExpired(tokens, 20_000)).toBe(false);
    // Inside the skew: still valid, but not for long enough to start a request on.
    expect(tokensExpired(tokens, 60_000)).toBe(true);
    expect(tokensExpired(tokens, 200_000)).toBe(true);
  });
});

describe("isPinterestImageUrl", () => {
  it("accepts the pinterest cdn over https only", () => {
    expect(isPinterestImageUrl("https://i.pinimg.com/1200x/ab/cd.jpg")).toBe(true);
    expect(isPinterestImageUrl("https://pinimg.com/a.jpg")).toBe(true);
    expect(isPinterestImageUrl("http://i.pinimg.com/a.jpg")).toBe(false);
  });

  it("refuses anything else, including a host that only ends in the name", () => {
    expect(isPinterestImageUrl("https://evil.example.com/a.jpg")).toBe(false);
    expect(isPinterestImageUrl("https://notpinimg.com/a.jpg")).toBe(false);
    expect(isPinterestImageUrl("https://i.pinimg.com.evil.test/a.jpg")).toBe(false);
    expect(isPinterestImageUrl("file:///etc/passwd")).toBe(false);
    expect(isPinterestImageUrl("not a url")).toBe(false);
  });
});

describe("parseBoards", () => {
  it("reads the fields the pane shows", () => {
    const boards = parseBoards({
      items: [
        { id: "b1", name: "Interiors", pin_count: 42, media: { image_cover_url: "https://c/1" } },
        { id: "b2", pin_count: 0 },
        { name: "no id" },
      ],
    });
    expect(boards).toEqual([
      { id: "b1", name: "Interiors", pinCount: 42, coverUrl: "https://c/1" },
      { id: "b2", name: "b2", pinCount: 0 },
    ]);
  });

  it("is empty for a payload with no items", () => {
    expect(parseBoards({})).toEqual([]);
    expect(parseBoards(null)).toEqual([]);
  });
});

describe("parsePins", () => {
  const images = {
    "150x150": { url: "https://i.pinimg.com/150.jpg", width: 150, height: 150 },
    "1200x": { url: "https://i.pinimg.com/1200.jpg", width: 1200, height: 1600 },
    "600x": { url: "https://i.pinimg.com/600.jpg", width: 600, height: 800 },
  };

  it("takes the widest rendition, whatever order the keys are in", () => {
    const [pin] = parsePins({
      items: [{ id: "p1", title: "Stair", link: "https://example.com/s", media: { images } }],
    });
    expect(pin).toEqual({
      id: "p1",
      url: "https://www.pinterest.com/pin/p1/",
      title: "Stair",
      link: "https://example.com/s",
      imageUrl: "https://i.pinimg.com/1200.jpg",
      width: 1200,
      height: 1600,
    });
  });

  it("names a pin by its alt text or description when it has no title", () => {
    const pins = parsePins({
      items: [
        { id: "p2", title: "  ", alt_text: "Concrete stair", media: { images } },
        { id: "p3", description: "Only a description", media: { images } },
        { id: "p4", media: { images } },
      ],
    });
    expect(pins.map((pin) => pin.title)).toEqual([
      "Concrete stair",
      "Only a description",
      "Pin p4",
    ]);
    expect(pins[1]?.description).toBe("Only a description");
  });

  it("skips a pin with no picture to place", () => {
    expect(parsePins({ items: [{ id: "p5", media: { images: {} } }, { id: "p6" }] })).toEqual([]);
  });
});

interface FetchCall {
  url: URL;
  headers: Record<string, string>;
  body: URLSearchParams | undefined;
}

/** A fetch that answers from the test and records what it was asked. */
function recordingFetch(respond: (call: FetchCall) => Response): {
  calls: FetchCall[];
  impl: FetchImpl;
} {
  const calls: FetchCall[] = [];
  const impl: FetchImpl = (input, init) => {
    const body = init?.body;
    const call: FetchCall = {
      url: new URL(input.toString()),
      headers: { ...(init?.headers as Record<string, string> | undefined) },
      body: body instanceof URLSearchParams ? body : undefined,
    };
    calls.push(call);
    return Promise.resolve(respond(call));
  };
  return { calls, impl };
}

describe("exchangeCode", () => {
  it("sends the app credentials as basic auth and the code as a form", async () => {
    const { calls, impl } = recordingFetch(() =>
      jsonResponse({ access_token: "at", refresh_token: "rt", expires_in: 100 }),
    );
    const tokens = await exchangeCode(credentials, "code-1", impl);

    expect(tokens.accessToken).toBe("at");
    const call = calls[0];
    expect(call?.url.toString()).toBe("https://api.pinterest.com/v5/oauth/token");
    expect(call?.headers.authorization).toBe(`Basic ${btoa("app-1:secret-1")}`);
    expect(call?.body?.get("grant_type")).toBe("authorization_code");
    expect(call?.body?.get("code")).toBe("code-1");
    expect(call?.body?.get("redirect_uri")).toBe(credentials.redirectUri);
  });

  it("reports what pinterest refused, with its status", () => {
    const { impl } = recordingFetch(() => jsonResponse({ message: "bad code" }, 401));
    expect(exchangeCode(credentials, "code-1", impl)).rejects.toMatchObject({ status: 401 });
  });
});

describe("refreshTokens", () => {
  it("asks for a refresh grant", async () => {
    const { calls, impl } = recordingFetch(() =>
      jsonResponse({ access_token: "at2", expires_in: 100 }),
    );
    await refreshTokens(credentials, "rt-held", impl);

    expect(calls[0]?.body?.get("grant_type")).toBe("refresh_token");
    expect(calls[0]?.body?.get("refresh_token")).toBe("rt-held");
  });
});

describe("fetchAllPages", () => {
  it("follows the bookmark until pinterest stops sending one", async () => {
    const { calls, impl } = recordingFetch((call) => {
      const bookmark = call.url.searchParams.get("bookmark");
      if (bookmark === "b2") return jsonResponse({ items: ["third"] });
      const next = bookmark === "b1" ? "b2" : "b1";
      return jsonResponse({ items: [next], bookmark: next });
    });
    const pages = await fetchAllPages("/boards", "at", impl);

    expect(pages).toHaveLength(3);
    expect(calls[0]?.url.toString()).toBe("https://api.pinterest.com/v5/boards?page_size=100");
    expect(calls[2]?.url.searchParams.get("bookmark")).toBe("b2");
  });

  it("sends the access token as a bearer", async () => {
    const { calls, impl } = recordingFetch(() => jsonResponse({ items: [] }));
    await fetchAllPages("/boards", "at", impl);
    expect(calls[0]?.headers.authorization).toBe("Bearer at");
  });

  it("throws with pinterest's status when a page fails", () => {
    const { impl } = recordingFetch(() => new Response("rate limited", { status: 429 }));
    expect(fetchAllPages("/boards", "at", impl)).rejects.toMatchObject({ status: 429 });
  });
});
