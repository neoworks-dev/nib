import type { Context, Disposer, Plugin } from "@nib-ui/kernel";
import type {
  AnyAgentEvent,
  EmittedEvent,
  MessageAttachment,
  SessionCommand,
  SessionView,
} from "@nib-ui/protocol";
import {
  checkpointBefore,
  createSessionView,
  deriveTaskTitle,
  reduceSession,
  sessionDigest,
} from "@nib-ui/protocol";
import type {
  AgentControlProvider,
  CreateSessionOptions,
  HarnessRegistry,
  HarnessSession,
  SessionAttachment,
  SessionHost,
  SessionSummary,
} from "../services";
import { deleteSessionLog, HostedSession, readSessionLogs } from "../session-store";

export interface SessionHostConfig {
  /**
   * Where one project's transcripts are written. A function of the working
   * directory rather than a single path: a chat belongs to the project it is
   * about, so its log lives in that project's vault (PLAN §7).
   */
  logDirectoryFor(cwd: string): string;
  /** Every directory a transcript might be in, for the restore after a restart. */
  logDirectories(): string[];
}

class SessionHostService implements SessionHost {
  private readonly sessions = new Map<string, HostedSession>();
  private readonly reviving = new Map<string, Promise<void>>();
  private agentControl: AgentControlProvider | null = null;

  constructor(
    private readonly ctx: Context,
    private readonly harnesses: HarnessRegistry,
    private readonly config: SessionHostConfig,
  ) {}

  useAgentControl(provider: AgentControlProvider): Disposer {
    this.agentControl = provider;
    return () => {
      if (this.agentControl === provider) this.agentControl = null;
    };
  }

  async create(input: {
    harnessId: string;
    cwd: string;
    label?: string;
    options?: Record<string, unknown>;
    parentSessionId?: string;
  }): Promise<string> {
    const { adapter, hosted, emit } = this.prepare(input.harnessId, input.cwd);
    // The log has to describe its own session: without this the harness owns the
    // only record of which adapter and directory it belongs to, and a session
    // whose process never starts could never be restored after a restart.
    emit({
      type: "session.created",
      data: {
        harnessId: input.harnessId,
        cwd: input.cwd,
        capabilities: adapter.capabilities,
        parentSessionId: input.parentSessionId,
      },
    });
    // Pre-flight: the composer gets modes and models now, not after the first turn.
    emit({
      type: "session.meta",
      data: {
        label: input.label,
        permissionMode:
          readStringOption(input.options, "permissionMode") ?? adapter.defaultPermissionMode,
        model: readStringOption(input.options, "model") ?? adapter.defaultModel,
        models: adapter.models,
      },
    });
    const agentControl = await this.agentControl?.(hosted.id);
    await this.attach(hosted, () =>
      adapter.createSession({ cwd: input.cwd, options: input.options, agentControl }, emit),
    );
    return hosted.id;
  }

  async resume(input: {
    harnessId: string;
    cwd: string;
    nativeSessionId: string;
    fork?: boolean;
    options?: Record<string, unknown>;
  }): Promise<string> {
    const { adapter, hosted, emit } = this.prepare(input.harnessId, input.cwd);
    if (!adapter.resumeSession)
      throw new Error(`harness "${input.harnessId}" cannot resume sessions`);
    // A forked session is a session of its own, so its log has to describe itself
    // the same way a created one does — without this it is skipped on restore.
    emit({
      type: "session.created",
      data: { harnessId: input.harnessId, cwd: input.cwd, capabilities: adapter.capabilities },
    });
    emit({
      type: "session.meta",
      data: {
        permissionMode:
          readStringOption(input.options, "permissionMode") ?? adapter.defaultPermissionMode,
        model: readStringOption(input.options, "model") ?? adapter.defaultModel,
        models: adapter.models,
      },
    });
    const opts: CreateSessionOptions & { fork?: boolean } = {
      cwd: input.cwd,
      options: input.options,
      fork: input.fork,
      agentControl: await this.agentControl?.(hosted.id),
    };
    await this.attach(hosted, () => adapter.resumeSession!(input.nativeSessionId, opts, emit));
    return hosted.id;
  }

  async execute(sessionId: string, command: SessionCommand): Promise<void> {
    const hosted = this.require(sessionId);
    // Renaming, closing and resuming stay available after the harness process
    // is gone — reattaching a detached session is the whole point of resume.
    if (command.type === "session.setLabel") {
      return void this.emit(hosted, { type: "session.meta", data: { label: command.label } });
    }
    if (command.type === "session.setArchived") {
      return void this.emit(hosted, { type: "session.meta", data: { archived: command.archived } });
    }
    if (command.type === "session.close") return this.close(sessionId);
    if (command.type === "session.resume") {
      return this.reattach(
        hosted,
        command.nativeSessionId ?? hosted.view.nativeSessionId,
        command.fork,
      );
    }

    // Everything below drives the harness. A detached task reattaches on demand:
    // the user asked for work, not for a process.
    const session = hosted.harnessSession ?? (await this.revive(hosted));

    switch (command.type) {
      case "session.send": {
        // A task is named by what it was asked to do, so the first prompt titles it.
        if (!hosted.view.title) {
          const label = deriveTaskTitle(command.text);
          if (label) this.emit(hosted, { type: "session.meta", data: { label } });
        }
        const attachments = await this.resolveAttachments(hosted, command.attachments);
        return session.send(command.text, attachments);
      }
      case "session.interrupt":
        return session.interrupt();
      case "session.permission.respond":
        return session.respondToPermission(command.requestId, {
          behavior: command.behavior,
          updatedInput: command.updatedInput,
        });
      case "session.setPermissionMode":
        if (!session.setPermissionMode)
          throw new Error("harness does not support permission modes");
        return session.setPermissionMode(command.mode);
      case "session.setModel":
        if (!session.setModel) throw new Error("harness does not support model switching");
        return session.setModel(command.model);
      case "session.setEffort":
        if (!session.setEffort) throw new Error("harness does not support reasoning effort");
        return session.setEffort(command.effort);
      case "session.rewind":
        return this.rewind(hosted, session, command.messageId);
      case "session.create":
        throw new Error("session.create is not a per-session command");
    }
  }

  /**
   * Turns the metadata a command carries into files on disk. An asset that is no
   * longer in the store is dropped with a note on the log rather than failing the
   * send: the user asked for the prompt to go out, and the rest of it still can.
   */
  private async resolveAttachments(
    hosted: HostedSession,
    attachments: MessageAttachment[] | undefined,
  ): Promise<SessionAttachment[]> {
    if (!attachments || attachments.length === 0) return [];
    const assets = this.ctx.require("assets");
    const resolved: SessionAttachment[] = [];
    for (const attachment of attachments) {
      const path = await assets.path(attachment.assetId);
      if (!path) {
        this.emit(hosted, {
          type: "log",
          data: {
            level: "warn",
            message: `attachment "${attachment.name}" is no longer stored and was not sent`,
          },
        });
        continue;
      }
      resolved.push({ ...attachment, path });
    }
    return resolved;
  }

  /**
   * Only the working tree moves: the transcript keeps describing edits that are
   * no longer on disk, so the outcome is logged where the turn can show it.
   */
  private async rewind(
    hosted: HostedSession,
    session: HarnessSession,
    messageId: string,
  ): Promise<void> {
    const checkpointId = checkpointBefore(hosted.view, messageId);
    if (!session.rewind) throw new Error("harness does not support checkpoints");
    if (!checkpointId) throw new Error(`message "${messageId}" has no checkpoint to rewind to`);

    const result = await session.rewind(checkpointId);
    // A rewind that only deletes files reports no changed paths, so the count
    // is mentioned only when the harness actually named some.
    const changed = result.filesChanged.length;
    this.emit(hosted, {
      type: "log",
      data: {
        level: result.ok ? "info" : "warn",
        message: result.ok
          ? `restored the working tree to the state before this turn${changed > 0 ? ` (${changed} file(s))` : ""}`
          : `rewind failed: ${result.error ?? "unknown error"}`,
      },
    });
  }

  eventsSince(sessionId: string, fromSeq: number): AnyAgentEvent[] {
    return this.sessions.get(sessionId)?.eventsSince(fromSeq) ?? [];
  }

  subscribe(sessionId: string, listener: (event: AnyAgentEvent) => void): Disposer {
    return this.require(sessionId).subscribe(listener);
  }

  list(): SessionSummary[] {
    return [...this.sessions.values()].map((hosted) => ({
      id: hosted.id,
      harnessId: hosted.harnessId,
      cwd: hosted.cwd,
      title: hosted.view.title,
      status: hosted.view.status,
      model: hosted.view.model,
      archived: hosted.view.archived,
      createdAt: hosted.createdAt,
      updatedAt: hosted.updatedAt,
      lastSeq: hosted.view.lastSeq,
      live: hosted.harnessSession !== null,
      resumable: this.harnesses.get(hosted.harnessId)?.resumeSession !== undefined,
      nativeSessionId: hosted.view.nativeSessionId,
      parentSessionId: hosted.view.parentSessionId,
      digest: sessionDigest(hosted.view),
    }));
  }

  view(sessionId: string): SessionView | undefined {
    return this.sessions.get(sessionId)?.view;
  }

  has(sessionId: string): boolean {
    return this.sessions.has(sessionId);
  }

  /** Stops the harness process but keeps the transcript listable and resumable. */
  async close(sessionId: string): Promise<void> {
    const hosted = this.sessions.get(sessionId);
    if (!hosted) return;
    this.emit(hosted, { type: "session.status", data: { status: "closed" } });
    await hosted.harnessSession?.dispose();
    hosted.harnessSession = null;
  }

  async remove(sessionId: string): Promise<void> {
    const hosted = this.sessions.get(sessionId);
    if (!hosted) return;
    this.sessions.delete(sessionId);
    await hosted.dispose();
    deleteSessionLog(this.config.logDirectoryFor(hosted.cwd), sessionId);
  }

  async disposeAll(): Promise<void> {
    await Promise.all([...this.sessions.values()].map((hosted) => hosted.dispose()));
  }

  /**
   * Rebuilds every session the previous process logged, detached from any
   * harness. Transcripts are spread across the projects they belong to, so this
   * walks every vault a board has been opened for as well as the legacy
   * directory: a log whose project has been deleted is simply not found.
   */
  restore(): void {
    const logs = this.config
      .logDirectories()
      .flatMap((directory) => readSessionLogs(directory))
      .sort((left, right) => (left.events[0]?.ts ?? 0) - (right.events[0]?.ts ?? 0));

    for (const { id, events } of logs) {
      if (this.sessions.has(id)) continue;
      const view = events.reduce(reduceSession, createSessionView(id));
      if (!view.harnessId || !view.cwd) continue;
      const hosted = new HostedSession(
        id,
        view.harnessId,
        view.cwd,
        this.config.logDirectoryFor(view.cwd),
      );
      hosted.restore(events);
      this.sessions.set(id, hosted);
      // Tasks logged before titles existed would read as "Untitled" forever.
      if (!view.title) {
        const prompt = sessionDigest(view).prompt;
        const label = prompt === null ? null : deriveTaskTitle(prompt);
        if (label) this.emit(hosted, { type: "session.meta", data: { label } });
      }
      // A log that ends mid-turn would otherwise claim to still be working.
      if (view.status === "working" || view.status === "awaiting-permission") {
        this.emit(hosted, {
          type: "session.status",
          data: { status: "idle", detail: "harness process is not attached" },
        });
      }
    }
  }

  private prepare(harnessId: string, cwd: string) {
    const adapter = this.harnesses.get(harnessId);
    if (!adapter) throw new Error(`unknown harness "${harnessId}"`);
    const hosted = new HostedSession(
      crypto.randomUUID(),
      harnessId,
      cwd,
      this.config.logDirectoryFor(cwd),
    );
    this.sessions.set(hosted.id, hosted);
    return { adapter, hosted, emit: (event: EmittedEvent) => this.emit(hosted, event) };
  }

  private emit(hosted: HostedSession, event: EmittedEvent): void {
    this.ctx.emit("session/event", hosted.id, hosted.append(event));
  }

  /** Adapter failures become an error event on the log instead of a lost session. */
  private async attach(
    hosted: HostedSession,
    start: () => Promise<HostedSession["harnessSession"]>,
  ): Promise<void> {
    try {
      hosted.harnessSession = await start();
    } catch (error) {
      hosted.append({
        type: "session.status",
        data: { status: "error", detail: error instanceof Error ? error.message : String(error) },
      });
    }
  }

  /** Concurrent commands on one detached session share a single reattach. */
  private async revive(hosted: HostedSession): Promise<HarnessSession> {
    let pending = this.reviving.get(hosted.id);
    if (!pending) {
      pending = this.reattach(hosted, hosted.view.nativeSessionId).finally(() =>
        this.reviving.delete(hosted.id),
      );
      this.reviving.set(hosted.id, pending);
    }
    await pending;

    const session = hosted.harnessSession;
    if (!session) throw new Error(`session "${hosted.id}" could not be reattached to its harness`);
    return session;
  }

  private async reattach(
    hosted: HostedSession,
    nativeSessionId: string | null,
    fork?: boolean,
  ): Promise<void> {
    const adapter = this.harnesses.get(hosted.harnessId);
    if (!adapter?.resumeSession)
      throw new Error(`harness "${hosted.harnessId}" cannot resume sessions`);
    if (!nativeSessionId)
      throw new Error(`session "${hosted.id}" has no harness session id to resume from`);
    await hosted.harnessSession?.dispose();
    hosted.harnessSession = null;
    const emit = (event: EmittedEvent) => this.emit(hosted, event);
    // A session revived after a restart is as much an agent as a fresh one, so
    // it gets its own link rather than coming back without the tools.
    const agentControl = await this.agentControl?.(hosted.id);
    await this.attach(hosted, () =>
      adapter.resumeSession!(nativeSessionId, { cwd: hosted.cwd, fork, agentControl }, emit),
    );
  }

  private require(sessionId: string): HostedSession {
    const hosted = this.sessions.get(sessionId);
    if (!hosted) throw new Error(`unknown session "${sessionId}"`);
    return hosted;
  }
}

function readStringOption(
  options: Record<string, unknown> | undefined,
  key: string,
): string | undefined {
  const value = options?.[key];
  return typeof value === "string" ? value : undefined;
}

export const sessionHostPlugin: Plugin<SessionHostConfig> = {
  name: "session-host",
  inject: ["harnesses", "assets"],
  apply(ctx, config) {
    const host = new SessionHostService(ctx, ctx.require("harnesses"), config);
    host.restore();
    ctx.provide("sessionHost", host);
    ctx.effect(() => () => void host.disposeAll());
  },
};
