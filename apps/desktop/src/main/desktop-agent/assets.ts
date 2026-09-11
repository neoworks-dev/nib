/**
 * Getting a capture into the asset store without its bytes crossing the renderer.
 *
 * The main process reads the file the sidecar wrote and posts it to `POST /api/assets`,
 * the route the board already uses for a pasted image. In production that request goes
 * through the SvelteKit handler this process already holds — no socket, no custom protocol
 * round trip, no assumption about whether `net.fetch` reaches an `app://` handler from the
 * main process. In development it goes to the Vite server over HTTP.
 */
import { readFile, unlink } from "node:fs/promises";

/** How the app is reached: the SvelteKit handler in production, a base URL in development. */
export type AppRequest = (request: Request) => Promise<Response>;

export interface StoredAsset {
  assetId: string;
  contentType: string;
  byteLength: number;
}

export function appRequestFor(
  developmentUrl: string | undefined,
  respond: AppRequest | null,
): AppRequest {
  if (developmentUrl) {
    const base = developmentUrl.replace(/\/$/, "");
    return (request) => fetch(new Request(`${base}${new URL(request.url).pathname}`, request));
  }
  if (respond) return respond;
  return () => Promise.reject(new Error("the app is not being served yet"));
}

/**
 * Uploads the file and then removes it, whatever the upload did. A capture left in
 * `$XDG_RUNTIME_DIR` is a screenshot of the user's desktop nobody is tracking any more.
 */
export async function uploadCapture(request: AppRequest, path: string): Promise<StoredAsset> {
  try {
    const bytes = await readFile(path);
    const response = await request(
      new Request("http://nib/api/assets", {
        method: "POST",
        headers: { "content-type": "image/png" },
        body: new Uint8Array(bytes),
      }),
    );
    if (!response.ok)
      throw new Error(
        `the asset store refused the capture: ${response.status} ${await response.text()}`,
      );
    return (await response.json()) as StoredAsset;
  } finally {
    await unlink(path).catch(() => {});
  }
}
