/**
 * The wire between the main process and the `nib-overlay` sidecar: line-delimited JSON
 * over stdio, one message per newline.
 *
 * Only the main process speaks it — the renderer reaches the sidecar through the preload
 * bridge, over structured-cloned objects — so this module has exactly one consumer and
 * lives here rather than in a shared package. Nothing in it spawns a process or touches
 * the filesystem, which is what makes the whole protocol testable.
 *
 * Parsing is hand-written rather than schema-driven: `apps/desktop` has no runtime
 * dependencies, and this is not the place to acquire the first one.
 */
import type {
  ApplicationIdentity,
  CaptureRequest,
  DesktopRect,
  DetectedRegion,
  OverlaySpec,
  PointerSample,
  SidecarCapabilities,
} from "@nib-ui/ui-contracts/desktop-agent";

export type { SidecarCapabilities };

export const PROTOCOL_VERSION = 1;

/**
 * A line past this is dropped rather than buffered. Nothing legitimate approaches it —
 * capture results are paths, not bytes — so a line this long means the far end is
 * writing something that is not our protocol.
 */
export const MAX_LINE_BYTES = 1024 * 1024;

/** Unsolicited events carry this instead of a request id. */
export const EVENT_ID = 0;

export interface ShortcutBinding {
  id: string;
  /** Portal shortcut syntax, e.g. `CTRL+SHIFT+s`. The portal may rebind it. */
  trigger: string;
  description: string;
}

export type HostRequest =
  | { type: "hello"; protocol: number }
  | { type: "overlay.show"; spec: OverlaySpec }
  | { type: "overlay.update"; spec: OverlaySpec }
  | { type: "overlay.hide" }
  | { type: "pointer.subscribe"; hz: number }
  | { type: "pointer.unsubscribe" }
  | { type: "capture"; request: CaptureRequest }
  | { type: "focus.query" }
  | { type: "focus.subscribe" }
  | { type: "accessibility.tree"; appId?: string; maxNodes: number }
  | { type: "shortcuts.bind"; shortcuts: ShortcutBinding[] }
  | { type: "shutdown" };

export type HostMessage = HostRequest & { v: number; id: number };

/** What a `capture` reply carries: a path on disk, never the bytes. */
export interface CapturePayload {
  path: string;
  width: number;
  height: number;
  output: string | null;
  takenAt: number;
  application: ApplicationIdentity | null;
  /** The desktop-layout box the image covers, where the compositor could say. */
  layout: DesktopRect | null;
  redacted: number;
}

/**
 * A closed set, so the host branches on the code and shows the message. `denied` is a
 * first-class answer — a portal the user refused is not an exceptional condition.
 */
export type SidecarErrorCode = "unsupported" | "denied" | "timeout" | "not-found" | "internal";

export type SidecarLogLevel = "debug" | "info" | "warn" | "error";

export type SidecarBody =
  | { type: "capabilities"; capabilities: SidecarCapabilities }
  | { type: "ok"; payload: unknown }
  | { type: "err"; code: SidecarErrorCode; message: string; retryable: boolean }
  | { type: "pointer"; sample: PointerSample }
  | { type: "focus"; application: ApplicationIdentity }
  | { type: "shortcut"; shortcutId: string }
  | { type: "log"; level: SidecarLogLevel; message: string };

export type SidecarMessage = SidecarBody & { v: number; id: number };

/** A line that is not a message. Reported rather than thrown: the stream continues. */
export interface MalformedMessage {
  type: "malformed";
  reason: string;
  /** Clipped, so a megabyte of noise does not end up in a log line. */
  sample: string;
}

export type DecodedMessage = SidecarMessage | MalformedMessage;

export function isMalformed(message: DecodedMessage): message is MalformedMessage {
  return message.type === "malformed";
}

/**
 * A host message as one line. `JSON.stringify` escapes every control character, so the
 * framing newline is the only one that can appear and there is nothing to guard against.
 */
export function encode(message: HostMessage): string {
  return `${JSON.stringify(message)}\n`;
}

/** Convenience for the supervisor, which owns the id counter. */
export function request(id: number, body: HostRequest): HostMessage {
  return { v: PROTOCOL_VERSION, id, ...body };
}

function malformed(reason: string, line: string): MalformedMessage {
  return { type: "malformed", reason, sample: line.slice(0, 200) };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function parseRect(raw: unknown): DesktopRect | null {
  if (!isRecord(raw)) return null;
  const { x, y, width, height } = raw;
  if (typeof x !== "number" || typeof y !== "number") return null;
  if (typeof width !== "number" || typeof height !== "number") return null;
  if (
    !Number.isFinite(x) ||
    !Number.isFinite(y) ||
    !Number.isFinite(width) ||
    !Number.isFinite(height)
  )
    return null;
  return { x, y, width, height };
}

export function parseIdentity(raw: unknown): ApplicationIdentity | null {
  if (!isRecord(raw)) return null;
  const pid = raw.pid;
  return {
    appId: optionalString(raw.appId),
    atspiName: optionalString(raw.atspiName),
    desktopEntry: optionalString(raw.desktopEntry),
    title: optionalString(raw.title),
    pid: typeof pid === "number" && Number.isFinite(pid) ? pid : null,
  };
}

const CAPTURE_STRATEGIES = new Set(["portal", "compositor-tools", "unavailable"]);
const FOCUS_STRATEGIES = new Set(["compositor-ipc", "atspi", "unavailable"]);
const POINTER_STRATEGIES = new Set(["compositor-ipc", "unavailable"]);
const SESSION_TYPES = new Set(["wayland", "x11", "unknown"]);
const ERROR_CODES = new Set(["unsupported", "denied", "timeout", "not-found", "internal"]);
const LOG_LEVELS = new Set(["debug", "info", "warn", "error"]);
const REGION_SOURCES = new Set(["atspi", "pixel"]);

function parseCapabilities(raw: unknown): SidecarCapabilities | null {
  if (!isRecord(raw)) return null;
  const { capture, focus, pointer, sessionType, layerShell } = raw;
  if (typeof capture !== "string" || !CAPTURE_STRATEGIES.has(capture)) return null;
  if (typeof focus !== "string" || !FOCUS_STRATEGIES.has(focus)) return null;
  if (typeof pointer !== "string" || !POINTER_STRATEGIES.has(pointer)) return null;
  if (typeof sessionType !== "string" || !SESSION_TYPES.has(sessionType)) return null;
  if (typeof layerShell !== "boolean") return null;

  const notes = Array.isArray(raw.notes)
    ? raw.notes.filter((note): note is string => typeof note === "string")
    : [];
  return {
    capture: capture as SidecarCapabilities["capture"],
    focus: focus as SidecarCapabilities["focus"],
    pointer: pointer as SidecarCapabilities["pointer"],
    compositor: optionalString(raw.compositor),
    sessionType: sessionType as SidecarCapabilities["sessionType"],
    layerShell,
    notes,
  };
}

/**
 * Regions arrive inside an `ok` payload rather than as their own message type, so this
 * is exported for the supervisor to apply to a reply it already knows the shape of.
 * A malformed region is dropped; one bad node must not cost the whole tree.
 */
export function parseDetectedRegions(raw: unknown): DetectedRegion[] {
  if (!Array.isArray(raw)) return [];
  const regions: DetectedRegion[] = [];
  for (const entry of raw) {
    if (!isRecord(entry)) continue;
    const rect = parseRect(entry.rect);
    const { id, source, confidence } = entry;
    if (!rect || typeof id !== "string" || id.length === 0) continue;
    if (typeof source !== "string" || !REGION_SOURCES.has(source)) continue;
    regions.push({
      id,
      rect,
      source: source as DetectedRegion["source"],
      confidence: typeof confidence === "number" && Number.isFinite(confidence) ? confidence : 0,
      ...(typeof entry.label === "string" && { label: entry.label }),
      ...(typeof entry.role === "string" && { role: entry.role }),
      ...(entry.sensitive === true && { sensitive: true }),
    });
  }
  return regions;
}

/** The shape of a `capture` reply's payload, applied by the supervisor. */
export function parseCapturePayload(raw: unknown): CapturePayload | null {
  if (!isRecord(raw)) return null;
  const { path, width, height, takenAt } = raw;
  if (typeof path !== "string" || path.length === 0) return null;
  if (typeof width !== "number" || typeof height !== "number") return null;
  if (width <= 0 || height <= 0) return null;
  const redacted = raw.redacted;
  return {
    path,
    width,
    height,
    output: optionalString(raw.output),
    takenAt: typeof takenAt === "number" && Number.isFinite(takenAt) ? takenAt : 0,
    application: parseIdentity(raw.application),
    layout: parseRect(raw.layout),
    redacted: typeof redacted === "number" && Number.isFinite(redacted) ? redacted : 0,
  };
}

function parseBody(raw: Record<string, unknown>, line: string): SidecarBody | MalformedMessage {
  switch (raw.type) {
    case "capabilities": {
      const capabilities = parseCapabilities(raw.capabilities);
      if (!capabilities) return malformed("capabilities are missing or incomplete", line);
      return { type: "capabilities", capabilities };
    }
    case "ok":
      // The payload's shape depends on the request it answers, which only the
      // supervisor knows; it is carried opaquely and parsed there.
      return { type: "ok", payload: "payload" in raw ? raw.payload : null };
    case "err": {
      const { code, message } = raw;
      if (typeof code !== "string" || !ERROR_CODES.has(code))
        return malformed(`unknown error code "${String(code)}"`, line);
      if (typeof message !== "string") return malformed("err has no message", line);
      return {
        type: "err",
        code: code as SidecarErrorCode,
        message,
        retryable: raw.retryable === true,
      };
    }
    case "pointer": {
      const sample = raw.sample;
      if (!isRecord(sample) || typeof sample.x !== "number" || typeof sample.y !== "number") {
        return malformed("pointer sample is missing coordinates", line);
      }
      return {
        type: "pointer",
        sample: { x: sample.x, y: sample.y, output: optionalString(sample.output) },
      };
    }
    case "focus": {
      const application = parseIdentity(raw.application);
      if (!application) return malformed("focus has no application", line);
      return { type: "focus", application };
    }
    case "shortcut": {
      const shortcutId = raw.shortcutId;
      if (typeof shortcutId !== "string" || shortcutId.length === 0)
        return malformed("shortcut has no id", line);
      return { type: "shortcut", shortcutId };
    }
    case "log": {
      const { level, message } = raw;
      if (typeof level !== "string" || !LOG_LEVELS.has(level))
        return malformed(`unknown log level "${String(level)}"`, line);
      if (typeof message !== "string") return malformed("log has no message", line);
      return { type: "log", level: level as SidecarLogLevel, message };
    }
    default:
      return malformed(`unknown message type "${String(raw.type)}"`, line);
  }
}

/**
 * One line into one message. Never throws: a sidecar writing garbage to stdout is a
 * thing to report and step over, not a reason to tear down the pipe.
 */
export function decode(line: string): DecodedMessage {
  const trimmed = line.trim();
  if (trimmed.length === 0) return malformed("empty line", line);

  let raw: unknown;
  try {
    raw = JSON.parse(trimmed);
  } catch (cause) {
    return malformed(cause instanceof Error ? cause.message : "invalid JSON", line);
  }
  if (!isRecord(raw)) return malformed("a message must be an object", line);

  if (raw.v !== PROTOCOL_VERSION)
    return malformed(`unsupported protocol version ${String(raw.v)}`, line);
  const id = raw.id;
  if (typeof id !== "number" || !Number.isInteger(id) || id < 0)
    return malformed("id must be a non-negative integer", line);

  const body = parseBody(raw, line);
  if (body.type === "malformed") return body;
  return { v: PROTOCOL_VERSION, id, ...body };
}

/**
 * Turns a byte stream that has already been decoded to text into whole messages. The
 * caller pushes whatever the pipe gave it: a partial line, several lines at once, or a
 * line split three ways all come out the same.
 */
export class FrameReader {
  private buffer = "";

  constructor(private readonly maxBytes = MAX_LINE_BYTES) {}

  push(chunk: string): DecodedMessage[] {
    this.buffer += chunk;
    const messages: DecodedMessage[] = [];

    let newline = this.buffer.indexOf("\n");
    while (newline !== -1) {
      const line = this.buffer.slice(0, newline);
      this.buffer = this.buffer.slice(newline + 1);
      // A blank line between messages is the far end being tidy, not an error.
      if (line.trim().length > 0) messages.push(decode(line));
      newline = this.buffer.indexOf("\n");
    }

    // Dropped rather than buffered: without this a sidecar that never writes a
    // newline grows this string until the main process dies.
    if (this.buffer.length > this.maxBytes) {
      messages.push(malformed(`line exceeded ${this.maxBytes} bytes`, this.buffer));
      this.buffer = "";
    }
    return messages;
  }

  /** What is held for a line that has not ended yet, for a disconnect diagnostic. */
  get pending(): string {
    return this.buffer;
  }

  reset(): void {
    this.buffer = "";
  }
}
