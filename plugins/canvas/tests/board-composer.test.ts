import { beforeEach, describe, expect, test } from "bun:test";
import type { Disposer } from "@nib-ui/kernel";
import type {
  BoardDoc,
  CreateSessionInput,
  PaneRegistry,
  SessionsService,
  TransportService,
} from "@nib-ui/ui-contracts";
import { chatPaneId } from "../src/chat-pane";
import { canvasState } from "../src/state.svelte";
import { isWorkstream, type WorkstreamObject } from "../src/workstream";

/**
 * Enough of the sessions service for a launch: creating one makes it active,
 * which is how the board learns its id. A class rather than a literal, because a
 * literal assigned into `$state` is proxied and would not report its own writes.
 */
class FakeSessions {
  readonly created: CreateSessionInput[] = [];
  readonly sent: { sessionId: string; text: string }[] = [];
  activeId: string | null = null;
  readonly summaries = [];
  readonly harnesses = [
    {
      id: "claude-code",
      displayName: "Claude Code",
      capabilities: {
        interrupt: true,
        permissionModes: ["default", "plan"],
        resume: true,
        fork: true,
        slashCommands: true,
        models: true,
      },
      defaultPermissionMode: "default",
      models: [{ id: "opus" }, { id: "sonnet" }],
      defaultModel: "sonnet",
    },
  ];

  view() {
    return null;
  }

  /** Run while `create` is still going, the way the shell reacts to the new task. */
  onActive: ((sessionId: string) => Promise<void> | void) | null = null;

  async create(input: CreateSessionInput) {
    this.created.push(input);
    this.activeId = `s${this.created.length}`;
    // The real service makes the session active and then keeps working, so the
    // shell sees a live task before `create` has returned.
    await this.onActive?.(this.activeId);
  }

  watch() {}

  async sendTo(sessionId: string, text: string) {
    this.sent.push({ sessionId, text });
  }
}

/**
 * A board that lives in memory. Only `loadBoard` and `subscribeBoard` matter:
 * without a subscription the store treats every `open` of the same directory as
 * a fresh one and drops what is on it.
 */
class FakeTransport {
  readonly saved: BoardDoc[] = [];

  async loadBoard(cwd: string): Promise<BoardDoc> {
    return { version: 1, rev: 0, cwd, objects: [], placements: {} };
  }

  async saveBoard(board: BoardDoc): Promise<BoardDoc> {
    this.saved.push(board);
    return board;
  }

  subscribeBoard(): Disposer {
    return () => {};
  }
}

/** Only the two calls the board makes: opening a card's pane and re-keying it. */
class FakePanes {
  readonly opened: { paneId: string; params?: Record<string, unknown> }[] = [];
  readonly reparamed: { instanceId: string; params: Record<string, unknown> }[] = [];
  private readonly open_: { instanceId: string; params?: Record<string, unknown> }[] = [];

  open(paneId: string, params?: Record<string, unknown>): string {
    this.opened.push({ paneId, params });
    const instanceId = `i${this.open_.length + 1}`;
    this.open_.push({ instanceId, params });
    return instanceId;
  }

  instances() {
    return this.open_;
  }

  reparam(instanceId: string, params: Record<string, unknown>): void {
    this.reparamed.push({ instanceId, params });
    const instance = this.open_.find((entry) => entry.instanceId === instanceId);
    if (instance) instance.params = params;
  }
}

function cards(): WorkstreamObject[] {
  return canvasState.objects.filter(isWorkstream);
}

let sessions: FakeSessions;
let panes: FakePanes;

beforeEach(async () => {
  canvasState.reset();
  sessions = new FakeSessions();
  panes = new FakePanes();
  canvasState.sessions = sessions as unknown as SessionsService;
  canvasState.panes = panes as unknown as PaneRegistry;
  canvasState.board.transport = new FakeTransport() as unknown as TransportService;
  await canvasState.board.open("/repo");
});

describe("the board composer", () => {
  test("offers what a workstream would start with before there is one to ask", () => {
    expect(canvasState.boardSettings).toEqual({
      harnessId: "claude-code",
      model: "sonnet",
      permissionMode: "default",
      effort: null,
    });
  });

  test("a pick is held until it has a card to put it on, and stays for the next one", async () => {
    canvasState.configureBoard({ model: "opus", effort: "high" });
    expect(canvasState.boardSettings.model).toBe("opus");

    await canvasState.startWorkstream("port the engine", { x: 40, y: 60 });
    await canvasState.startWorkstream("and the renderer", { x: 40, y: 60 });

    expect(sessions.created.map((input) => input.options)).toEqual([
      { model: "opus", permissionMode: "default", effort: "high" },
      { model: "opus", permissionMode: "default", effort: "high" },
    ]);
  });

  test("another harness drops the picks made against the one before it", () => {
    canvasState.configureBoard({ model: "opus", effort: "high" });
    canvasState.configureBoard({ harnessId: "codex" });

    expect(canvasState.boardSettings).toMatchObject({
      harnessId: "codex",
      model: null,
      effort: null,
    });
  });

  test("sending puts a card on the board and starts it in one move", async () => {
    const id = await canvasState.startWorkstream("port the engine", { x: 40, y: 60 });

    expect(id).not.toBeNull();
    expect(cards()).toHaveLength(1);
    expect(cards()[0]).toMatchObject({
      id: id!,
      goal: "port the engine",
      x: 40,
      y: 60,
      sessionId: "s1",
    });
    expect(sessions.created[0]).toMatchObject({ harnessId: "claude-code", cwd: "/repo" });
    expect(sessions.sent).toEqual([{ sessionId: "s1", text: "port the engine" }]);
  });

  test("the transcript pane comes up with the card, and follows it onto its session", async () => {
    const id = await canvasState.startWorkstream("port the engine", { x: 40, y: 60 });

    expect(panes.opened).toEqual([{ paneId: chatPaneId, params: { workstreamId: id! } }]);
    expect(panes.reparamed).toEqual([
      { instanceId: "i1", params: { workstreamId: id!, sessionId: "s1" } },
    ]);
  });

  test("two sends in the same place are two cards, not one on top of another", async () => {
    await canvasState.startWorkstream("first", { x: 40, y: 60 });
    await canvasState.startWorkstream("second", { x: 40, y: 60 });

    const placed = cards();
    expect(placed).toHaveLength(2);
    expect(placed[0]!.x === placed[1]!.x && placed[0]!.y === placed[1]!.y).toBe(false);
  });

  test("the shell focusing the session mid-launch does not put a second card on the board", async () => {
    // What the board pane's own effect does the moment the new task becomes active.
    sessions.onActive = (sessionId) => canvasState.focus(sessionId, "/repo");

    const id = await canvasState.startWorkstream("port the engine", { x: 40, y: 60 });

    expect(cards()).toHaveLength(1);
    expect(cards()[0]).toMatchObject({ id: id!, sessionId: "s1" });
  });

  test("a session started outside the board still gets a card of its own", async () => {
    await canvasState.focus("s9", "/repo");

    expect(cards()).toHaveLength(1);
    expect(cards()[0]).toMatchObject({ sessionId: "s9", goal: "" });
  });

  test("a join is a card with its sources named on it, not a prompt to fill in first", async () => {
    const first = await canvasState.startWorkstream("port the engine", { x: 0, y: 0 });
    const second = await canvasState.startWorkstream("port the renderer", { x: 600, y: 0 });

    const joined = canvasState.join([first!, second!], { x: 300, y: 400 });

    expect(joined).not.toBeNull();
    expect(canvasState.sourcesOf(joined!).map((source) => source.id)).toEqual([first!, second!]);
  });

  test("an empty prompt is not a workstream", async () => {
    expect(await canvasState.startWorkstream("   ", { x: 0, y: 0 })).toBeNull();
    expect(cards()).toHaveLength(0);
  });

  test("with no project open it says so rather than stranding a card", async () => {
    canvasState.board.close();
    await canvasState.board.open("");

    expect(await canvasState.startWorkstream("port the engine", { x: 0, y: 0 })).toBeNull();
    expect(cards()).toHaveLength(0);
    expect(canvasState.error).toBe("open a project before starting a workstream");
  });
});
