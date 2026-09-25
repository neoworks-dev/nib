import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { Plugin } from "@nib-ui/kernel";
import type { StoredAsset } from "../asset-store";
import { dataHome } from "../data-dir";
import { fetchRemoteImage } from "../link-preview";
import {
  AUTH_STATE_TTL_MS,
  authorizeUrl,
  createAuthState,
  exchangeCode,
  fetchAllPages,
  isPinterestImageUrl,
  parseBoards,
  parsePins,
  type PinterestBoard,
  type PinterestCredentials,
  type PinterestPin,
  PinterestApiError,
  type PinterestTokens,
  refreshTokens,
  tokensExpired,
} from "../pinterest";
import type { AssetService, PinterestService, PinterestStatus } from "../services";

interface PinterestFile {
  credentials?: PinterestCredentials;
  tokens?: PinterestTokens;
  /** The authorization in flight. One at a time, and only for as long as its ttl. */
  pendingState?: { value: string; createdAt: number };
}

export function pinterestFilePath(): string {
  return join(dataHome(), "pinterest.json");
}

/**
 * The app secret and both tokens live in this file, so it is written for the
 * user alone and never travels to the browser: `status` reports what is
 * connected, not what it is connected with.
 */
class PinterestStore implements PinterestService {
  private cached: PinterestFile | null = null;
  private refreshing: Promise<PinterestTokens> | null = null;

  constructor(
    private readonly path: string,
    private readonly assets: AssetService,
  ) {}

  async status(): Promise<PinterestStatus> {
    const file = await this.read();
    return {
      configured: Boolean(file.credentials),
      connected: Boolean(file.tokens),
      ...(file.credentials && {
        appId: file.credentials.appId,
        redirectUri: file.credentials.redirectUri,
      }),
      ...(file.tokens && { scope: file.tokens.scope }),
    };
  }

  async configure(credentials: PinterestCredentials): Promise<PinterestStatus> {
    // New credentials describe a different app, and tokens minted for the old one
    // are not valid against it.
    this.refreshing = null;
    await this.write({ credentials });
    return this.status();
  }

  async beginAuth(): Promise<string> {
    const file = await this.read();
    if (!file.credentials) throw new PinterestApiError("pinterest app is not configured", 400);

    const state = createAuthState();
    await this.write({ ...file, pendingState: { value: state, createdAt: Date.now() } });
    return authorizeUrl(file.credentials, state);
  }

  async completeAuth(code: string, state: string): Promise<void> {
    const file = await this.read();
    if (!file.credentials) throw new PinterestApiError("pinterest app is not configured", 400);

    const pending = file.pendingState;
    if (!pending || pending.value !== state) {
      throw new PinterestApiError("this authorization was not the one that was started", 400);
    }
    if (Date.now() - pending.createdAt > AUTH_STATE_TTL_MS) {
      throw new PinterestApiError("this authorization took too long — start it again", 400);
    }

    const tokens = await exchangeCode(file.credentials, code);
    await this.write({ credentials: file.credentials, tokens });
  }

  async disconnect(): Promise<void> {
    const file = await this.read();
    this.refreshing = null;
    await this.write({ ...(file.credentials && { credentials: file.credentials }) });
  }

  async boards(): Promise<PinterestBoard[]> {
    const pages = await fetchAllPages("/boards", await this.accessToken());
    return pages.flatMap(parseBoards);
  }

  async pins(boardId: string): Promise<PinterestPin[]> {
    const pages = await fetchAllPages(
      `/boards/${encodeURIComponent(boardId)}/pins`,
      await this.accessToken(),
    );
    return pages.flatMap(parsePins);
  }

  async storeImage(imageUrl: string): Promise<StoredAsset> {
    if (!isPinterestImageUrl(imageUrl)) {
      throw new PinterestApiError("that picture is not served by pinterest", 400);
    }
    return this.assets.store(await fetchRemoteImage(new URL(imageUrl)));
  }

  /** A live token, refreshed at most once at a time however many panes ask. */
  private async accessToken(): Promise<string> {
    const file = await this.read();
    if (!file.credentials || !file.tokens) {
      throw new PinterestApiError("pinterest is not connected", 401);
    }
    if (!tokensExpired(file.tokens)) return file.tokens.accessToken;

    const credentials = file.credentials;
    const refreshToken = file.tokens.refreshToken;
    if (refreshToken.length === 0) {
      throw new PinterestApiError("this connection expired — connect pinterest again", 401);
    }

    this.refreshing ??= refreshTokens(credentials, refreshToken)
      .then(async (tokens) => {
        await this.write({ credentials, tokens });
        return tokens;
      })
      .finally(() => {
        this.refreshing = null;
      });
    return (await this.refreshing).accessToken;
  }

  private async read(): Promise<PinterestFile> {
    if (this.cached) return this.cached;
    try {
      const stored: unknown = JSON.parse(await readFile(this.path, "utf8"));
      if (!stored || typeof stored !== "object") throw new Error("not an object");
      this.cached = stored as PinterestFile;
    } catch {
      // Never connected, or a file this build cannot read: either way there is
      // nothing to connect with until the user configures the app again.
      this.cached = {};
    }
    return this.cached;
  }

  private async write(file: PinterestFile): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    await writeFile(this.path, `${JSON.stringify(file, null, "\t")}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    this.cached = file;
  }
}

export const pinterestPlugin: Plugin = {
  name: "pinterest",
  inject: ["assets"],
  apply(ctx) {
    ctx.provide("pinterest", new PinterestStore(pinterestFilePath(), ctx.require("assets")));
  },
};
