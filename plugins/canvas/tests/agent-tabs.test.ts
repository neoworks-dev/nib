import { beforeEach, describe, expect, test } from "bun:test";
import type { Disposer } from "@nib-ui/kernel";
import { createSessionView, type SessionView } from "@nib-ui/protocol";
import type {
  BoardDoc,
  BoardWrite,
  SessionsService,
  SessionSummary,
  TransportService,
} from "@nib-ui/ui-contracts";
import { canvasState } from "../src/state.svelte";

function summary(id: string, parentSessionId: string | null): SessionSummary {
  return {
    id,
    harnessId: "claude-code",
    cwd: "/repo",
    title: id,
    status: "idle",
    model: null,
    archived: false,
    createdAt: 1,
    updatedAt: 1,
    lastSeq: 0,
    live: true,
    resumable: true,
    nativeSessionId: null,
    parentSessionId,
    digest: { prompt: null, reply: null, recent: [] },
  };
}

class FakeSessions {
  summaries: SessionSummary[] = [];
  private readonly views: Record<string, SessionView> = {};

  hold(sessionId: string): void {
    this.views[sessionId] = createSessionView(sessionId);
  }

  view(sessionId: string): SessionView | null {
    return this.views[sessionId] ?? null;
  }

  watch(): void {}
}

class FakeTransport {
  loadBoard(cwd: string): Promise<BoardDoc> {
    return Promise.resolve({ version: 1, rev: 0, cwd, objects: [], placements: {} });
  }

  saveBoard(board: BoardWrite): Promise<BoardDoc> {
    return Promise.resolve({ ...board, placements: board.placements ?? {} });
  }

  subscribeBoard(): Disposer {
    return () => {};
  }
}

let sessions: FakeSessions;
let card: string;

beforeEach(async () => {
  canvasState.reset();
  sessions = new FakeSessions();
  sessions.summaries = [summary("root", null), summary("agent", "root"), summary("stranger", null)];
  for (const entry of sessions.summaries) sessions.hold(entry.id);
  canvasState.sessions = sessions as unknown as SessionsService;
  canvasState.board.transport = new FakeTransport() as unknown as TransportService;
  await canvasState.board.open("/repo");
  card = canvasState.createWorkstream("ship it", { x: 0, y: 0 });
  canvasState.board.updateObject(card, { sessionId: "root" });
});

describe("what a chat pane keyed to a card shows", () => {
  test("is the card's own session when the params ask for nothing else", () => {
    const target = canvasState.chatTarget({ workstreamId: card }, null);

    expect(target.workstream?.id).toBe(card);
    expect(target.session?.sessionId).toBe("root");
  });

  test("is the agent the tab asked for, with the pane still bound to the card", () => {
    const target = canvasState.chatTarget({ workstreamId: card, sessionId: "agent" }, null);

    expect(target.workstream?.id).toBe(card);
    expect(target.session?.sessionId).toBe("agent");
  });

  test("is the card's session again when the params name a session outside the family", () => {
    const target = canvasState.chatTarget({ workstreamId: card, sessionId: "stranger" }, null);

    expect(target.session?.sessionId).toBe("root");
  });
});
