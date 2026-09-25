import { randomBytes } from "node:crypto";

export const PINTEREST_AUTHORIZE_URL = "https://www.pinterest.com/oauth/";
export const PINTEREST_API_BASE = "https://api.pinterest.com/v5";
/** Reading the boards and what is saved to them is all the pane does. */
export const PINTEREST_SCOPES = ["boards:read", "pins:read"];
/** Refreshed this far before the token actually lapses, so a slow request cannot race it. */
export const TOKEN_EXPIRY_SKEW_MS = 60_000;
/** An authorization the user never completed stops being accepted after this. */
export const AUTH_STATE_TTL_MS = 10 * 60_000;
const PAGE_SIZE = 100;
/** Pinterest paginates by bookmark; this caps how many pages one listing walks. */
const MAX_PAGES = 10;

export interface PinterestCredentials {
  appId: string;
  appSecret: string;
  /**
   * Compared byte for byte against the app's registered redirect, so it is the
   * user's to supply: Pinterest requires https, which a dev server rarely serves.
   */
  redirectUri: string;
}

export interface PinterestTokens {
  accessToken: string;
  refreshToken: string;
  /** Epoch milliseconds. */
  expiresAt: number;
  scope: string;
}

export interface PinterestBoard {
  id: string;
  name: string;
  pinCount: number;
  coverUrl?: string;
}

export interface PinterestPin {
  id: string;
  /** The pin's own page, which is what a board card links back to. */
  url: string;
  title: string;
  description?: string;
  /** Where the pin points off Pinterest, when it points anywhere. */
  link?: string;
  imageUrl: string;
  width: number;
  height: number;
}

export class PinterestApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "PinterestApiError";
  }
}

export function authorizeUrl(credentials: PinterestCredentials, state: string): string {
  const url = new URL(PINTEREST_AUTHORIZE_URL);
  url.searchParams.set("client_id", credentials.appId);
  url.searchParams.set("redirect_uri", credentials.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", PINTEREST_SCOPES.join(","));
  url.searchParams.set("state", state);
  return url.toString();
}

export function createAuthState(): string {
  return randomBytes(16).toString("hex");
}

export function pinPageUrl(pinId: string): string {
  return `https://www.pinterest.com/pin/${encodeURIComponent(pinId)}/`;
}

export function tokensExpired(tokens: PinterestTokens, now = Date.now()): boolean {
  return tokens.expiresAt - TOKEN_EXPIRY_SKEW_MS <= now;
}

/**
 * The pictures a pin carries are only ever served from Pinterest's own CDN. The
 * url arrives from the API rather than from the user, and narrowing the host it
 * may point at keeps the copy step from becoming a general fetch proxy.
 */
export function isPinterestImageUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      (url.hostname === "pinimg.com" || url.hostname.endsWith(".pinimg.com"))
    );
  } catch {
    return false;
  }
}

/**
 * A refresh response may leave the refresh token out, which means the one already
 * held stays valid — dropping it would end the connection at the next expiry.
 */
export function parseTokens(
  raw: unknown,
  now: number,
  currentRefreshToken?: string,
): PinterestTokens {
  const payload = raw as Partial<{
    access_token: string;
    refresh_token: string;
    expires_in: number;
    scope: string;
  }> | null;
  const accessToken = payload?.access_token;
  if (typeof accessToken !== "string" || accessToken.length === 0) {
    throw new PinterestApiError("no access token in the response", 502);
  }

  const refreshToken =
    typeof payload?.refresh_token === "string"
      ? payload.refresh_token
      : (currentRefreshToken ?? "");
  const expiresIn = typeof payload?.expires_in === "number" ? payload.expires_in : 3600;
  return {
    accessToken,
    refreshToken,
    expiresAt: now + expiresIn * 1000,
    scope: typeof payload?.scope === "string" ? payload.scope : PINTEREST_SCOPES.join(","),
  };
}

export function parseBoards(raw: unknown): PinterestBoard[] {
  const items = (raw as { items?: unknown })?.items;
  if (!Array.isArray(items)) return [];

  const boards: PinterestBoard[] = [];
  for (const item of items) {
    const board = item as Partial<{
      id: string;
      name: string;
      pin_count: number;
      media: { image_cover_url?: string };
    }>;
    if (typeof board.id !== "string" || board.id.length === 0) continue;
    boards.push({
      id: board.id,
      name: typeof board.name === "string" && board.name.length > 0 ? board.name : board.id,
      pinCount: typeof board.pin_count === "number" ? board.pin_count : 0,
      ...(typeof board.media?.image_cover_url === "string" && {
        coverUrl: board.media.image_cover_url,
      }),
    });
  }
  return boards;
}

interface PinImage {
  url?: string;
  width?: number;
  height?: number;
}

/**
 * Pinterest returns one entry per rendition, keyed by a size name like `600x` or
 * `1200x`. The widest is the one worth putting on a board, and the keys are not
 * ordered, so they are compared rather than picked by name.
 */
function largestImage(images: unknown): PinImage | null {
  if (!images || typeof images !== "object") return null;
  let best: PinImage | null = null;
  for (const candidate of Object.values(images as Record<string, PinImage>)) {
    if (typeof candidate?.url !== "string" || candidate.url.length === 0) continue;
    if (!best || (candidate.width ?? 0) > (best.width ?? 0)) best = candidate;
  }
  return best;
}

export function parsePins(raw: unknown): PinterestPin[] {
  const items = (raw as { items?: unknown })?.items;
  if (!Array.isArray(items)) return [];

  const pins: PinterestPin[] = [];
  for (const item of items) {
    const pin = item as Partial<{
      id: string;
      title: string;
      description: string;
      alt_text: string;
      link: string;
      media: { images?: unknown };
    }>;
    if (typeof pin.id !== "string" || pin.id.length === 0) continue;
    const image = largestImage(pin.media?.images);
    // A pin whose media is a video or a carousel the API declines to describe has
    // no picture to place, and the pane is a grid of pictures.
    if (!image?.url) continue;

    const title = [pin.title, pin.alt_text, pin.description].find(
      (value) => typeof value === "string" && value.trim().length > 0,
    );
    pins.push({
      id: pin.id,
      url: pinPageUrl(pin.id),
      title: title?.trim() ?? `Pin ${pin.id}`,
      ...(typeof pin.description === "string" &&
        pin.description.trim().length > 0 && { description: pin.description.trim() }),
      ...(typeof pin.link === "string" && pin.link.length > 0 && { link: pin.link }),
      imageUrl: image.url,
      width: typeof image.width === "number" ? image.width : 0,
      height: typeof image.height === "number" ? image.height : 0,
    });
  }
  return pins;
}

/** Only what these calls need, so a test can hand over a plain function. */
export type FetchImpl = (input: URL | string, init?: RequestInit) => Promise<Response>;

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!response.ok) {
    throw new PinterestApiError(
      text.length > 0 ? text.slice(0, 400) : `pinterest responded ${response.status}`,
      response.status,
    );
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new PinterestApiError("pinterest returned a body that is not json", 502);
  }
}

async function requestTokens(
  credentials: PinterestCredentials,
  body: URLSearchParams,
  currentRefreshToken: string | undefined,
  fetchImpl: FetchImpl,
): Promise<PinterestTokens> {
  const basic = Buffer.from(`${credentials.appId}:${credentials.appSecret}`).toString("base64");
  const response = await fetchImpl(`${PINTEREST_API_BASE}/oauth/token`, {
    method: "POST",
    // The app credentials go in the header; Pinterest rejects them in the body.
    headers: {
      authorization: `Basic ${basic}`,
      "content-type": "application/x-www-form-urlencoded",
    },
    body,
  });
  return parseTokens(await readJson(response), Date.now(), currentRefreshToken);
}

export function exchangeCode(
  credentials: PinterestCredentials,
  code: string,
  fetchImpl: FetchImpl = fetch,
): Promise<PinterestTokens> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: credentials.redirectUri,
  });
  return requestTokens(credentials, body, undefined, fetchImpl);
}

export function refreshTokens(
  credentials: PinterestCredentials,
  refreshToken: string,
  fetchImpl: FetchImpl = fetch,
): Promise<PinterestTokens> {
  const body = new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken });
  return requestTokens(credentials, body, refreshToken, fetchImpl);
}

/**
 * Walks the bookmark pagination and hands back every page's payload. The caller
 * parses them, because boards and pins differ only in what an item is.
 */
export async function fetchAllPages(
  path: string,
  accessToken: string,
  fetchImpl: FetchImpl = fetch,
): Promise<unknown[]> {
  const pages: unknown[] = [];
  let bookmark: string | undefined;

  for (let page = 0; page < MAX_PAGES; page += 1) {
    const url = new URL(`${PINTEREST_API_BASE}${path}`);
    url.searchParams.set("page_size", String(PAGE_SIZE));
    if (bookmark) url.searchParams.set("bookmark", bookmark);

    const payload = await readJson(
      await fetchImpl(url, { headers: { authorization: `Bearer ${accessToken}` } }),
    );
    pages.push(payload);

    const next = (payload as { bookmark?: unknown }).bookmark;
    if (typeof next !== "string" || next.length === 0) break;
    bookmark = next;
  }
  return pages;
}
