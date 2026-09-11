import type { Disposer } from "@nib-ui/kernel";
import type {
  BoardSummary,
  CanvasRegistry,
  SessionsService,
  TransportService,
} from "@nib-ui/ui-contracts";
import { type ProjectRow, projectRows, type WorkstreamRow } from "./projects";

const collapsedKey = "nib-ui.sidebar.collapsed";

function loadCollapsed(): boolean {
  try {
    return localStorage.getItem(collapsedKey) === "true";
  } catch {
    return false;
  }
}

/**
 * The project list's own state. The board index is server-side and covers every
 * directory, so it is fetched rather than derived: only the board of the project
 * on screen is ever loaded in full.
 */
class SidebarState {
  transport = $state<TransportService | null>(null);
  sessions = $state<SessionsService | null>(null);
  canvas = $state<CanvasRegistry | null>(null);

  boards = $state<BoardSummary[]>([]);
  collapsed = $state(false);
  error = $state<string | null>(null);

  get projects(): ProjectRow[] {
    return projectRows(
      this.boards,
      this.sessions?.summaries ?? [],
      this.sessions?.recentDirectories ?? [],
    );
  }

  /** Directory whose board is on screen, so the list can mark where the user is. */
  get openPath(): string {
    return this.canvas?.cwd ?? "";
  }

  async refresh(): Promise<void> {
    const transport = this.transport;
    if (!transport) return;
    try {
      this.boards = await transport.listBoards();
      this.error = null;
    } catch (cause) {
      this.error = cause instanceof Error ? cause.message : "the project list could not be read";
    }
  }

  /** Board writes from other windows land in the index too, so it is polled rather than pushed. */
  startPolling(intervalMs = 5_000): Disposer {
    const tick = () => {
      if (document.visibilityState === "visible") void this.refresh();
    };
    const timer = setInterval(tick, intervalMs);
    document.addEventListener("visibilitychange", tick);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", tick);
    };
  }

  async open(path: string): Promise<void> {
    const canvas = this.canvas;
    if (!canvas || path.length === 0) return;
    await canvas.openBoard(path);
    await this.remember(path);
  }

  async openWorkstream(row: WorkstreamRow): Promise<void> {
    const canvas = this.canvas;
    if (!canvas) return;
    await canvas.openWorkstream(row.cwd, row.id);
    await this.remember(row.cwd);
  }

  /** Marking a workstream read is what takes it out of the list; it is not a board edit. */
  async review(row: WorkstreamRow, reviewed: boolean): Promise<void> {
    const transport = this.transport;
    if (!transport) return;
    try {
      await transport.reviewWorkstream(row.cwd, row.id, reviewed);
    } catch (cause) {
      this.error = cause instanceof Error ? cause.message : "the workstream could not be marked";
    }
    await this.refresh();
  }

  /** The board the user was last in, so a cold start lands on work rather than on nothing. */
  async restoreLastProject(): Promise<void> {
    const transport = this.transport;
    if (!transport || this.openPath.length > 0) return;
    const preferences = await transport.readUserConfig().catch(() => null);
    if (preferences?.lastProject) await this.open(preferences.lastProject);
  }

  setCollapsed(collapsed: boolean): void {
    this.collapsed = collapsed;
    try {
      localStorage.setItem(collapsedKey, String(collapsed));
    } catch {
      // A blocked storage quota costs the preference, not the toggle.
    }
  }

  attach(services: {
    transport: TransportService;
    sessions: SessionsService;
    canvas: CanvasRegistry;
  }): void {
    this.transport = services.transport;
    this.sessions = services.sessions;
    this.canvas = services.canvas;
    this.collapsed = loadCollapsed();
  }

  detach(): void {
    this.transport = null;
    this.sessions = null;
    this.canvas = null;
    this.boards = [];
    this.error = null;
  }

  private async remember(path: string): Promise<void> {
    await this.transport?.saveLastProject(path).catch(() => undefined);
    await this.refresh();
  }
}

export const sidebarState = new SidebarState();
