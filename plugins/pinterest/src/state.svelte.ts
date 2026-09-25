import type { Disposer } from "@nib-ui/kernel";
import {
  configurePinterest,
  disconnectPinterest,
  fetchPinterestBoards,
  fetchPinterestPins,
  fetchPinterestStatus,
  type PinterestCredentials,
  pinterestAuthPath,
  pinterestConnectedMessage,
  type PinterestStatus,
} from "./client";
import type { PinterestBoard, PinterestPin } from "./pins";

function reason(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

/**
 * What the pane and the settings section both read. Boards and pins are fetched
 * through the app's own server, which holds the tokens.
 */
class PinterestState {
  status = $state<PinterestStatus | null>(null);
  boards = $state<PinterestBoard[]>([]);
  pins = $state<PinterestPin[]>([]);
  boardId = $state<string | null>(null);
  loading = $state(false);
  error = $state<string | null>(null);
  /** Set by the plugin: the pane has nowhere else to send a user who has not connected yet. */
  openSettings = $state<(() => void) | null>(null);

  get connected(): boolean {
    return this.status?.connected ?? false;
  }

  async load(): Promise<void> {
    this.loading = true;
    try {
      this.status = await fetchPinterestStatus();
      this.error = null;
    } catch (cause) {
      this.error = reason(cause);
      this.loading = false;
      return;
    }
    this.loading = false;
    if (this.status.connected) await this.loadBoards();
  }

  async loadBoards(): Promise<void> {
    this.loading = true;
    try {
      this.boards = await fetchPinterestBoards();
      this.error = null;
      const first = this.boards[0];
      // The pane is a grid of pictures, so it opens on a board rather than on a
      // picker the user has to answer before seeing anything.
      const chosen = this.boards.find((board) => board.id === this.boardId) ?? first;
      if (chosen) {
        this.loading = false;
        await this.selectBoard(chosen.id);
        return;
      }
      this.pins = [];
    } catch (cause) {
      this.error = reason(cause);
    }
    this.loading = false;
  }

  async selectBoard(boardId: string): Promise<void> {
    this.boardId = boardId;
    this.loading = true;
    try {
      this.pins = await fetchPinterestPins(boardId);
      this.error = null;
    } catch (cause) {
      this.pins = [];
      this.error = reason(cause);
    }
    this.loading = false;
  }

  async configure(credentials: PinterestCredentials): Promise<void> {
    try {
      this.status = await configurePinterest(credentials);
      this.boards = [];
      this.pins = [];
      this.boardId = null;
      this.error = null;
    } catch (cause) {
      this.error = reason(cause);
    }
  }

  async disconnect(): Promise<void> {
    try {
      this.status = await disconnectPinterest();
      this.boards = [];
      this.pins = [];
      this.boardId = null;
      this.error = null;
    } catch (cause) {
      this.error = reason(cause);
    }
  }

  /** Sign-in happens on Pinterest, in a window of its own. */
  connect(): void {
    globalThis.open(pinterestAuthPath, "nib-pinterest-auth", "width=720,height=820");
  }

  /**
   * The callback window posts back once the tokens are stored; nothing else tells
   * the app the connection exists, since the sign-in never touched this document.
   */
  watchConnection(): Disposer {
    const onMessage = (event: MessageEvent): void => {
      if (event.origin !== globalThis.location.origin) return;
      if (event.data !== pinterestConnectedMessage) return;
      void this.load();
    };
    globalThis.addEventListener("message", onMessage);
    return () => {
      globalThis.removeEventListener("message", onMessage);
    };
  }
}

export const pinterestState = new PinterestState();
