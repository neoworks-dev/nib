import type { PinterestBoard, PinterestPin } from "./pins";

/** What the app knows about the connection. The secret never leaves the server. */
export interface PinterestStatus {
  configured: boolean;
  connected: boolean;
  appId?: string;
  redirectUri?: string;
  scope?: string;
}

export interface PinterestCredentials {
  appId: string;
  appSecret: string;
  redirectUri: string;
}

export interface PinAsset {
  assetId: string;
  contentType: string;
  byteLength: number;
}

/** Where the sign-in window is pointed. The redirect to Pinterest happens there. */
export const pinterestAuthPath = "/api/pinterest/auth";
/** Posted by the callback window to whoever opened it, once the tokens are stored. */
export const pinterestConnectedMessage = "nib-ui:pinterest-connected";

async function readJson<T>(response: Response): Promise<T> {
  if (!response.ok) throw new Error(await response.text());
  return (await response.json()) as T;
}

export async function fetchPinterestStatus(): Promise<PinterestStatus> {
  return readJson(await fetch("/api/pinterest"));
}

export async function configurePinterest(
  credentials: PinterestCredentials,
): Promise<PinterestStatus> {
  return readJson(
    await fetch("/api/pinterest", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(credentials),
    }),
  );
}

export async function disconnectPinterest(): Promise<PinterestStatus> {
  return readJson(await fetch("/api/pinterest", { method: "DELETE" }));
}

export async function fetchPinterestBoards(): Promise<PinterestBoard[]> {
  const payload = await readJson<{ boards: PinterestBoard[] }>(
    await fetch("/api/pinterest/boards"),
  );
  return payload.boards;
}

export async function fetchPinterestPins(boardId: string): Promise<PinterestPin[]> {
  const payload = await readJson<{ pins: PinterestPin[] }>(
    await fetch(`/api/pinterest/boards/${encodeURIComponent(boardId)}/pins`),
  );
  return payload.pins;
}

/**
 * Copies the picture into the asset store server-side. The board keeps an asset
 * id, so it still draws once the pin is gone from Pinterest.
 */
export async function storePinImage(imageUrl: string): Promise<PinAsset> {
  return readJson(
    await fetch("/api/pinterest/asset", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ imageUrl }),
    }),
  );
}
