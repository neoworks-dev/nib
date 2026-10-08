// ACP, as the shared harness reports it, translated into nib's events.
//
// ACP streams content and tool calls without saying where a message starts or
// ends, so the mapper keeps an assistant message open from its first content
// until the turn is done, or until the harness names a different message id.
// Text and thinking accumulate into one block each until something else comes
// between them. A tool call is a `tool_use` block from its first report; its
// input fills in over later updates, and its result becomes a `tool_result`
// block in the same message once the call has finished.

import type { HarnessEvent, SessionUpdate, StopReason, Usage } from "@neoworks/harness";
import type {
  EmitEvent,
  HarnessCapabilities,
  MessageAttachment,
  SlashCommandInfo,
} from "@nib-ui/protocol";

type ToolCallReport = Extract<SessionUpdate, { sessionUpdate: "tool_call" | "tool_call_update" }>;
type ContentChunk = Extract<SessionUpdate, { sessionUpdate: "agent_message_chunk" }>;
type PlanUpdate = Extract<SessionUpdate, { sessionUpdate: "plan" }>;

/** The tool the task list renders, and what a plan is shown as. */
const todoToolName = "TodoWrite";

interface OpenMessage {
  id: string;
  /** The harness's id for it, once a chunk has named one. */
  acpId: string | null;
  blocks: number;
}

interface OpenText {
  blockId: string;
  kind: "text" | "thinking";
  text: string;
}

interface TrackedCall {
  blockId: string;
  messageId: string;
  toolName: string;
  /** The input as last reported, serialized to tell a change from a repeat. */
  inputJson: string;
  /** What a shell command printed, from the terminal reports. */
  terminalOutput: string | null;
  /** The text content of the latest report that had some. */
  contentText: string | null;
  finished: boolean;
}

/** Translates one session's harness events into nib's, through `emit`. */
export class AcpEventMapper {
  private message: OpenMessage | null = null;
  private openText: OpenText | null = null;
  private readonly calls = new Map<string, TrackedCall>();
  private lastUsage = "";
  private plans = 0;

  constructor(
    private readonly emit: EmitEvent,
    private readonly harnessId: string,
    private readonly cwd: string,
    private readonly capabilities: HarnessCapabilities,
  ) {}

  /** The session exists in the harness under `nativeSessionId`, which is what resumes it. */
  attached(nativeSessionId: string): void {
    this.emit({
      type: "session.created",
      data: {
        harnessId: this.harnessId,
        cwd: this.cwd,
        nativeSessionId,
        capabilities: this.capabilities,
      },
    });
  }

  /**
   * The prompt as the transcript shows it. The harness does not echo prompts
   * back, so the user's message is recorded here, as it is sent.
   */
  userMessage(text: string, attachments?: MessageAttachment[]): void {
    this.closeMessage(undefined);
    const messageId = crypto.randomUUID();
    const blockId = `${messageId}:0`;
    this.emit({ type: "message.started", data: { messageId, role: "user", attachments } });
    this.emit({ type: "block.started", data: { messageId, blockId, kind: "text" } });
    this.emit({ type: "block.completed", data: { blockId, content: { kind: "text", text } } });
    this.emit({ type: "message.completed", data: { messageId } });
    this.emit({ type: "session.status", data: { status: "working" } });
  }

  /** One event from the harness session. */
  handle(event: HarnessEvent): void {
    if (event.type === "update") {
      this.handleUpdate(event.update);
      return;
    }
    if (event.type === "usage") {
      this.handleUsage(event.total);
      return;
    }
    if (event.type === "session_changed") {
      this.handleSessionChanged(event.sessionId);
      return;
    }
    if (event.type === "done") {
      this.finishTurn(event.stopReason);
    }
    // Permission requests are answered through `onPermission`, which reports them.
  }

  /** The turn ended without a result: the harness failed or the process went away. */
  failTurn(error: unknown): void {
    this.closeMessage(undefined);
    this.emit({ type: "session.status", data: { status: "error", detail: describeError(error) } });
  }

  private handleUpdate(update: SessionUpdate): void {
    // A subagent's work runs inside its tool call; the parent's stream only
    // shows the call itself.
    if (parentToolCallOf(update) !== null) {
      return;
    }
    switch (update.sessionUpdate) {
      case "agent_message_chunk":
        return this.appendText("text", update);
      case "agent_thought_chunk":
        return this.appendText("thinking", update);
      case "tool_call":
      case "tool_call_update":
        return this.reportToolCall(update);
      case "plan":
        return this.reportPlan(update);
      case "available_commands_update":
        return this.reportCommands(update.availableCommands);
      case "session_info_update":
        return this.reportTitle(update.title);
      case "compaction_update":
        return this.reportCompaction(update.status);
      // Prompts are recorded as they are sent; the rest is either repeated by a
      // `usage` event or set by nib itself.
      case "user_message_chunk":
      case "usage_update":
      case "current_mode_update":
      case "config_option_update":
      case "compaction_summary_chunk":
        return;
      default:
        this.emit({
          type: "ext",
          data: { ns: "acp", type: update.sessionUpdate, data: update },
        });
    }
  }

  private appendText(kind: "text" | "thinking", chunk: ContentChunk): void {
    if (chunk.content.type !== "text") {
      return;
    }
    const messageId = this.ensureMessage(chunk.messageId ?? null);
    const open = this.openText;
    if (open !== null && open.kind === kind) {
      open.text += chunk.content.text;
      this.emit({ type: "block.delta", data: { blockId: open.blockId, textDelta: chunk.content.text } });
      return;
    }
    this.closeText();
    const blockId = this.nextBlockId();
    this.openText = { blockId, kind, text: chunk.content.text };
    this.emit({ type: "block.started", data: { messageId, blockId, kind } });
    this.emit({ type: "block.delta", data: { blockId, textDelta: chunk.content.text } });
  }

  private reportToolCall(update: ToolCallReport): void {
    let call = this.calls.get(update.toolCallId);
    if (call === undefined) {
      call = this.startToolCall(update);
    }
    this.absorbToolInput(update, call);
    absorbToolOutput(update, call);
    if (update.status === "completed" || update.status === "failed") {
      this.finishToolCall(update.toolCallId, call, update);
    }
  }

  private startToolCall(update: ToolCallReport): TrackedCall {
    this.closeText();
    const messageId = this.ensureMessage(null);
    const blockId = this.nextBlockId();
    const call: TrackedCall = {
      blockId,
      messageId,
      toolName: toolNameOf(update),
      inputJson: "",
      terminalOutput: null,
      contentText: null,
      finished: false,
    };
    this.calls.set(update.toolCallId, call);
    this.emit({
      type: "block.started",
      data: {
        messageId,
        blockId,
        kind: "tool_use",
        toolName: call.toolName,
        toolUseId: update.toolCallId,
      },
    });
    return call;
  }

  /** The call's input, re-sent whenever the harness has filled in more of it. */
  private absorbToolInput(update: ToolCallReport, call: TrackedCall): void {
    if (update.rawInput === undefined || update.rawInput === null) {
      return;
    }
    const inputJson = JSON.stringify(update.rawInput);
    if (inputJson === call.inputJson || inputJson === "{}") {
      return;
    }
    call.inputJson = inputJson;
    this.emit({
      type: "block.completed",
      data: {
        blockId: call.blockId,
        content: {
          kind: "tool_use",
          toolName: call.toolName,
          toolUseId: update.toolCallId,
          input: update.rawInput,
        },
      },
    });
  }

  private finishToolCall(toolCallId: string, call: TrackedCall, update: ToolCallReport): void {
    if (call.finished) {
      return;
    }
    call.finished = true;
    const blockId = `${call.blockId}:result`;
    this.emit({
      type: "block.started",
      data: {
        messageId: call.messageId,
        blockId,
        kind: "tool_result",
        toolName: call.toolName,
        toolUseId: toolCallId,
      },
    });
    this.emit({
      type: "block.completed",
      data: {
        blockId,
        content: {
          kind: "tool_result",
          toolUseId: toolCallId,
          output: toolOutputOf(call, update.rawOutput),
          isError: update.status === "failed",
        },
      },
    });
  }

  /** A plan is shown the way Claude's own task list is: as a `TodoWrite` call. */
  private reportPlan(update: PlanUpdate): void {
    this.closeText();
    const messageId = this.ensureMessage(null);
    const blockId = this.nextBlockId();
    this.plans += 1;
    const toolUseId = `plan-${messageId}-${this.plans}`;
    const todos = update.entries.map((entry) => ({
      content: entry.content,
      activeForm: entry.content,
      status: entry.status,
    }));
    this.emit({
      type: "block.started",
      data: { messageId, blockId, kind: "tool_use", toolName: todoToolName, toolUseId },
    });
    this.emit({
      type: "block.completed",
      data: {
        blockId,
        content: { kind: "tool_use", toolName: todoToolName, toolUseId, input: { todos } },
      },
    });
  }

  private reportCommands(
    commands: { name: string; description: string; input?: unknown }[],
  ): void {
    const slashCommands: SlashCommandInfo[] = commands.map((command) => ({
      name: command.name,
      description: command.description,
      argumentHint: argumentHintOf(command.input),
    }));
    this.emit({ type: "session.meta", data: { slashCommands } });
  }

  private reportTitle(title: string | null | undefined): void {
    if (typeof title !== "string" || title.trim().length === 0) {
      return;
    }
    this.emit({ type: "session.meta", data: { label: title } });
  }

  private reportCompaction(status: string): void {
    if (status === "in_progress") {
      this.emit({ type: "log", data: { level: "info", message: "compacting the conversation" } });
      return;
    }
    if (status === "failed") {
      this.emit({ type: "log", data: { level: "warn", message: "compacting the conversation failed" } });
    }
  }

  /** The session's running totals; only a change is worth a log entry. */
  private handleUsage(total: Usage): void {
    const data = {
      inputTokens: total.input ?? 0,
      outputTokens: total.output ?? 0,
      cacheReadTokens: total.cacheRead,
      costUsd: total.costUsd,
    };
    const serialized = JSON.stringify(data);
    if (serialized === this.lastUsage) {
      return;
    }
    this.lastUsage = serialized;
    this.emit({ type: "usage.updated", data });
  }

  /** The harness started a new conversation (`/clear`); the transcript follows it. */
  private handleSessionChanged(nativeSessionId: string): void {
    this.closeMessage(undefined);
    this.calls.clear();
    this.emit({ type: "session.cleared", data: { reason: "session_changed" } });
    this.attached(nativeSessionId);
  }

  private finishTurn(stopReason: StopReason): void {
    this.closeMessage(stopReason);
    const notice = stopNotice(stopReason);
    if (notice !== null) {
      this.emit({ type: "log", data: { level: "warn", message: notice } });
    }
    this.emit({ type: "session.status", data: { status: "idle" } });
  }

  /**
   * The open assistant message, or a new one. A chunk naming another message id
   * than the open one starts a message of its own.
   */
  private ensureMessage(acpId: string | null): string {
    const open = this.message;
    if (open !== null && (acpId === null || open.acpId === null || open.acpId === acpId)) {
      if (open.acpId === null) {
        open.acpId = acpId;
      }
      return open.id;
    }
    this.closeMessage(undefined);
    const messageId = crypto.randomUUID();
    this.message = { id: messageId, acpId, blocks: 0 };
    this.emit({ type: "message.started", data: { messageId, role: "assistant" } });
    return messageId;
  }

  private nextBlockId(): string {
    const message = this.message;
    if (message === null) {
      throw new Error("a block needs an open message");
    }
    const blockId = `${message.id}:${message.blocks}`;
    message.blocks += 1;
    return blockId;
  }

  private closeText(): void {
    const open = this.openText;
    if (open === null) {
      return;
    }
    this.openText = null;
    this.emit({
      type: "block.completed",
      data: { blockId: open.blockId, content: { kind: open.kind, text: open.text } },
    });
  }

  private closeMessage(stopReason: string | undefined): void {
    this.closeText();
    const message = this.message;
    if (message === null) {
      return;
    }
    this.message = null;
    this.emit({ type: "message.completed", data: { messageId: message.id, stopReason } });
  }
}

/** What a terminal or content report adds to a call's output. */
function absorbToolOutput(update: ToolCallReport, call: TrackedCall): void {
  const meta = asRecord(update._meta);
  const delta = asRecord(meta.terminal_output_delta);
  if (typeof delta.data === "string") {
    call.terminalOutput = (call.terminalOutput ?? "") + delta.data;
  }
  const whole = asRecord(meta.terminal_output);
  if (typeof whole.data === "string") {
    call.terminalOutput = whole.data;
  }
  const text = contentTextOf(update.content);
  if (text !== null) {
    call.contentText = text;
  }
}

/**
 * A finished call's result as renderers read it: what a command printed, else
 * the harness's own result text, else the text it showed, else whatever it
 * reported raw.
 */
function toolOutputOf(call: TrackedCall, rawOutput: unknown): unknown {
  if (call.terminalOutput !== null) {
    return call.terminalOutput;
  }
  if (typeof rawOutput === "string") {
    return rawOutput;
  }
  const rawText = contentTextOf(asRecord(rawOutput).content);
  if (rawText !== null) {
    return rawText;
  }
  if (call.contentText !== null) {
    return call.contentText;
  }
  if (rawOutput === undefined || rawOutput === null) {
    return "";
  }
  return rawOutput;
}

/** The text of ACP tool call content, or of a content block array; null when there is none. */
function contentTextOf(content: unknown): string | null {
  if (!Array.isArray(content)) {
    return null;
  }
  const texts: string[] = [];
  for (const entry of content) {
    const text = textOf(entry);
    if (text !== null) {
      texts.push(text);
    }
  }
  if (texts.length === 0) {
    return null;
  }
  return texts.join("\n");
}

/** The text of one content entry: ACP's `{ type: "content", content }` or a bare block. */
function textOf(entry: unknown): string | null {
  const record = asRecord(entry);
  if (record.type === "content") {
    return textOf(record.content);
  }
  if (record.type === "text" && typeof record.text === "string") {
    return record.text;
  }
  return null;
}

/** The harness's own name for a tool, which renderers resolve on. */
export function toolNameOf(update: { name?: string | null; title?: string | null; _meta?: unknown }): string {
  if (update.name) {
    return update.name;
  }
  const claudeCode = asRecord(asRecord(update._meta).claudeCode);
  if (typeof claudeCode.toolName === "string") {
    return claudeCode.toolName;
  }
  if (update.title) {
    return update.title;
  }
  return "tool";
}

/** The tool call an update belongs to when a subagent produced it. */
function parentToolCallOf(update: SessionUpdate): string | null {
  const meta = asRecord(update._meta);
  const neoworks = asRecord(meta.neoworks).parentToolCallId;
  if (typeof neoworks === "string") {
    return neoworks;
  }
  const claude = asRecord(meta.claudeCode).parentToolUseId;
  if (typeof claude === "string") {
    return claude;
  }
  return null;
}

function argumentHintOf(input: unknown): string | undefined {
  const hint = asRecord(input).hint;
  if (typeof hint === "string") {
    return hint;
  }
  return undefined;
}

/** What to tell the person about a turn that stopped short of finishing. */
function stopNotice(stopReason: StopReason): string | null {
  if (stopReason === "max_tokens") {
    return "The reply hit the output token limit.";
  }
  if (stopReason === "max_turn_requests") {
    return "The turn hit its request or budget limit.";
  }
  if (stopReason === "refusal") {
    return "The model declined to continue.";
  }
  return null;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null) {
    return {};
  }
  return value as Record<string, unknown>;
}

function describeError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
