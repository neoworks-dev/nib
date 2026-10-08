import {
  agentControlServerName,
  agentToolNames,
  toolDiffs,
  toolInput,
  toolInputString,
  type ToolItem,
} from "@nib-ui/protocol";

/**
 * How one tool call reads in the transcript. `label` and `noun` name the run it
 * belongs to ("Terminal · 3 commands"); `verb` and `detail` are the line itself
 * ("Ran  git status").
 */
export interface StepDescriptor {
  label: string;
  noun: string;
  verb: string;
  detail: string;
  /**
   * What `detail` is an abbreviation of — the whole path, command, pattern or
   * url. A caller that has to act on the call rather than print it reads this,
   * so acting and printing agree on which tools mean what.
   */
  subject: string;
}

/** `mcp__nib__send_to_agent` → server `nib`, tool `send_to_agent`; null for a built-in tool. */
export function parseMcpToolName(toolName: string): { server: string; tool: string } | null {
  const parts = toolName.split("__");
  if (parts.length < 3 || parts[0] !== "mcp") return null;
  const [, server, ...tool] = parts;
  if (!server || tool.length === 0) return null;
  return { server, tool: tool.join("__") };
}

/**
 * The name a card puts on a call. An MCP tool arrives wearing its transport —
 * `mcp__nib__send_to_agent` — which says where it came from rather than what it
 * did; everything else is already named for a reader.
 */
export function toolDisplayName(toolName: string): string {
  const mcp = parseMcpToolName(toolName);
  return mcp ? sentenceCase(mcp.tool) : toolName;
}

/**
 * How a tool call reads in the transcript. Tools are told apart by name first,
 * for the ones with a vocabulary of their own (the agent tools, a task, the
 * web), and then by ACP's kind of call, which every harness reports whatever it
 * calls the tool.
 */
export function describeCall(tool: ToolItem): StepDescriptor {
  const mcp = parseMcpToolName(tool.name);
  // pi runs the agent-control tools in-process under their bare names while the
  // other harnesses reach them over MCP. One spelling here, so a run of them
  // reads the same whichever harness logged it.
  let toolName = tool.name;
  if (mcp?.server === agentControlServerName) toolName = mcp.tool;

  const named = describeNamedTool(toolName, tool);
  if (named) return named;
  const byKind = describeByKind(tool);
  if (byKind) return byKind;

  // An MCP server is a run of its own: its calls file under the server, and
  // each line says which of its tools ran rather than repeating the header.
  const input = toolInput(tool) ?? {};
  if (mcp) {
    return step(sentenceCase(mcp.server), "call", sentenceCase(mcp.tool), lead(input), oneLine);
  }
  const label = toolName.length > 0 ? toolName : tool.title || "tool";
  return { label, noun: "call", verb: label, detail: lead(input), subject: "" };
}

/** Tools with a vocabulary of their own, whichever kind the harness filed them under. */
function describeNamedTool(toolName: string, tool: ToolItem): StepDescriptor | null {
  const field = (...keys: string[]): string => toolInputString(tool, ...keys) ?? "";
  switch (toolName) {
    case "TodoWrite":
      return {
        label: "Plan",
        noun: "update",
        verb: "Updated",
        detail: "the plan",
        subject: "the plan",
      };
    case "Task":
      return step("Agents", "task", "Delegated", field("description"), oneLine);
    case agentToolNames.spawn:
      return step("Agents", "agent", "Started", field("prompt"), oneLine);
    case agentToolNames.send:
      return step("Agents", "message", "Sent", field("text"), oneLine);
    case agentToolNames.read:
      return step("Agents", "check", "Read", field("sessionId"), oneLine);
    case agentToolNames.stop:
      return step("Agents", "stop", "Stopped", field("sessionId"), oneLine);
    case agentToolNames.list:
      return { label: "Agents", noun: "check", verb: "Listed agents", detail: "", subject: "" };
    case agentToolNames.harnesses:
      return { label: "Agents", noun: "check", verb: "Listed harnesses", detail: "", subject: "" };
    case agentToolNames.canvas:
      return { label: "Canvas", noun: "check", verb: "Read the board", detail: "", subject: "" };
    case agentToolNames.place:
      return {
        label: "Canvas",
        noun: "arrangement",
        verb: "Arranged the board",
        detail: "",
        subject: "",
      };
    case "WebFetch":
      return step("Web", "fetch", "Fetched", field("url"), hostname);
    case "WebSearch":
      return step("Web", "search", "Searched the web for", field("query"), oneLine);
    case "Glob":
      return step("Explore", "search", "Listed", field("pattern"), oneLine);
    case "Write":
    case "write":
      return step("Edit", "change", "Wrote", filePath(tool), basename);
    default:
      return null;
  }
}

/** The vocabulary of ACP's kinds of call, which the three harnesses share. */
function describeByKind(tool: ToolItem): StepDescriptor | null {
  switch (tool.kind) {
    case "read":
      return step("Explore", "file", "Read", filePath(tool), basename);
    case "edit":
    case "delete":
    case "move":
      return step("Edit", "change", "Updated", filePath(tool), basename);
    case "execute":
      return step("Terminal", "command", "Ran", commandOf(tool), oneLine);
    case "search":
      return step("Explore", "search", "Searched for", searchTermOf(tool), oneLine);
    case "fetch":
      return step("Web", "fetch", "Fetched", toolInputString(tool, "url") ?? "", hostname);
    default:
      return null;
  }
}

/** The file a call is about: its input's path, else the file its diff changes, else its location. */
function filePath(tool: ToolItem): string {
  const fromInput = toolInputString(tool, "file_path", "path", "notebook_path");
  if (fromInput !== undefined) return fromInput;
  const diff = toolDiffs(tool)[0];
  if (diff) return diff.path;
  return tool.locations[0]?.path ?? "";
}

/** The command a shell call runs: its input, else what the harness titled the call. */
function commandOf(tool: ToolItem): string {
  const fromInput = toolInputString(tool, "command", "cmd");
  if (fromInput !== undefined) return fromInput;
  return tool.title;
}

/** What a search looks for: its pattern or query, else the harness's title for it. */
function searchTermOf(tool: ToolItem): string {
  const fromInput = toolInputString(tool, "pattern", "query");
  if (fromInput !== undefined) return fromInput;
  return tool.title;
}

/**
 * What a call nobody knows how to describe was about: its first non-empty string
 * argument. A tool that takes a path, a query or an id puts it first far more
 * often than not, and a wrong guess costs a row of grey text.
 */
function lead(input: Record<string, unknown>): string {
  for (const value of Object.values(input)) {
    if (typeof value === "string" && value.trim().length > 0) return oneLine(value);
  }
  return "";
}

/** `send_to_agent` → `Send to agent`, `readFile` → `Read file`. */
function sentenceCase(name: string): string {
  const words = name
    .replace(/[_-]+/g, " ")
    .replace(/([a-z\d])([A-Z])/g, "$1 $2")
    .trim()
    .toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function step(
  label: string,
  noun: string,
  verb: string,
  subject: string,
  abbreviate: (value: string) => string,
): StepDescriptor {
  return { label, noun, verb, detail: abbreviate(subject), subject };
}

/**
 * The file a call read, whole rather than abbreviated. Derived from the same
 * vocabulary the transcript prints, so a tool nothing knows how to describe is
 * also a tool nothing tries to route.
 */
export function readFilePath(tool: ToolItem): string | null {
  const call = describeCall(tool);
  if (call.noun !== "file" || call.verb !== "Read") return null;
  return call.subject.length > 0 ? call.subject : null;
}

/**
 * A folded turn still has to say what it did. Each call becomes the verb phrase
 * the tool's own input already spells out — a name alone ("Bash", "Edit") says
 * which tool ran, not what happened.
 */
export function describeStep(tool: ToolItem): string {
  return stepPhrase(describeCall(tool));
}

/** The same line, for callers that already hold the descriptor. */
export function stepPhrase({ verb, detail }: StepDescriptor): string {
  if (detail.length === 0) return verb;
  return `${verb} ${clip(detail, verb === "Ran" ? 44 : 28)}`;
}

/** `3 commands`, `1 search` — a step's noun, counted. */
export function countedNoun(count: number, noun: string): string {
  if (count === 1) return `${count} ${noun}`;
  const suffix =
    noun.endsWith("ch") || noun.endsWith("sh") || noun.endsWith("s") || noun.endsWith("x")
      ? "es"
      : "s";
  return `${count} ${noun}${suffix}`;
}

function basename(path: string): string {
  if (path.length === 0) return "a file";
  const trimmed = path.replace(/\/+$/, "");
  return trimmed.slice(trimmed.lastIndexOf("/") + 1);
}

function hostname(url: string): string {
  const match = /^[a-z]+:\/\/([^/]+)/i.exec(url);
  return match?.[1] ?? clip(url, 28);
}

/** Commands and patterns arrive with newlines; a step is one line by definition. */
function oneLine(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function clip(text: string, limit: number): string {
  const line = oneLine(text);
  return line.length <= limit ? line : `${line.slice(0, limit).trimEnd()}…`;
}
