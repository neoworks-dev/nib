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

export const knownBlockKinds = ["text", "thinking", "tool_use", "tool_result", "image"] as const;
export type KnownBlockKind = (typeof knownBlockKinds)[number];
/** Open on purpose: a harness may stream a block kind this build has never seen. */
export type BlockKind = KnownBlockKind | (string & {});
export const blockKindSchema = z.string() as unknown as z.ZodType<BlockKind>;

export const messageRoleSchema = z.enum(["user", "assistant"]);
export type MessageRole = z.infer<typeof messageRoleSchema>;

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

const blockContentSchema = z.union([
  z.object({ kind: z.literal("text"), text: z.string() }),
  z.object({ kind: z.literal("thinking"), text: z.string(), signature: z.string().optional() }),
  z.object({
    kind: z.literal("tool_use"),
    toolName: z.string(),
    toolUseId: z.string(),
    input: z.unknown(),
  }),
  z.object({
    kind: z.literal("tool_result"),
    toolUseId: z.string(),
    output: z.unknown(),
    isError: z.boolean().optional(),
  }),
  z.object({
    kind: z.literal("image"),
    mediaType: z.string(),
    data: z.string().optional(),
    url: z.string().optional(),
  }),
  z.looseObject({ kind: z.string() }),
]);

export type BlockContent = z.infer<typeof blockContentSchema>;

/**
 * Data schema per event type. The envelope stays open (`type: string`) so a
 * harness can emit types this build has never seen; consumers fall back to
 * treating those as opaque.
 */
export const eventDataSchemas = {
  "session.created": z.object({
    harnessId: z.string(),
    cwd: z.string(),
    title: z.string().optional(),
    nativeSessionId: z.string().optional(),
    capabilities: harnessCapabilitiesSchema,
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
  /** The harness dropped its conversation (`/clear`); the projection follows suit. */
  "session.cleared": z.object({
    reason: z.string().optional(),
  }),
  "session.status": z.object({
    status: sessionStatusSchema,
    detail: z.string().optional(),
  }),
  "message.started": z.object({
    messageId: z.string(),
    role: messageRoleSchema,
    /** Absent on every event logged before attachments existed, which reduces to none. */
    attachments: z.array(messageAttachmentSchema).optional(),
  }),
  "message.completed": z.object({
    messageId: z.string(),
    stopReason: z.string().optional(),
  }),
  /** The harness can restore the working tree to how it looked before this message. */
  "message.checkpoint": z.object({
    messageId: z.string(),
    checkpointId: z.string(),
  }),
  "block.started": z.object({
    messageId: z.string(),
    blockId: z.string(),
    kind: blockKindSchema,
    toolName: z.string().optional(),
    toolUseId: z.string().optional(),
  }),
  "block.delta": z.object({
    blockId: z.string(),
    textDelta: z.string().optional(),
    inputJsonDelta: z.string().optional(),
  }),
  "block.completed": z.object({
    blockId: z.string(),
    content: blockContentSchema,
  }),
  "permission.requested": z.object({
    requestId: z.string(),
    toolName: z.string(),
    input: z.unknown(),
    suggestions: z.array(z.unknown()).optional(),
  }),
  "permission.resolved": z.object({
    requestId: z.string(),
    behavior: permissionBehaviorSchema,
    updatedInput: z.unknown().optional(),
    resolvedBy: z.enum(["user", "policy"]),
  }),
  "usage.updated": z.object({
    inputTokens: z.number(),
    outputTokens: z.number(),
    cacheReadTokens: z.number().optional(),
    costUsd: z.number().optional(),
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
