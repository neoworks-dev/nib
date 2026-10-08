import type { RequestPermissionRequest, SessionUpdate } from "@neoworks/harness";
import { z } from "zod";
import { harnessCapabilitiesSchema } from "./capabilities";
import { modelInfoSchema, slashCommandSchema } from "./metadata";

export const sessionStatusSchema = z.enum([
  "idle",
  "working",
  "awaiting-permission",
  "error",
  "closed",
]);
export type SessionStatus = z.infer<typeof sessionStatusSchema>;

export const permissionBehaviorSchema = z.enum(["allow", "deny"]);
export type PermissionBehavior = z.infer<typeof permissionBehaviorSchema>;

/**
 * A file sent along with a prompt. Only the metadata travels: the bytes stay in
 * the asset store, addressed by `assetId`, so a transcript restored from the log
 * can still describe — and fetch — what was attached.
 */
export const messageAttachmentSchema = z.object({
  assetId: z.string(),
  mime: z.string(),
  name: z.string(),
});
export type MessageAttachment = z.infer<typeof messageAttachmentSchema>;

export {
  type ModelInfo,
  modelInfoSchema,
  type SlashCommandInfo,
  slashCommandSchema,
} from "./metadata";

// ACP's own types, re-exported so the rest of nib reaches them through the protocol.
export type {
  ContentBlock,
  RequestPermissionRequest,
  SessionUpdate,
  ToolCallUpdate,
} from "@neoworks/harness";

const sessionUpdateSchema = z.custom<SessionUpdate>(
  (value) =>
    typeof value === "object" &&
    value !== null &&
    typeof (value as { sessionUpdate?: unknown }).sessionUpdate === "string",
);

const permissionRequestSchema = z.custom<RequestPermissionRequest>(
  (value) =>
    typeof value === "object" &&
    value !== null &&
    typeof (value as { toolCall?: unknown }).toolCall === "object",
);

/** What the session has used so far, as the harness totals it. */
export const usageTotalsSchema = z.object({
  input: z.number().optional(),
  output: z.number().optional(),
  cacheRead: z.number().optional(),
  cacheWrite: z.number().optional(),
  costUsd: z.number().optional(),
});
export type UsageTotals = z.infer<typeof usageTotalsSchema>;

/**
 * Data schema per event type. The envelope stays open (`type: string`) so a
 * harness can emit types this build has never seen; consumers fall back to
 * treating those as opaque.
 *
 * What a harness says is ACP, stored as the shared harness reported it (`update`).
 * Everything else is what nib itself knows and ACP has no word for: the session's
 * own metadata, the prompt as the user sent it, the answers to permission
 * requests, and where a turn ended.
 */
export const eventDataSchemas = {
  "session.created": z.object({
    harnessId: z.string(),
    cwd: z.string(),
    title: z.string().optional(),
    nativeSessionId: z.string().optional(),
    capabilities: harnessCapabilitiesSchema,
    /** Set when another session's agent spawned this one through the agent-control tools. */
    parentSessionId: z.string().optional(),
  }),
  /** Session-scoped metadata that arrives after creation or changes mid-session. */
  "session.meta": z.object({
    label: z.string().optional(),
    model: z.string().optional(),
    permissionMode: z.string().optional(),
    effort: z.string().optional(),
    archived: z.boolean().optional(),
    slashCommands: z.array(slashCommandSchema).optional(),
    models: z.array(modelInfoSchema).optional(),
  }),
  /**
   * The harness dropped its conversation (`/clear`) and carries on under a new
   * id; the transcript starts over with it.
   */
  "session.cleared": z.object({
    reason: z.string().optional(),
    nativeSessionId: z.string().optional(),
  }),
  "session.status": z.object({
    status: sessionStatusSchema,
    detail: z.string().optional(),
  }),
  /** The prompt as sent. The harness never echoes it back, so the log is its only record. */
  "user.message": z.object({
    text: z.string(),
    /** Absent on every event logged before attachments existed, which reduces to none. */
    attachments: z.array(messageAttachmentSchema).optional(),
  }),
  /** One ACP session update, as the shared harness reported it. */
  update: z.object({
    update: sessionUpdateSchema,
  }),
  /** A tool call held for a decision, answered by a `permission.resolved`. */
  "permission.requested": z.object({
    requestId: z.string(),
    request: permissionRequestSchema,
  }),
  "permission.resolved": z.object({
    requestId: z.string(),
    behavior: permissionBehaviorSchema,
    updatedInput: z.unknown().optional(),
    resolvedBy: z.enum(["user", "policy"]),
  }),
  /** The session's running totals, and how full the model's context is. */
  usage: z.object({
    total: usageTotalsSchema,
    context: z.object({ used: z.number(), size: z.number() }).optional(),
  }),
  /** A turn ended; `usage` is that turn's alone. */
  "turn.done": z.object({
    stopReason: z.string(),
    usage: usageTotalsSchema.optional(),
  }),
  log: z.object({
    level: z.enum(["debug", "info", "warn", "error"]),
    message: z.string(),
  }),
  ext: z.object({
    ns: z.string(),
    type: z.string(),
    data: z.unknown(),
  }),
} as const;

export type EventDataMap = {
  [K in keyof typeof eventDataSchemas]: z.infer<(typeof eventDataSchemas)[K]>;
};
export type KnownEventType = keyof EventDataMap;

export type AgentEvent<T extends string = string, D = unknown> = {
  id: string;
  sessionId: string;
  seq: number;
  ts: number;
  type: T;
  data: D;
  raw?: unknown;
};

export type KnownAgentEvent = {
  [K in KnownEventType]: AgentEvent<K, EventDataMap[K]>;
}[KnownEventType];
export type UnknownAgentEvent = AgentEvent<string, unknown>;
export type AnyAgentEvent = KnownAgentEvent | UnknownAgentEvent;

/** What an adapter hands to the session host; the host stamps the rest. */
export type EmittedEvent = {
  [K in KnownEventType]: { type: K; data: EventDataMap[K]; raw?: unknown };
}[KnownEventType];

export const agentEventSchema = z.object({
  id: z.string(),
  sessionId: z.string(),
  seq: z.number().int().nonnegative(),
  ts: z.number(),
  type: z.string(),
  data: z.unknown(),
  raw: z.unknown().optional(),
});

export function isKnownEventType(type: string): type is KnownEventType {
  return Object.hasOwn(eventDataSchemas, type);
}

export function isKnownEvent(event: AnyAgentEvent): event is KnownAgentEvent {
  return isKnownEventType(event.type);
}

/**
 * Envelope-validates and, when the type is known, validates `data` too.
 * A known type carrying malformed data is dropped rather than crashing the
 * projection — the caller decides what to do with the failure.
 */
export function parseAgentEvent(input: unknown): AnyAgentEvent {
  const envelope = agentEventSchema.parse(input);
  if (!isKnownEventType(envelope.type)) return envelope;
  const data = eventDataSchemas[envelope.type].parse(envelope.data);
  return { ...envelope, type: envelope.type, data } as AnyAgentEvent;
}

export function safeParseAgentEvent(input: unknown): AnyAgentEvent | null {
  const envelope = agentEventSchema.safeParse(input);
  if (!envelope.success) return null;
  if (!isKnownEventType(envelope.data.type)) return envelope.data;
  const data = eventDataSchemas[envelope.data.type].safeParse(envelope.data.data);
  if (!data.success) return null;
  return { ...envelope.data, type: envelope.data.type, data: data.data } as AnyAgentEvent;
}
