// ComfyUI's HTTP and WebSocket API, as the server uses it. Nothing here holds
// state beyond the address: which runs exist and where their outputs go is the
// `comfyui` plugin's business.

import type { ComfyNodeDefinitions, ComfyWorkflow } from "@nib-ui/ui-contracts";

/** How long a status check waits before calling the server unreachable. */
const STATUS_TIMEOUT_MS = 2_000;
/** Everything but downloads: ComfyUI answers these from memory. */
const REQUEST_TIMEOUT_MS = 30_000;
/** A mesh or a video can be large, and ComfyUI serves it off disk. */
const DOWNLOAD_TIMEOUT_MS = 5 * 60_000;
/** Uploaded inputs go here in ComfyUI's input directory, apart from the user's own. */
const UPLOAD_SUBFOLDER = "nib";

export class ComfyApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ComfyApiError";
  }
}

/** Only what these calls need, so a test can hand over a plain function. */
export type FetchImpl = (input: URL | string, init?: RequestInit) => Promise<Response>;

/** A file ComfyUI wrote, addressed the way `GET /view` takes it. */
export interface ComfyFile {
  filename: string;
  subfolder: string;
  type: string;
}

/** The socket messages a run is followed by, reduced to what the app reads. */
export type ComfyEvent =
  | { type: "execution_start"; promptId: string }
  | { type: "executing"; promptId: string; nodeId: string | null }
  | { type: "progress"; promptId: string; nodeId: string | null; value: number; max: number }
  | { type: "executed"; promptId: string; files: ComfyFile[] }
  | { type: "execution_success"; promptId: string }
  | {
      type: "execution_error";
      promptId: string;
      nodeId: string | null;
      nodeType: string | null;
      message: string;
    }
  | { type: "execution_interrupted"; promptId: string };

/** What `GET /history/{id}` says about one prompt. */
export interface ComfyHistoryEntry {
  outputs: ComfyFile[];
  status: "success" | "error" | "pending";
  errorMessage: string | null;
}

/**
 * Checks a user-supplied address and strips what would break joining paths onto
 * it. Only http(s): the server fetches this, and anything else is not ComfyUI.
 */
export function normalizeBaseUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new ComfyApiError(`not a url: ${value}`, 400);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new ComfyApiError("the ComfyUI address has to be http or https", 400);
  }
  return url.origin + url.pathname.replace(/\/+$/, "");
}

/** The socket address for a base url: same host, `ws` in place of `http`. */
export function socketUrl(baseUrl: string, clientId: string): string {
  const url = new URL(`${baseUrl}/ws`);
  url.protocol = url.protocol.replace("http", "ws");
  url.searchParams.set("clientId", clientId);
  return url.toString();
}

/** A string field of an object that may not be one, or null. */
function stringField(source: Record<string, unknown>, key: string): string | null {
  const value = source[key];
  if (typeof value !== "string") return null;
  return value;
}

/** A numeric field of an object that may not be one, or zero. */
function numberField(source: Record<string, unknown>, key: string): number {
  const value = source[key];
  if (typeof value !== "number") return 0;
  return value;
}

/** Narrows an unknown value to a plain object, or null. */
function asRecord(value: unknown): Record<string, unknown> | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  return Object.fromEntries(Object.entries(value));
}

/**
 * One socket message, or null for the ones a run does not care about: `status`,
 * `progress_state`, cached-node lists, and the binary preview frames.
 */
export function parseSocketMessage(text: string): ComfyEvent | null {
  let message: Record<string, unknown> | null;
  try {
    message = asRecord(JSON.parse(text));
  } catch {
    return null;
  }
  if (!message) return null;
  const data = asRecord(message.data);
  if (!data) return null;
  const promptId = stringField(data, "prompt_id");
  if (promptId === null) return null;
  return eventFromData(stringField(message, "type"), promptId, data);
}

/** The event a message's type and payload describe, or null for an uninteresting one. */
function eventFromData(
  type: string | null,
  promptId: string,
  data: Record<string, unknown>,
): ComfyEvent | null {
  if (type === "execution_start") return { type, promptId };
  if (type === "execution_success") return { type, promptId };
  if (type === "execution_interrupted") return { type, promptId };
  if (type === "executing") return { type, promptId, nodeId: stringField(data, "node") };
  if (type === "executed") return { type, promptId, files: nodeOutputFiles(data.output) };
  if (type === "progress") {
    return {
      type,
      promptId,
      nodeId: stringField(data, "node"),
      value: numberField(data, "value"),
      max: numberField(data, "max"),
    };
  }
  if (type === "execution_error") {
    let message = stringField(data, "exception_message");
    if (message === null) message = "the workflow failed";
    return {
      type,
      promptId,
      nodeId: stringField(data, "node_id"),
      nodeType: stringField(data, "node_type"),
      message: message.trim(),
    };
  }
  return null;
}

/**
 * The files a finished prompt saved. Nodes key their outputs however they like —
 * `images`, `gifs`, `audio`, `3d` — so every list is read, and an entry counts
 * when it names a file in the output directory. `temp` files are previews.
 */
export function outputFiles(outputs: unknown): ComfyFile[] {
  const byNode = asRecord(outputs);
  if (!byNode) return [];
  const files: ComfyFile[] = [];
  for (const nodeOutput of Object.values(byNode)) files.push(...nodeOutputFiles(nodeOutput));
  return files;
}

/** The saved files in one node's output: every list it has, read the same way. */
function nodeOutputFiles(nodeOutput: unknown): ComfyFile[] {
  const lists = asRecord(nodeOutput);
  if (!lists) return [];
  const files: ComfyFile[] = [];
  for (const list of Object.values(lists)) files.push(...savedFiles(list));
  return files;
}

/** The entries of one output list that are files saved to the output directory. */
function savedFiles(list: unknown): ComfyFile[] {
  if (!Array.isArray(list)) return [];
  const files: ComfyFile[] = [];
  for (const item of list) {
    const entry = asRecord(item);
    if (!entry) continue;
    const filename = stringField(entry, "filename");
    if (filename === null || stringField(entry, "type") !== "output") continue;
    let subfolder = stringField(entry, "subfolder");
    if (subfolder === null) subfolder = "";
    files.push({ filename, subfolder, type: "output" });
  }
  return files;
}

/** One prompt's entry in a `GET /history/{id}` body. */
export function parseHistory(body: unknown, promptId: string): ComfyHistoryEntry {
  const entry = asRecord(asRecord(body)?.[promptId]);
  if (!entry) return { outputs: [], status: "pending", errorMessage: null };
  const status = asRecord(entry.status);
  const outputs = outputFiles(entry.outputs);
  if (status?.status_str === "success") return { outputs, status: "success", errorMessage: null };
  if (status?.status_str === "error") {
    return { outputs, status: "error", errorMessage: historyErrorMessage(status.messages) };
  }
  return { outputs, status: "pending", errorMessage: null };
}

/** The exception message out of a history entry's status messages. */
function historyErrorMessage(messages: unknown): string {
  if (!Array.isArray(messages)) return "the workflow failed";
  for (const message of messages) {
    if (!Array.isArray(message) || message[0] !== "execution_error") continue;
    const data = asRecord(message[1]);
    const text = data && stringField(data, "exception_message");
    if (text) return text.trim();
  }
  return "the workflow failed";
}

/**
 * What a rejected `POST /prompt` says was wrong. ComfyUI validates the whole
 * graph before queueing and answers 400 with a top-level error plus one entry per
 * node, and the node entries are the ones worth reading.
 */
export function promptErrorMessage(body: unknown): string {
  const payload = asRecord(body);
  const lines: string[] = [];
  const error = asRecord(payload?.error);
  if (error) lines.push(errorLine(error));

  const nodeErrors = asRecord(payload?.node_errors);
  for (const [nodeId, value] of Object.entries(nodeErrors ?? {})) {
    const node = asRecord(value);
    const errors = node?.errors;
    if (!Array.isArray(errors)) continue;
    for (const entry of errors) {
      const detail = asRecord(entry);
      if (detail) lines.push(`node ${nodeId} (${String(node?.class_type)}): ${errorLine(detail)}`);
    }
  }
  if (lines.length === 0) return "ComfyUI rejected the workflow";
  return lines.join("\n");
}

/** `message: details`, or just the message when there are none. */
function errorLine(error: Record<string, unknown>): string {
  const message = stringField(error, "message");
  const details = stringField(error, "details");
  if (details && details.length > 0) return `${message}: ${details}`;
  return String(message);
}

/** The workflow with each upload's name written into the input it feeds. */
export function withInputs(
  workflow: ComfyWorkflow,
  assignments: readonly { nodeId: string; input: string; value: string }[],
): ComfyWorkflow {
  const next: ComfyWorkflow = structuredClone(workflow);
  for (const assignment of assignments) {
    const node = next[assignment.nodeId];
    if (!node) throw new ComfyApiError(`the workflow has no node ${assignment.nodeId}`, 400);
    node.inputs[assignment.input] = assignment.value;
  }
  return next;
}

/** Talks to one ComfyUI server over HTTP. */
export class ComfyClient {
  constructor(
    readonly baseUrl: string,
    private readonly fetchImpl: FetchImpl = fetch,
  ) {}

  /** `GET /system_stats`; the version is what the status line shows. */
  async version(): Promise<string | null> {
    const body = asRecord(await this.json("/system_stats", {}, STATUS_TIMEOUT_MS));
    const system = asRecord(body?.system);
    if (!system) return null;
    return stringField(system, "comfyui_version");
  }

  /** `GET /object_info`: every node the server can run. */
  async nodeDefinitions(): Promise<ComfyNodeDefinitions> {
    const body = asRecord(await this.json("/object_info"));
    const definitions: ComfyNodeDefinitions = {};
    for (const [name, value] of Object.entries(body ?? {})) {
      const definition = asRecord(value);
      if (definition) definitions[name] = definition;
    }
    return definitions;
  }

  /** `POST /prompt`, answering with the `prompt_id`. A graph ComfyUI rejects throws. */
  async queue(workflow: ComfyWorkflow, clientId: string): Promise<string> {
    const response = await this.request("/prompt", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompt: workflow, client_id: clientId }),
    });
    const body = asRecord(await readBody(response));
    if (response.status === 400) throw new ComfyApiError(promptErrorMessage(body), 400);
    failUnlessOk(response, body);
    const promptId = body && stringField(body, "prompt_id");
    if (!promptId) throw new ComfyApiError("ComfyUI queued the workflow without an id", 502);
    return promptId;
  }

  /** Drops prompts that have not started yet. */
  async deleteQueued(promptIds: readonly string[]): Promise<void> {
    await this.json("/queue", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ delete: promptIds }),
    });
  }

  /** Stops the prompt that is executing, if it is this one. */
  async interrupt(promptId: string): Promise<void> {
    await this.json("/interrupt", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompt_id: promptId }),
    });
  }

  /** `GET /history/{id}`. */
  async history(promptId: string): Promise<ComfyHistoryEntry> {
    return parseHistory(await this.json(`/history/${encodeURIComponent(promptId)}`), promptId);
  }

  /** The bytes of a file ComfyUI wrote. */
  async download(file: ComfyFile): Promise<Uint8Array> {
    const params = new URLSearchParams({
      filename: file.filename,
      subfolder: file.subfolder,
      type: file.type,
    });
    const response = await this.request(`/view?${params.toString()}`, {}, DOWNLOAD_TIMEOUT_MS);
    if (!response.ok) failUnlessOk(response, await readBody(response));
    return new Uint8Array(await response.arrayBuffer());
  }

  /**
   * `POST /upload/image`, answering with the name a loader node takes. Same-named
   * uploads overwrite each other, which is right for an input: the vault holds the
   * original, and the latest bytes are the ones the user means.
   */
  async upload(bytes: Uint8Array, name: string, contentType: string): Promise<string> {
    const form = new FormData();
    form.set("image", new Blob([new Uint8Array(bytes)], { type: contentType }), name);
    form.set("subfolder", UPLOAD_SUBFOLDER);
    form.set("type", "input");
    form.set("overwrite", "true");
    const body = asRecord(await this.json("/upload/image", { method: "POST", body: form }));
    const uploaded = body && stringField(body, "name");
    if (!uploaded) throw new ComfyApiError("ComfyUI took the upload without naming it", 502);
    const subfolder = stringField(body, "subfolder");
    if (subfolder && subfolder.length > 0) return `${subfolder}/${uploaded}`;
    return uploaded;
  }

  /** A request whose answer is json, failing on anything but a 2xx. */
  private async json(
    path: string,
    init: RequestInit = {},
    timeoutMs = REQUEST_TIMEOUT_MS,
  ): Promise<unknown> {
    const response = await this.request(path, init, timeoutMs);
    const body = await readBody(response);
    failUnlessOk(response, body);
    return body;
  }

  /** One request, with a refused connection turned into an error that says so. */
  private async request(
    path: string,
    init: RequestInit,
    timeoutMs = REQUEST_TIMEOUT_MS,
  ): Promise<Response> {
    try {
      return await this.fetchImpl(`${this.baseUrl}${path}`, {
        ...init,
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (cause) {
      throw new ComfyApiError(
        `ComfyUI is not reachable at ${this.baseUrl} (${reason(cause)})`,
        503,
      );
    }
  }
}

/** A response body as json when it is json, as text otherwise. */
async function readBody(response: Response): Promise<unknown> {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/** Throws the server's own complaint for a non-2xx response. */
function failUnlessOk(response: Response, body: unknown): void {
  if (response.ok) return;
  let message = `ComfyUI responded ${response.status}`;
  const error = asRecord(asRecord(body)?.error);
  if (error) message = errorLine(error);
  if (typeof body === "string" && body.length > 0) message = body.slice(0, 400);
  throw new ComfyApiError(message, response.status);
}

/** Why a request failed, in a few words. */
function reason(cause: unknown): string {
  if (cause instanceof Error && cause.name === "TimeoutError") return "timed out";
  if (cause instanceof Error) return cause.message;
  return String(cause);
}
