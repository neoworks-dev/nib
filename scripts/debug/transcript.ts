// Watching an exploring agent work.
//
// `claude --output-format stream-json` emits one JSON object per line, which is
// unreadable as it goes past. This renders it as a transcript: what the agent is
// thinking, what it did, and — in a terminal that can draw images — the
// screenshots it took, inline, where it looked at them.

import { spawnSync } from "node:child_process";
import type { Readable } from "node:stream";

const style = {
  dim: "\x1b[2m",
  bold: "\x1b[1m",
  cyan: "\x1b[36m",
  yellow: "\x1b[33m",
  reset: "\x1b[0m",
};

/** A screenshot the harness wrote, which is drawn rather than named. */
const SHOT_PATH = /(\/\S*\.nib-debug\/shots\/\S+?\.png)/g;

type OpenBlock = "text" | "thinking" | null;

// The parts of the stream-json events this renders. What is not declared here
// is what is not drawn.
interface ContentPart {
  type: string;
  name?: string;
  input?: Record<string, unknown>;
  content?: string | Array<{ type: string; text?: string }>;
}

interface StreamEvent {
  type: string;
  message?: { content?: ContentPart[] };
  event?: { type: string; delta?: { type: string; text?: string; thinking?: string } };
  total_cost_usd?: number;
  duration_ms?: number;
}

/** Render a stream-json transcript to stdout until the stream ends. */
export async function renderTranscript(stream: Readable): Promise<void> {
  const shown = new Set<string>();
  let buffer = "";
  let block: OpenBlock = null;

  const endBlock = (): void => {
    if (block === null) return;
    process.stdout.write(`${style.reset}\n`);
    block = null;
  };

  for await (const chunk of stream) {
    buffer += String(chunk);
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (line.trim().length === 0) continue;
      let event: StreamEvent;
      try {
        event = JSON.parse(line);
      } catch {
        // Anything the CLI prints that is not an event is worth seeing as it is.
        console.log(line);
        continue;
      }
      block = renderEvent(event, block, endBlock, shown);
    }
  }
  endBlock();
}

/** Draw one event, and return which streaming block is open afterwards. */
function renderEvent(
  event: StreamEvent,
  block: OpenBlock,
  endBlock: () => void,
  shown: Set<string>,
): OpenBlock {
  if (event.type === "stream_event") return renderDelta(event, block, endBlock);

  if (event.type === "assistant" || event.type === "user") {
    let open = block;
    for (const part of event.message?.content ?? []) {
      if (part.type === "tool_use") {
        endBlock();
        open = null;
        console.log(`${style.cyan}▸ ${describeToolUse(part)}${style.reset}`);
      }
      if (part.type === "tool_result") {
        endBlock();
        open = null;
        renderToolResult(part, shown);
      }
    }
    return open;
  }

  if (event.type === "result") {
    endBlock();
    const elapsed = Math.round((event.duration_ms ?? 0) / 1000);
    let spent = "";
    if (event.total_cost_usd !== undefined) spent = `, $${event.total_cost_usd.toFixed(2)}`;
    console.log(`\n${style.bold}done${style.reset} ${style.dim}${elapsed}s${spent}${style.reset}`);
    return null;
  }
  return block;
}

/** Text and thinking, written as they stream. */
function renderDelta(event: StreamEvent, block: OpenBlock, endBlock: () => void): OpenBlock {
  const inner = event.event;
  if (!inner) return block;
  if (inner.type === "content_block_stop") {
    endBlock();
    return null;
  }
  if (inner.type !== "content_block_delta" || !inner.delta) return block;

  if (inner.delta.type === "thinking_delta") {
    const thinking = inner.delta.thinking;
    if (thinking === undefined || thinking.length === 0) return block;
    if (block !== "thinking") {
      endBlock();
      process.stdout.write(`${style.dim}· `);
    }
    process.stdout.write(thinking);
    return "thinking";
  }
  if (inner.delta.type === "text_delta") {
    const text = inner.delta.text;
    if (text === undefined || text.length === 0) return block;
    if (block !== "text") {
      endBlock();
      process.stdout.write(style.reset);
    }
    process.stdout.write(text);
    return "text";
  }
  return block;
}

/** One line for what the agent did, with the noise taken out. */
function describeToolUse(part: ContentPart): string {
  const input = part.input ?? {};
  if (part.name === "Bash" && typeof input.command === "string") {
    return input.command.replace(/\s+/g, " ").slice(0, 160);
  }
  if (typeof input.file_path === "string") return `${part.name} ${input.file_path}`;
  if (typeof input.pattern === "string") return `${part.name} ${input.pattern}`;
  return part.name ?? "tool";
}

/** What came back, and the screenshots it mentions, drawn once each. */
function renderToolResult(part: ContentPart, shown: Set<string>): void {
  const text = resultText(part);
  const shots = [...text.matchAll(SHOT_PATH)].map((match) => match[1] ?? "");

  const summary = text.replace(/\s+/g, " ").trim().slice(0, 160);
  if (summary.length > 0 && shots.length === 0)
    console.log(`${style.dim}  ${summary}${style.reset}`);

  for (const shot of shots) {
    if (shown.has(shot)) continue;
    shown.add(shot);
    console.log(`${style.dim}  ${shot}${style.reset}`);
    drawImage(shot);
  }
}

/** A tool result's text, whether it came as a string or as content blocks. */
function resultText(part: ContentPart): string {
  if (typeof part.content === "string") return part.content;
  if (!Array.isArray(part.content)) return "";
  const texts: string[] = [];
  for (const entry of part.content) {
    if (typeof entry.text === "string") texts.push(entry.text);
  }
  return texts.join("\n");
}

let imageSupport: "kitty" | "none" | null = null;

/** Draw a screenshot in the terminal, if this terminal can draw one. */
function drawImage(path: string): void {
  if (imageSupport === null) imageSupport = detectImageSupport();
  if (imageSupport === "none") return;
  // Inherited stdio: the kitten writes the graphics escape to the terminal
  // itself, and needs the controlling tty to measure the window.
  spawnSync("kitten", ["icat", "--align", "left", path], { stdio: "inherit" });
}

/**
 * Whether the terminal renders images. Inside tmux the graphics protocol only
 * gets through with passthrough on, which is off by default — say so once.
 */
function detectImageSupport(): "kitty" | "none" {
  const isKitty =
    process.env.KITTY_WINDOW_ID !== undefined ||
    process.env.TERM_PROGRAM === "kitty" ||
    (process.env.TERM ?? "").includes("kitty");
  if (!isKitty) return "none";

  if (spawnSync("which", ["kitten"]).status !== 0) {
    console.log(`${style.yellow}(screenshots not drawn: kitten is not on PATH)${style.reset}`);
    return "none";
  }
  if (process.env.TMUX !== undefined && !tmuxPassthroughOn()) {
    console.log(
      `${style.yellow}(screenshots not drawn inside tmux — tmux set -g allow-passthrough on)${style.reset}`,
    );
    return "none";
  }
  return "kitty";
}

/** Whether tmux lets the graphics protocol through. */
function tmuxPassthroughOn(): boolean {
  const setting = spawnSync("tmux", ["show", "-gv", "allow-passthrough"], { encoding: "utf8" });
  if (setting.status !== 0) return false;
  const value = setting.stdout.trim();
  return value === "on" || value === "all";
}
