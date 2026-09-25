import type { Disposer } from "@nib-ui/kernel";
import type { AgentControlLink } from "./agent-control";
import type { HarnessCapabilities, HarnessDescriptor } from "./capabilities";
import type { EmittedEvent, MessageAttachment, ModelInfo, PermissionBehavior } from "./events";

/** What an adapter calls to push a normalized event; the host stamps id/seq/sessionId/ts. */
export type EmitEvent = (event: EmittedEvent) => void;

export interface RewindResult {
  ok: boolean;
  filesChanged: string[];
  error?: string;
}

/**
 * An attachment the host has already resolved: the bytes exist at `path`, so an
 * adapter can hand the file to a harness that has no multimodal input at all.
 */
export interface SessionAttachment extends MessageAttachment {
  path: string;
}

/** One live run of a harness. Disposing it stops the process; the log survives. */
export interface HarnessSession {
  send(text: string, attachments?: readonly SessionAttachment[]): Promise<void>;
  interrupt(): Promise<void>;
  respondToPermission(
    requestId: string,
    response: { behavior: PermissionBehavior; updatedInput?: unknown },
  ): void;
  setPermissionMode?(mode: string): Promise<void>;
  setModel?(model: string): Promise<void>;
  setEffort?(effort: string): Promise<void>;
  /** Restores the working tree to the named checkpoint; the conversation is left alone. */
  rewind?(checkpointId: string): Promise<RewindResult>;
  dispose(): Promise<void>;
}

export interface CreateSessionOptions {
  cwd: string;
  options?: Record<string, unknown>;
  /**
   * How this session's agent reaches the agent-control tools. An adapter that
   * can take tools over MCP points its harness at `link.url`; one that only takes
   * in-process tools wraps `link.tools` instead. Absent when the host has no
   * agent-control service, in which case the agent works alone.
   */
  agentControl?: AgentControlLink;
}

export interface HarnessAdapter {
  id: string;
  displayName: string;
  capabilities: HarnessCapabilities;
  /** Announced before the harness process is up, so the composer never starts empty. */
  defaultPermissionMode: string;
  models: ModelInfo[];
  defaultModel?: string;
  /**
   * The models the harness will accept right now, for an agent choosing one
   * without a session open. Absent when the harness can only answer from a
   * running process, in which case `models` and any live session stand in.
   */
  listModels?(): Promise<ModelInfo[]>;
  createSession(opts: CreateSessionOptions, emit: EmitEvent): Promise<HarnessSession>;
  resumeSession?(
    nativeSessionId: string,
    opts: CreateSessionOptions & { fork?: boolean },
    emit: EmitEvent,
  ): Promise<HarnessSession>;
}

/**
 * The harness broker. An adapter is an ordinary component that registers through
 * a revertible effect, so unloading it withdraws it from the descriptor list and
 * from launch routing at once, and consumers of this service never rebind.
 */
export interface HarnessRegistry {
  register(adapter: HarnessAdapter): Disposer;
  get(id: string): HarnessAdapter | undefined;
  list(): HarnessDescriptor[];
}

// Declared here rather than in the host app so a harness plugin package can
// `inject: ["harnesses"]` without importing app source.
declare module "@nib-ui/kernel" {
  interface Services {
    harnesses: HarnessRegistry;
  }
}
