import { type BlockView, blockToolInput } from "@nib-ui/protocol";

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

export function describeCall(block: BlockView): StepDescriptor {
  const toolName = block.toolName ?? "tool";
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
      return step("Agent", "task", "Delegated", field("description"), oneLine);
    case "WebFetch":
      return step("Web", "fetch", "Fetched", field("url"), hostname);
    case "WebSearch":
      return step("Web", "search", "Searched the web for", field("query"), oneLine);
    default:
      return { label: toolName, noun: "call", verb: toolName, detail: "", subject: "" };
  }
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
