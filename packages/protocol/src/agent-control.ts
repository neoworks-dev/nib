import { z } from "zod";
import type { ComfyToolName } from "./comfy-tools";
import { type SessionStatus, sessionStatusSchema } from "./events";
import { modelInfoSchema } from "./metadata";

/**
 * The tools one agent uses to spawn and drive others. Defined once here, in
 * zod, because three harnesses consume them three ways: Claude Code and Codex
 * over MCP (JSON schema via `z.toJSONSchema`), pi as in-process custom tools.
 * A transcript renderer matches on the same names to draw a spawn as a card.
 *
 * The spawning half mirrors what Claude Code gives its own model — Agent,
 * SendMessage, TaskOutput, ListAgents, TaskStop — so a model that already knows
 * how to run subagents finds the same shape here: spawn returns at once, the
 * spawner keeps working, and the child's result arrives as a notification in a
 * later turn. The canvas pair is the other half of the same idea: an agent can
 * already read and write the vault with its own file tools, and these let it say
 * where on the board what it wrote should sit.
 */

/** The MCP server name; Claude Code and Codex log its tools as `mcp__nib__<tool>`. */
export const agentControlServerName = "nib";

export const agentToolNames = {
  harnesses: "list_harnesses",
  spawn: "spawn_agent",
  send: "send_to_agent",
  read: "read_agent",
  list: "list_agents",
  stop: "stop_agent",
  canvas: "read_canvas",
  place: "place_on_canvas",
} as const;

export type AgentToolName = (typeof agentToolNames)[keyof typeof agentToolNames];

/**
 * How long a harness lets one agent-control call run. `read_agent` with `wait`
 * blocks for as long as the agent it waits on works, which is far past the
 * tool-call timeout a harness defaults to (Codex: 60 s), so every adapter that
 * can set one sets this.
 */
export const agentToolTimeoutSeconds = 3600;

export function mcpToolName(tool: AgentToolName): string {
  return `mcp__${agentControlServerName}__${tool}`;
}

/** True for the bare name pi logs and the MCP-prefixed one Claude Code and Codex log. */
export function isAgentTool(toolName: string | null | undefined, tool: AgentToolName): boolean {
  return toolName === tool || toolName === mcpToolName(tool);
}

/**
 * What a harness with its own delegation tool is told, so "spawn an agent" goes
 * through these tools. Claude Code's built-in Agent tool would otherwise win by
 * familiarity, and the person then gets a subagent with no tab, no harness or
 * model choice, and no way to talk back.
 *
 * The board is here for the opposite reason: nothing else would tell a model
 * that the vault it writes is drawn as a canvas, so a note it wrote would land
 * wherever the app happened to flow it.
 */
export const agentControlInstructions = [
  "# The board",
  "The vault is drawn as a canvas: every file in it is a card the person can see, laid out per " +
    `directory. ${mcpToolName("read_canvas")} says where those cards sit and ` +
    `${mcpToolName("place_on_canvas")} moves them. After writing to the vault, place what you wrote: ` +
    "cards about one thing belong beside each other, and a card nobody positions is flowed into the " +
    "next free slot, which says nothing about what it is near.",
  "# Agents",
  "This session runs inside nib, which hosts agents across several harnesses (Claude Code, Codex, pi, …). " +
    "When asked to spawn, delegate to, or run another agent, use the nib agent tools " +
    `(${mcpToolName("spawn_agent")}, ${mcpToolName("read_agent")} and the rest) and never a built-in ` +
    "Agent or Task tool: a nib agent gets its own tab the person can watch, runs in whichever harness and " +
    "model the task calls for, and can message you back.",
  `The harness and model ids ${mcpToolName("spawn_agent")} accepts are listed in its schema; ` +
    `${mcpToolName("list_harnesses")} returns the same catalog with display names. Pass a model id ` +
    "from that list rather than guessing a provider or model name.",
  "A spawned agent runs in the background. When it finishes, its result reaches you as an " +
    "<agent-notification> message in a later turn, so keep working rather than polling for it.",
].join("\n\n");

/** The element a finished agent's report arrives in, for the same reason Claude Code's `<task-notification>` has one. */
export const agentNotificationTag = "agent-notification";

/** What a notification says about the agent: who, how it ended, and what it said. */
export interface AgentNotification {
  sessionId: string;
  harness: string;
  title: string | null;
  status: SessionStatus;
  detail: string | null;
  result: string;
}

const noReplyText = "(the agent said nothing)";

/**
 * The message a spawner receives when an agent it spawned stops working — the
 * counterpart of the `<task-notification>` Claude Code hands its own model, so
 * the spawner can keep working instead of blocking on the child. It travels as
 * a user turn because that is the only way into a harness from outside; the
 * transcript reads it back with `parseAgentNotification` and draws it as a
 * report rather than as something the person typed.
 */
export function formatAgentNotification(report: AgentReport): string {
  const lines = [
    `<${agentNotificationTag}>`,
    `<sessionId>${report.sessionId}</sessionId>`,
    `<harness>${report.harness}</harness>`,
  ];
  if (report.title) lines.push(`<title>${report.title}</title>`);
  lines.push(`<status>${report.status}</status>`);
  if (report.statusDetail) lines.push(`<detail>${report.statusDetail}</detail>`);
  lines.push("<result>", report.reply ?? noReplyText, "</result>");
  lines.push(`</${agentNotificationTag}>`);
  return lines.join("\n");
}

/** Null for anything but a whole notification, so a prompt that mentions one stays a prompt. */
export function parseAgentNotification(text: string): AgentNotification | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith(`<${agentNotificationTag}>`)) return null;
  if (!trimmed.endsWith(`</${agentNotificationTag}>`)) return null;

  const field = (name: string): string | null => {
    const match = new RegExp(`<${name}>([^<]*)</${name}>`).exec(trimmed);
    return match?.[1] ?? null;
  };
  const sessionId = field("sessionId");
  const harness = field("harness");
  const status = sessionStatusSchema.safeParse(field("status"));
  if (!sessionId || !harness || !status.success) return null;

  // The result is last and may hold anything, so it runs to the closing tag rather than to the first `</result>`.
  const result = /<result>\n?([\s\S]*?)\n?<\/result>\s*<\/agent-notification>$/.exec(trimmed);
  return {
    sessionId,
    harness,
    title: field("title"),
    status: status.data,
    detail: field("detail"),
    result: result?.[1] ?? "",
  };
}

export const listHarnessesInputSchema = z.object({});

/** One harness as a spawner sees it: its id, and the ids it accepts for a model and a mode. */
export const harnessCatalogSchema = z.object({
  id: z.string(),
  displayName: z.string(),
  defaultModel: z.string().nullable(),
  models: z.array(modelInfoSchema),
  permissionModes: z.array(z.string()),
  effortLevels: z.array(z.string()),
});
export type HarnessCatalog = z.infer<typeof harnessCatalogSchema>;

export const listHarnessesResultSchema = z.object({ harnesses: z.array(harnessCatalogSchema) });
export type ListHarnessesResult = z.infer<typeof listHarnessesResultSchema>;

/**
 * The spawn schema is built against the running catalog, the way Claude Code's
 * Agent tool enumerates `subagent_type` and `model`: a harness id outside the
 * enum is rejected by the harness's own validation before it reaches us, and the
 * model ids sit in the description where the model reads them.
 */
export function spawnAgentInputSchema(catalog: readonly HarnessCatalog[]): z.ZodObject<{
  harness: z.ZodType<string>;
  prompt: z.ZodString;
  model: z.ZodOptional<z.ZodString>;
  label: z.ZodOptional<z.ZodString>;
  permissionMode: z.ZodOptional<z.ZodString>;
  effort: z.ZodOptional<z.ZodString>;
  cwd: z.ZodOptional<z.ZodString>;
}> {
  const [first, ...rest] = catalog.map((harness) => harness.id);
  const harness: z.ZodType<string> = first ? z.enum([first, ...rest]) : z.string();
  const modelsByHarness = catalog
    .map((entry) => `${entry.id}: ${entry.models.map((model) => model.id).join(", ")}`)
    .join("; ");
  return z.object({
    harness: harness.describe("Harness to run the agent in"),
    prompt: z.string().describe("The task. The agent starts working on it immediately."),
    model: z
      .string()
      .optional()
      .describe(
        "Model id for that harness; its default when omitted. A name matching exactly one listed " +
          `model (e.g. "deepseek v4.1 flash") resolves to its id. Available — ${modelsByHarness}`,
      ),
    label: z.string().optional().describe("Short title for the agent's tab, 3–5 words"),
    permissionMode: z.string().optional().describe("One of the harness's permission modes"),
    effort: z.string().optional().describe("One of the harness's effort levels"),
    cwd: z.string().optional().describe("Working directory; the caller's when omitted"),
  });
}
export type SpawnAgentInput = z.infer<ReturnType<typeof spawnAgentInputSchema>>;

export const sendToAgentInputSchema = z.object({
  sessionId: z.string(),
  text: z.string(),
});
export type SendToAgentInput = z.infer<typeof sendToAgentInputSchema>;

export const readAgentInputSchema = z.object({
  sessionId: z.string(),
  wait: z
    .boolean()
    .optional()
    .describe("Block until the agent stops working before answering; false by default"),
  timeoutSeconds: z
    .number()
    .positive()
    .optional()
    .describe("How long `wait` blocks at most; default 600"),
});
export type ReadAgentInput = z.infer<typeof readAgentInputSchema>;

export const listAgentsInputSchema = z.object({});

export const stopAgentInputSchema = z.object({ sessionId: z.string() });
export type StopAgentInput = z.infer<typeof stopAgentInputSchema>;

export const readCanvasInputSchema = z.object({
  directory: z
    .string()
    .optional()
    .describe('The topic whose board to read, vault-relative; the vault root ("") by default'),
});
export type ReadCanvasInput = z.infer<typeof readCanvasInputSchema>;

/** Where a card sits, in board coordinates: `x`/`y` is its top-left corner and `y` grows downward. */
export const canvasRectSchema = z.object({
  x: z.number(),
  y: z.number(),
  w: z.number(),
  h: z.number(),
});
export type CanvasRect = z.infer<typeof canvasRectSchema>;

/** One item of the vault as it stands on a board. */
export const canvasCardSchema = z.object({
  path: z.string(),
  /** A file's stem or a topic's directory name: what `[[links]]` call it. */
  name: z.string(),
  kind: z.enum(["file", "topic"]),
  title: z.string().nullable(),
  /** Null for an item nothing has placed yet; the board places it when a window next opens it. */
  rect: canvasRectSchema.nullable(),
  /** The pile it is folded into, if any. */
  stack: z.string().nullable(),
});
export type CanvasCard = z.infer<typeof canvasCardSchema>;

export const readCanvasResultSchema = z.object({
  cwd: z.string(),
  directory: z.string(),
  cards: z.array(canvasCardSchema),
});
export type ReadCanvasResult = z.infer<typeof readCanvasResultSchema>;

export const placeOnCanvasInputSchema = z.object({
  items: z
    .array(
      z.object({
        path: z.string().describe("Vault-relative path, as read_canvas reports it"),
        x: z.number().describe("Left edge in board coordinates"),
        y: z.number().describe("Top edge in board coordinates; y grows downward"),
        w: z.number().positive().optional().describe("Width; the card's current width by default"),
        h: z
          .number()
          .positive()
          .optional()
          .describe("Height; the card's current height by default"),
      }),
    )
    .min(1)
    .describe("Every card to move, written as one revision"),
});
export type PlaceOnCanvasInput = z.infer<typeof placeOnCanvasInputSchema>;

export const placeOnCanvasResultSchema = z.object({ cards: z.array(canvasCardSchema) });
export type PlaceOnCanvasResult = z.infer<typeof placeOnCanvasResultSchema>;

/** One agent as another sees it: identity, where it has got to, and what it last said. */
export const agentReportSchema = z.object({
  sessionId: z.string(),
  harness: z.string(),
  model: z.string().nullable(),
  title: z.string().nullable(),
  parentSessionId: z.string().nullable(),
  status: sessionStatusSchema,
  statusDetail: z.string().nullable(),
  /** The opening prompt: what the agent was asked. */
  prompt: z.string().nullable(),
  /** The newest assistant prose: where it has got to. */
  reply: z.string().nullable(),
});
export type AgentReport = z.infer<typeof agentReportSchema>;

export const spawnAgentResultSchema = agentReportSchema.pick({
  sessionId: true,
  harness: true,
  model: true,
  title: true,
});
export type SpawnAgentResult = z.infer<typeof spawnAgentResultSchema>;

export const readAgentResultSchema = agentReportSchema.extend({
  /** True when `wait` gave up first; `status` is then whatever it was at that moment. */
  timedOut: z.boolean(),
});
export type ReadAgentResult = z.infer<typeof readAgentResultSchema>;

export const listAgentsResultSchema = z.object({
  self: z.string(),
  parent: agentReportSchema.nullable(),
  /** Every other session in the caller's family: siblings and descendants. */
  agents: z.array(agentReportSchema),
});
export type ListAgentsResult = z.infer<typeof listAgentsResultSchema>;

/**
 * An in-process tool, for a harness with no MCP client. `input` has already
 * been validated against the tool's schema; the handler returns the JSON the
 * MCP server would have returned.
 */
export interface AgentControlTool {
  name: AgentToolName | ComfyToolName;
  description: string;
  inputSchema: z.ZodObject;
  handler(input: unknown): Promise<unknown>;
}

/**
 * How one session reaches the agent-control tools. The url is per session: the
 * path carries a secret, so the server knows which agent is calling without
 * trusting the model to say so.
 */
export interface AgentControlLink {
  /** Streamable-HTTP MCP endpoint on loopback, for harnesses with an MCP client. */
  url: string;
  /** The same tools as in-process handlers, for harnesses without one. */
  tools: AgentControlTool[];
}
