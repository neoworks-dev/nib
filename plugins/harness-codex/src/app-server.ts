import { spawn } from "node:child_process";

/**
 * How long a throwaway `codex app-server` gets to answer. It only has to start
 * and reply; it never runs a turn.
 */
const appServerTimeoutMs = 30_000;

export interface JsonRpcMessage {
  id?: number;
  result?: unknown;
  error?: { message?: unknown };
}

/**
 * Runs one JSON-RPC request against a throwaway `codex app-server`. The server
 * speaks newline-delimited JSON-RPC on stdio and wants an `initialize` handshake
 * before anything else, so both happen here and the process is killed as soon
 * as the answer arrives.
 */
export function appServerRequest(
  executable: string,
  method: string,
  params: Record<string, unknown>,
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const server = spawn(executable, ["app-server"], { stdio: ["pipe", "pipe", "ignore"] });
    const timer = setTimeout(
      () => finish(new Error(`codex ${method} timed out`)),
      appServerTimeoutMs,
    );

    /** Settles the request once and tears the server down. */
    function finish(error: Error | null, value?: unknown): void {
      clearTimeout(timer);
      server.kill();
      if (error) {
        reject(error);
        return;
      }
      resolve(value);
    }

    /** Writes one protocol message to the server. */
    function send(message: Record<string, unknown>): void {
      server.stdin.write(`${JSON.stringify(message)}\n`);
    }

    server.on("error", (cause) => finish(cause));
    server.stdin.on("error", (cause) => finish(cause));
    readJsonLines(server.stdout, (message) => {
      if (message.id === 1) {
        send({ jsonrpc: "2.0", method: "initialized" });
        send({ jsonrpc: "2.0", id: 2, method, params });
        return;
      }
      if (message.id !== 2) return;
      if (message.error) {
        finish(new Error(describeRpcError(message.error, method)));
        return;
      }
      finish(null, message.result);
    });

    send({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { clientInfo: { name: "nib", version: "0" } },
    });
  });
}

/** The server's own words for a failed request, when it sent any. */
function describeRpcError(error: { message?: unknown }, method: string): string {
  if (typeof error.message === "string" && error.message.length > 0) return error.message;
  return `codex ${method} failed`;
}

/** Folds a stdout stream into whole newline-delimited JSON messages. */
export function readJsonLines(
  stream: NodeJS.ReadableStream,
  onMessage: (message: JsonRpcMessage) => void,
): void {
  let buffered = "";
  stream.setEncoding("utf8");
  stream.on("data", (chunk: string) => {
    buffered += chunk;
    const lastNewline = buffered.lastIndexOf("\n");
    if (lastNewline === -1) return;
    const complete = buffered.slice(0, lastNewline);
    // Whatever follows the last newline is a message still arriving.
    buffered = buffered.slice(lastNewline + 1);
    for (const line of complete.split("\n")) {
      const message = parseMessage(line);
      if (message) onMessage(message);
    }
  });
}

/** One line of the stream, or null when it is not a protocol message. */
function parseMessage(line: string): JsonRpcMessage | null {
  if (!line.trim()) return null;
  try {
    const parsed: unknown = JSON.parse(line);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
    return parsed as JsonRpcMessage;
  } catch {
    // The server interleaves diagnostics that are not protocol messages.
    return null;
  }
}
