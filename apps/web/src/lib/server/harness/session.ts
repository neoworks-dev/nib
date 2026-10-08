// One nib session on a shared-harness session.
//
// The harness session does the work; this keeps nib's side of it: logging what
// it reports (ACP, as reported), recording the prompts it never echoes, holding
// permission requests and questions until the person answers them, and turning
// nib's commands into the harness's.

import { readFile } from "node:fs/promises";
import type {
  ContentBlock,
  Harness,
  HarnessSession as SharedSession,
  PermissionReply,
  QuestionReply,
  QuestionRequest,
  RequestPermissionRequest,
  SessionInit,
} from "@neoworks/harness";
import {
  agentControlServerName,
  agentToolTimeoutSeconds,
  askUserQuestionToolName,
  attachmentMetadata,
  composeAttachmentPrompt,
  type CreateSessionOptions,
  type EmitEvent,
  HarnessEventLog,
  type HarnessSession,
  type PermissionBehavior,
  type SessionAttachment,
} from "@nib-ui/protocol";
import {
  capabilitiesOf,
  effortOf,
  modelOf,
  permissionPolicyOf,
  type SharedHarnessSpec,
} from "./harnesses";
import { nibSystemPrompt } from "./system-prompt";

/** The media types every harness takes as an image; other files are referenced by path. */
const imageTypes = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);

interface PermissionAnswer {
  behavior: PermissionBehavior;
  updatedInput?: unknown;
}

/** How a session is opened in the harness: fresh, resumed, or as a copy. */
export type SessionStart =
  | { kind: "create" }
  | { kind: "resume"; nativeSessionId: string }
  | { kind: "fork"; nativeSessionId: string };

/** Opens a session in the shared harness and wraps it as nib's `HarnessSession`. */
export async function startSharedSession(
  harness: Harness,
  spec: SharedHarnessSpec,
  opts: CreateSessionOptions,
  emit: EmitEvent,
  start: SessionStart,
): Promise<HarnessSession> {
  const pending = new PendingAnswers(emit);
  const init = sessionInit(spec, opts, pending);
  const session = await openSession(harness, init, start);
  const log = new HarnessEventLog();
  session.onEvent((event) => {
    for (const logged of log.events(event)) {
      emit(logged);
    }
    if (event.type === "session_changed") {
      emit(sessionCreated(spec, opts.cwd, event.sessionId));
    }
  });
  emit(sessionCreated(spec, opts.cwd, session.id));
  void publishModels(harness, spec, emit);
  return wrapSession(session, spec, pending, emit);
}

/** The session exists in the harness under `nativeSessionId`, which is what resumes it. */
function sessionCreated(spec: SharedHarnessSpec, cwd: string, nativeSessionId: string) {
  return {
    type: "session.created" as const,
    data: { harnessId: spec.id, cwd, nativeSessionId, capabilities: capabilitiesOf(spec) },
  };
}

/** What the harness is told about the session: its prompt, tools, model and answerers. */
export function sessionInit(
  spec: SharedHarnessSpec,
  opts: CreateSessionOptions,
  pending: PendingAnswers,
): SessionInit {
  const options = opts.options ?? {};
  const init: SessionInit = {
    harness: spec.runsOn,
    cwd: opts.cwd,
    options: {
      systemPrompt: {
        replace: nibSystemPrompt({
          cwd: opts.cwd,
          platform: process.platform,
          agentControl: opts.agentControl !== undefined,
        }),
      },
      permissions: permissionPolicyOf(readString(options, "permissionMode")),
      model: modelOf(readString(options, "model")),
      effort: effortOf(spec, readString(options, "effort")),
    },
    usage: opts.usage,
    onPermission: (request) => pending.permission(request),
    onQuestion: (request) => pending.question(request),
  };
  if (opts.agentControl) {
    init.mcpServers = [
      { type: "http", name: agentControlServerName, url: opts.agentControl.url, headers: [] },
    ];
    // `read_agent` waits for as long as the agent it reads works; Claude Code
    // takes its MCP tool timeout, in milliseconds, from the environment.
    if (spec.runsOn === "claude") {
      init.env = { MCP_TOOL_TIMEOUT: String(agentToolTimeoutSeconds * 1000) };
    }
  }
  return init;
}

function openSession(
  harness: Harness,
  init: SessionInit,
  start: SessionStart,
): Promise<SharedSession> {
  if (start.kind === "resume") {
    return harness.resumeSession(start.nativeSessionId, init);
  }
  if (start.kind === "fork") {
    return harness.forkSession(start.nativeSessionId, init);
  }
  return harness.createSession(init);
}

/** The models the signed-in account can run, for the composer once the session is up. */
async function publishModels(
  harness: Harness,
  spec: SharedHarnessSpec,
  emit: EmitEvent,
): Promise<void> {
  try {
    const listed = await harness.listModels(spec.runsOn);
    const models = listed.map((model) => ({
      id: model.id,
      displayName: model.name,
      description: model.description,
    }));
    emit({ type: "session.meta", data: { models } });
  } catch (error) {
    emit({
      type: "log",
      data: { level: "debug", message: `model listing failed: ${describeError(error)}` },
    });
  }
}

/** Wraps a shared-harness session as the `HarnessSession` the session host drives. */
function wrapSession(
  session: SharedSession,
  spec: SharedHarnessSpec,
  pending: PendingAnswers,
  emit: EmitEvent,
): HarnessSession {
  return {
    async send(text, attachments = []) {
      const { images, referenced } = await readImages(attachments, emit);
      const prompt = composeAttachmentPrompt(text, referenced);
      // The harness does not echo prompts back, so the log is their only record.
      emit({
        type: "user.message",
        data: { text: prompt, attachments: attachmentMetadata(attachments) },
      });
      emit({ type: "session.status", data: { status: "working" } });
      const run = session.prompt(promptContent(prompt, images));
      run.then(undefined, (error: unknown) => {
        emit({ type: "session.status", data: { status: "error", detail: describeError(error) } });
      });
    },

    async interrupt() {
      await session.cancel();
      emit({ type: "log", data: { level: "info", message: "interrupt requested" } });
    },

    respondToPermission(requestId, response) {
      pending.answer(requestId, response);
    },

    async setPermissionMode(mode) {
      await session.setPermissions(permissionPolicyOf(mode));
      emit({ type: "session.meta", data: { permissionMode: mode } });
    },

    async setModel(model) {
      const passed = modelOf(model);
      if (passed !== undefined) {
        await session.setModel(passed);
      }
      emit({ type: "session.meta", data: { model } });
    },

    async setEffort(effort) {
      const level = effortOf(spec, effort);
      if (level === undefined) {
        throw new Error(`${spec.displayName} has no effort level "${effort}"`);
      }
      await session.setEffort(level);
      emit({ type: "session.meta", data: { effort } });
    },

    async dispose() {
      pending.cancelAll();
      await session.dispose();
    },
  };
}

/**
 * Permission requests and questions the harness is waiting on, until the person
 * answers them in the chat pane. A question is shown as a permission request of
 * the AskUserQuestion tool, which the chat pane already answers inline.
 */
export class PendingAnswers {
  private readonly waiting = new Map<string, (answer: PermissionAnswer) => void>();

  constructor(private readonly emit: EmitEvent) {}

  /** Holds a tool call until the person allows or denies it. */
  async permission(request: RequestPermissionRequest): Promise<PermissionReply> {
    const answer = await this.ask(request.toolCall.toolCallId, request);
    if (answer.behavior === "deny") {
      return "reject";
    }
    return "once";
  }

  /** Holds the agent's questions until the person answers or skips them. */
  async question(request: QuestionRequest): Promise<QuestionReply> {
    const answer = await this.ask(`question:${request.toolCallId}`, questionAsRequest(request));
    if (answer.behavior === "deny") {
      return "cancel";
    }
    return { answers: answersOf(answer.updatedInput) };
  }

  answer(requestId: string, answer: PermissionAnswer): void {
    const resolve = this.waiting.get(requestId);
    if (resolve === undefined) {
      return;
    }
    this.waiting.delete(requestId);
    this.emit({
      type: "permission.resolved",
      data: {
        requestId,
        behavior: answer.behavior,
        updatedInput: answer.updatedInput,
        resolvedBy: "user",
      },
    });
    this.emit({ type: "session.status", data: { status: "working" } });
    resolve(answer);
  }

  /** Denies everything still waiting, so the harness is not left hanging on a closed session. */
  cancelAll(): void {
    for (const requestId of [...this.waiting.keys()]) {
      this.answer(requestId, { behavior: "deny" });
    }
  }

  private ask(requestId: string, request: RequestPermissionRequest): Promise<PermissionAnswer> {
    // The resolver is in place before the request goes out, so an answer that
    // comes back at once finds it.
    const answered = new Promise<PermissionAnswer>((resolve) => {
      this.waiting.set(requestId, resolve);
    });
    this.emit({ type: "session.status", data: { status: "awaiting-permission" } });
    this.emit({ type: "permission.requested", data: { requestId, request } });
    return answered;
  }
}

/**
 * A question as the permission request the chat pane answers inline: the
 * AskUserQuestion tool call, with the questions as its input.
 */
function questionAsRequest(request: QuestionRequest): RequestPermissionRequest {
  return {
    sessionId: "",
    toolCall: {
      toolCallId: request.toolCallId,
      name: askUserQuestionToolName,
      title: "Question",
      kind: "other",
      status: "pending",
      rawInput: { questions: request.questions },
    },
    options: [
      { optionId: "answer", name: "Answer", kind: "allow_once" },
      { optionId: "skip", name: "Skip", kind: "reject_once" },
    ],
  };
}

/** The prompt as ACP content: the images, then the text, which may not be empty. */
function promptContent(prompt: string, images: ContentBlock[]): ContentBlock[] {
  const content: ContentBlock[] = [...images];
  if (prompt.length > 0 || images.length === 0) {
    content.push({ type: "text", text: prompt });
  }
  return content;
}

/**
 * Splits the attachments into images the model sees and files it has to open.
 * An image whose bytes cannot be read is referenced by path instead of dropped.
 */
async function readImages(
  attachments: readonly SessionAttachment[],
  emit: EmitEvent,
): Promise<{ images: ContentBlock[]; referenced: SessionAttachment[] }> {
  const images: ContentBlock[] = [];
  const referenced: SessionAttachment[] = [];
  for (const attachment of attachments) {
    if (!imageTypes.has(attachment.mime)) {
      referenced.push(attachment);
      continue;
    }
    try {
      const data = (await readFile(attachment.path)).toString("base64");
      images.push({ type: "image", mimeType: attachment.mime, data });
    } catch (error) {
      emit({
        type: "log",
        data: {
          level: "warn",
          message: `attachment "${attachment.name}" was sent as a path: ${describeError(error)}`,
        },
      });
      referenced.push(attachment);
    }
  }
  return { images, referenced };
}

/** The answers in the input a question was allowed with, keyed by question text. */
function answersOf(input: unknown): Record<string, string> {
  const found: Record<string, string> = {};
  if (typeof input !== "object" || input === null) {
    return found;
  }
  const answers = (input as { answers?: unknown }).answers;
  if (typeof answers !== "object" || answers === null) {
    return found;
  }
  for (const [question, answer] of Object.entries(answers)) {
    if (typeof answer === "string") {
      found[question] = answer;
    }
  }
  return found;
}

function readString(options: Record<string, unknown>, key: string): string | undefined {
  const value = options[key];
  if (typeof value === "string") {
    return value;
  }
  return undefined;
}

function describeError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
