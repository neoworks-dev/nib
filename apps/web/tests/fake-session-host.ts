import type { Disposer } from "@nib-ui/kernel";
import type {
  AnyAgentEvent,
  HarnessAdapter,
  HarnessRegistry,
  MessageRole,
  MessageView,
  ModelInfo,
  SessionCommand,
  SessionStatus,
  SessionSummary,
  SessionView,
} from "@nib-ui/protocol";
import { createSessionView, sessionDigest } from "@nib-ui/protocol";
import type { AgentControlProvider, SessionHost } from "../src/lib/server/services";

/** One completed message with prose in it, which is all a digest reads. */
export function message(role: MessageRole, text: string): MessageView {
  return {
    id: `${role}:${text}`,
    role,
    completed: true,
    stopReason: null,
    blocks: [
      {
        id: `${role}:${text}:block`,
        messageId: `${role}:${text}`,
        kind: "text",
        toolName: null,
        toolUseId: null,
        text,
        inputJson: "",
        content: null,
        completed: true,
      },
    ],
  };
}

/**
 * Enough of the host for the agent tools to drive: sessions whose status can be
 * moved, lineage between them, and the subscription a waiting `read_agent` blocks on.
 */
export class FakeSessionHost implements SessionHost {
  readonly views = new Map<string, SessionView>();
  readonly commands: { sessionId: string; command: SessionCommand }[] = [];
  readonly created: {
    harnessId: string;
    cwd: string;
    label?: string;
    options?: Record<string, unknown>;
    parentSessionId?: string;
  }[] = [];
  /** Sessions whose harness process is gone; `list()` reports them as not live. */
  readonly detached = new Set<string>();
  /** When set, the next `create` logs this as a start failure the way the real host does. */
  failNextCreate: string | null = null;
  private readonly listeners = new Map<string, Set<(event: AnyAgentEvent) => void>>();
  private seq = 0;

  add(sessionId: string, overrides: Partial<SessionView> = {}): SessionView {
    const view: SessionView = {
      ...createSessionView(sessionId),
      harnessId: "claude-code",
      cwd: "/repo",
      ...overrides,
    };
    this.views.set(sessionId, view);
    return view;
  }

  /** Moves a session's status the way the host does, and tells its subscribers. */
  status(sessionId: string, status: SessionStatus): void {
    const view = this.views.get(sessionId);
    if (view) this.views.set(sessionId, { ...view, status });
    this.seq += 1;
    const event: AnyAgentEvent = {
      id: `e${this.seq}`,
      sessionId,
      seq: this.seq,
      ts: this.seq,
      type: "session.status",
      data: { status },
    };
    for (const listener of this.listeners.get(sessionId) ?? []) listener(event);
  }

  subscriberCount(sessionId: string): number {
    return this.listeners.get(sessionId)?.size ?? 0;
  }

  useAgentControl(_provider: AgentControlProvider): Disposer {
    return () => {};
  }

  create(input: {
    harnessId: string;
    cwd: string;
    label?: string;
    options?: Record<string, unknown>;
    parentSessionId?: string;
  }): Promise<string> {
    this.created.push(input);
    const sessionId = `spawned-${this.created.length}`;
    const model = input.options?.model;
    const view = this.add(sessionId, {
      harnessId: input.harnessId,
      cwd: input.cwd,
      title: input.label ?? null,
      model: typeof model === "string" ? model : null,
      parentSessionId: input.parentSessionId ?? null,
    });
    if (this.failNextCreate !== null) {
      this.views.set(sessionId, { ...view, status: "error", statusDetail: this.failNextCreate });
      this.failNextCreate = null;
    }
    return Promise.resolve(sessionId);
  }

  resume(): Promise<string> {
    throw new Error("the fake host does not resume");
  }

  execute(sessionId: string, command: SessionCommand): Promise<void> {
    if (!this.views.has(sessionId)) throw new Error(`unknown session "${sessionId}"`);
    this.commands.push({ sessionId, command });
    if (command.type === "session.send") this.status(sessionId, "working");
    if (command.type === "session.close") this.status(sessionId, "closed");
    return Promise.resolve();
  }

  eventsSince(): AnyAgentEvent[] {
    return [];
  }

  subscribe(sessionId: string, listener: (event: AnyAgentEvent) => void): Disposer {
    const listeners = this.listeners.get(sessionId) ?? new Set<(event: AnyAgentEvent) => void>();
    this.listeners.set(sessionId, listeners);
    listeners.add(listener);
    return () => void listeners.delete(listener);
  }

  list(): SessionSummary[] {
    return [...this.views.values()].map((view) => ({
      id: view.sessionId,
      harnessId: view.harnessId ?? "claude-code",
      cwd: view.cwd ?? "/repo",
      title: view.title,
      status: view.status,
      model: view.model,
      archived: view.archived,
      createdAt: 0,
      updatedAt: 0,
      lastSeq: view.lastSeq,
      live: !this.detached.has(view.sessionId),
      resumable: true,
      nativeSessionId: view.nativeSessionId,
      parentSessionId: view.parentSessionId,
      digest: sessionDigest(view),
    }));
  }

  view(sessionId: string): SessionView | undefined {
    return this.views.get(sessionId);
  }

  has(sessionId: string): boolean {
    return this.views.has(sessionId);
  }

  remove(sessionId: string): Promise<void> {
    this.views.delete(sessionId);
    return Promise.resolve();
  }
}

const capabilities = {
  interrupt: true,
  permissionModes: ["default"],
  resume: true,
  fork: false,
  slashCommands: false,
  models: true,
};

/** The models the fake pi runtime reports as authenticated. */
export const piRuntimeModels: ModelInfo[] = [
  { id: "default", displayName: "Default" },
  { id: "anthropic/claude-opus-5", displayName: "Claude Opus 5", description: "anthropic" },
  { id: "deepseek/deepseek-v4.1", displayName: "DeepSeek V4.1", description: "deepseek" },
  {
    id: "deepseek/deepseek-v4.1-flash",
    displayName: "DeepSeek V4.1 Flash",
    description: "deepseek",
  },
];

/**
 * Two harnesses, shaped like the real pair that differs most: Claude Code names
 * its models statically and only a running session knows more; pi asks its
 * runtime.
 */
const fakeAdapters: HarnessAdapter[] = [
  {
    id: "claude-code",
    displayName: "Claude Code",
    capabilities,
    defaultPermissionMode: "default",
    defaultModel: "default",
    models: [
      { id: "default", displayName: "Default" },
      { id: "opus", displayName: "Opus" },
    ],
    createSession: () => Promise.reject(new Error("the fake harness never starts")),
  },
  {
    id: "pi",
    displayName: "pi",
    capabilities: { ...capabilities, permissionModes: [], effortLevels: ["low", "high"] },
    defaultPermissionMode: "unrestricted",
    defaultModel: "default",
    models: [{ id: "default", displayName: "Default" }],
    listModels: () => Promise.resolve(piRuntimeModels),
    createSession: () => Promise.reject(new Error("the fake harness never starts")),
  },
];

export const fakeHarnesses: HarnessRegistry = {
  register: () => () => {},
  get: (id) => fakeAdapters.find((adapter) => adapter.id === id),
  list: () =>
    fakeAdapters.map(
      ({ id, displayName, capabilities, defaultPermissionMode, models, defaultModel }) => ({
        id,
        displayName,
        capabilities,
        defaultPermissionMode,
        models,
        defaultModel,
      }),
    ),
};
