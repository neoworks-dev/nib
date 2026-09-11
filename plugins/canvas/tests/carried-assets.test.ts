import { beforeEach, describe, expect, test } from "bun:test";
import type { Disposer } from "@nib-ui/kernel";
import type {
  BoardDoc,
  CanvasObject,
  CreateSessionInput,
  PaneRegistry,
  SessionsService,
  TransportService,
} from "@nib-ui/ui-contracts";
import { canvasState } from "../src/state.svelte";
import { type EdgeObject, isWorkstream, type WorkstreamObject } from "../src/workstream";

class FakeSessions {
  readonly created: CreateSessionInput[] = [];
  readonly sent: { sessionId: string; text: string; attachments?: unknown }[] = [];
  activeId: string | null = null;
  readonly summaries = [];
  readonly harnesses = [
    {
      id: "claude-code",
      displayName: "Claude Code",
      capabilities: {
        interrupt: true,
        permissionModes: ["default"],
        resume: true,
        fork: true,
        slashCommands: true,
        models: true,
      },
      defaultPermissionMode: "default",
      models: [{ id: "sonnet" }],
      defaultModel: "sonnet",
    },
  ];

  view() {
    return null;
  }

  async create(input: CreateSessionInput) {
    this.created.push(input);
    this.activeId = `s${this.created.length}`;
  }

  watch() {}

  async sendTo(sessionId: string, text: string, attachments?: unknown) {
    this.sent.push({ sessionId, text, attachments });
  }
}

class FakePanes {
  open(): string {
    return "i1";
  }

  instances() {
    return [];
  }

  reparam(): void {}
}

class FakeTransport {
  async loadBoard(cwd: string): Promise<BoardDoc> {
    return { version: 1, rev: 0, cwd, objects: [] };
  }

  async saveBoard(board: BoardDoc): Promise<BoardDoc> {
    return board;
  }

  subscribeBoard(): Disposer {
    return () => {};
  }
}

const picture: CanvasObject = {
  kind: "media",
  id: "media:1",
  x: 100,
  y: 100,
  assetId: "abc.png",
  name: "shot.png",
};

/** What `canvas-media` registers: a picture is worth the file it stands for. */
function mediaContext() {
  return canvasState.registry.registerContextProvider({
    contextFor: (object) =>
      object.kind === "media"
        ? {
            label: String(object.name ?? object.assetId),
            attachments: [
              { assetId: String(object.assetId), mime: "image/png", name: String(object.name) },
            ],
          }
        : null,
  });
}

function edges(): EdgeObject[] {
  return canvasState.objects.filter((object): object is EdgeObject => object.kind === "edge");
}

let sessions: FakeSessions;

beforeEach(async () => {
  canvasState.reset();
  sessions = new FakeSessions();
  canvasState.sessions = sessions as unknown as SessionsService;
  canvasState.panes = new FakePanes() as unknown as PaneRegistry;
  canvasState.board.transport = new FakeTransport() as unknown as TransportService;
  await canvasState.board.open("/repo");
  mediaContext();
  canvasState.board.addObject(picture);
});

describe("starting a workstream from an object", () => {
  test("the object is linked to the new card rather than described in it", () => {
    const id = canvasState.assetCard(["media:1"]);

    expect(id).not.toBeNull();
    expect(edges()).toMatchObject([{ fromId: "media:1", toId: id!, label: "context" }]);
    expect(canvasState.sourcesOf(id!)).toEqual([{ id: "media:1", title: "shot.png" }]);
  });

  test("an object no plugin speaks for still names itself and can be started from", () => {
    canvasState.board.addObject({
      kind: "sticky",
      id: "sticky:1",
      x: 0,
      y: 0,
      title: "rewrite the intro",
    });

    const id = canvasState.assetCard(["sticky:1"]);

    expect(id).not.toBeNull();
    expect(canvasState.sourcesOf(id!)).toEqual([{ id: "sticky:1", title: "rewrite the intro" }]);
  });

  test("a link is a relation, so nothing can be started from one", () => {
    const first = canvasState.createWorkstream("a", { x: 0, y: 0 });
    const second = canvasState.createWorkstream("b", { x: 400, y: 0 });
    canvasState.connect(first, second, "link");
    const edge = edges()[0]!;

    expect(canvasState.assetCard([edge.id])).toBeNull();
  });

  test("the card lands below what it was started from", () => {
    const id = canvasState.assetCard(["media:1"]);
    const card = canvasState.objects.find((object) => object.id === id) as WorkstreamObject;

    expect(card.y).toBeGreaterThan(100);
  });
});

describe("the files a workstream carries", () => {
  test("the first prompt takes them with it", async () => {
    const id = canvasState.assetCard(["media:1"])!;

    await canvasState.launch(id, "what is in this picture?");

    expect(sessions.sent).toEqual([
      {
        sessionId: "s1",
        text: "what is in this picture?",
        attachments: [{ assetId: "abc.png", mime: "image/png", name: "shot.png" }],
      },
    ]);
  });

  test("a file that has gone is not attached again", async () => {
    const id = canvasState.assetCard(["media:1"])!;
    await canvasState.launch(id, "what is in this picture?");

    expect(edges()[0]!.carried).toBe(true);
    expect(canvasState.carriedAttachments(id).attachments).toEqual([]);
  });

  test("a picture linked to a running task waits for its next prompt", () => {
    const id = canvasState.assetCard(["media:1"])!;
    canvasState.markCarried(edges().map((edge) => edge.id));

    canvasState.board.addObject({
      kind: "media",
      id: "media:2",
      x: 0,
      y: 0,
      assetId: "def.png",
      name: "other.png",
    });
    canvasState.connect("media:2", id, "context");

    expect(canvasState.carriedAttachments(id).attachments).toEqual([
      { assetId: "def.png", mime: "image/png", name: "other.png" },
    ]);
  });

  test("a node with nothing to attach travels as a line in the prompt", async () => {
    canvasState.registry.registerContextProvider({
      contextFor: (object) =>
        object.kind === "bookmark"
          ? { label: "Pixi docs", text: "Pixi docs — https://pixijs.com" }
          : null,
    });
    canvasState.board.addObject({
      kind: "bookmark",
      id: "bookmark:1",
      x: 0,
      y: 0,
      url: "https://pixijs.com",
    });
    const id = canvasState.assetCard(["bookmark:1"])!;

    await canvasState.launch(id, "read this and summarise it");

    expect(sessions.sent[0]!.attachments).toEqual([]);
    expect(sessions.sent[0]!.text).toContain("Pixi docs — https://pixijs.com");
    expect(sessions.sent[0]!.text).toContain("read this and summarise it");
  });

  test("an unclaimed node is named in the prompt by what the board calls it", async () => {
    canvasState.board.addObject({
      kind: "sticky",
      id: "sticky:1",
      x: 0,
      y: 0,
      title: "rewrite the intro",
    });
    const id = canvasState.assetCard(["sticky:1"])!;

    await canvasState.launch(id, "do it");

    expect(sessions.sent[0]!.text).toContain("rewrite the intro");
  });

  test("a picture is not repeated in the text: the attachment is what names it", async () => {
    const id = canvasState.assetCard(["media:1"])!;

    await canvasState.launch(id, "what is in this picture?");

    expect(sessions.sent[0]!.text).toBe("what is in this picture?");
  });

  test("another workstream travels as text, not as a file", async () => {
    const source = canvasState.createWorkstream("port the engine", { x: 0, y: 0 });
    const id = canvasState.branchCard(source)!;

    expect(canvasState.carriedAttachments(id).attachments).toEqual([]);
    expect(canvasState.sourcesOf(id).map((entry) => entry.id)).toEqual([source]);
    expect(cards()).toHaveLength(2);
  });
});

function cards(): WorkstreamObject[] {
  return canvasState.objects.filter(isWorkstream);
}
