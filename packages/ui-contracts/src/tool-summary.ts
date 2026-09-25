import {
  agentControlServerName,
  agentToolNames,
  type BlockView,
  blockToolInput,
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

export function describeCall(block: BlockView): StepDescriptor {
  const called = block.toolName ?? "tool";
  const mcp = parseMcpToolName(called);
  // pi runs the agent-control tools in-process under their bare names while the
  // other harnesses reach them over MCP. One spelling here, so a run of them
  // reads the same whichever harness logged it.
  const toolName = mcp?.server === agentControlServerName ? mcp.tool : called;
  const raw = blockToolInput(block);
  // While the call streams, the input is still unparseable JSON — the row reads
  // the value out of the fragment so the command appears as it is written.
  const input = raw !== null && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const fragment = typeof raw === "string" ? raw : "";
  const field = (key: string): string =>
    typeof input[key] === "string" ? (input[key] as string) : streamedField(fragment, key);

  switch (toolName) {
    case "Read":
    case "NotebookRead":
      return step("Explore", "file", "Read", field("file_path"), basename);
    case "Edit":
    case "MultiEdit":
    case "NotebookEdit":
      return step("Edit", "change", "Updated", field("file_path"), basename);
    case "Write":
      return step("Edit", "change", "Wrote", field("file_path"), basename);
    case "Bash":
    case "BashOutput":
    case "KillShell":
      return step("Terminal", "command", "Ran", field("command"), oneLine);
    case "Grep":
      return step("Explore", "search", "Searched for", field("pattern"), oneLine);
    case "Glob":
      return step("Explore", "search", "Listed", field("pattern"), oneLine);
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
    default:
      // An MCP server is a run of its own: its calls file under the server, and
      // each line says which of its tools ran rather than repeating the header.
      if (mcp)
        return step(sentenceCase(mcp.server), "call", sentenceCase(mcp.tool), lead(input), oneLine);
      return { label: toolName, noun: "call", verb: toolName, detail: lead(input), subject: "" };
  }
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
export function readFilePath(block: BlockView): string | null {
  const call = describeCall(block);
  if (call.noun !== "file" || call.verb !== "Read") return null;
  return call.subject.length > 0 ? call.subject : null;
}

/**
 * A folded turn still has to say what it did. Each call becomes the verb phrase
 * the tool's own input already spells out — a name alone ("Bash", "Edit") says
 * which tool ran, not what happened.
 */
export function describeStep(block: BlockView): string {
  return stepPhrase(describeCall(block));
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

/** Pulls a string field out of half-arrived JSON, escapes and all. */
function streamedField(fragment: string, key: string): string {
  const match = new RegExp(`"${key}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)`).exec(fragment);
  if (!match) return "";
  const body = match[1] ?? "";
  try {
    return JSON.parse(`"${body}"`) as string;
  } catch {
    // A trailing half-written escape (`\`, `\u12`) is not valid JSON on its own.
    return JSON.parse(`"${body.replace(/\\[^"\\/bfnrtu]?$|\\u[0-9a-fA-F]{0,3}$/, "")}"`) as string;
  }
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
