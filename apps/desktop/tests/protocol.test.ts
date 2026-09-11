import { describe, expect, test } from "bun:test";
import {
  decode,
  EVENT_ID,
  encode,
  FrameReader,
  type HostRequest,
  PROTOCOL_VERSION,
  parseCapturePayload,
  parseDetectedRegions,
  request,
  type SidecarCapabilities,
  type SidecarMessage,
} from "../src/main/desktop-agent/protocol";

const capabilities: SidecarCapabilities = {
  capture: "portal",
  focus: "compositor-ipc",
  pointer: "compositor-ipc",
  compositor: "Hyprland",
  sessionType: "wayland",
  layerShell: true,
  notes: [],
};

function line(message: Record<string, unknown>): string {
  return JSON.stringify({ v: PROTOCOL_VERSION, id: 1, ...message });
}

describe("encode", () => {
  test("every host request survives a JSON round trip", () => {
    const requests: HostRequest[] = [
      { type: "hello", protocol: PROTOCOL_VERSION },
      {
        type: "overlay.show",
        spec: { regions: [{ rect: { x: 1, y: 2, width: 3, height: 4 }, tone: "accent" }] },
      },
      {
        type: "overlay.update",
        spec: { regions: [], pointer: { radius: 24, tone: "muted" }, output: "DP-1" },
      },
      { type: "overlay.hide" },
      { type: "pointer.subscribe", hz: 30 },
      { type: "pointer.unsubscribe" },
      { type: "capture", request: { mode: "screen" } },
      { type: "capture", request: { mode: "window", windowId: "0x1f" } },
      {
        type: "capture",
        request: { mode: "region", rect: { x: 0, y: 0, width: 100, height: 50 } },
      },
      { type: "focus.query" },
      { type: "focus.subscribe" },
      { type: "accessibility.tree", maxNodes: 500 },
      {
        type: "shortcuts.bind",
        shortcuts: [{ id: "capture", trigger: "CTRL+SHIFT+s", description: "Capture" }],
      },
      { type: "shutdown" },
    ];

    for (const [index, body] of requests.entries()) {
      const encoded = encode(request(index, body));
      expect(encoded.endsWith("\n")).toBe(true);
      expect(JSON.parse(encoded)).toEqual({ v: PROTOCOL_VERSION, id: index, ...body });
    }
  });

  test("a newline inside a field is escaped, so the terminator is the only one", () => {
    const encoded = encode(request(1, { type: "accessibility.tree", appId: "a\nb", maxNodes: 1 }));
    expect(encoded.indexOf("\n")).toBe(encoded.length - 1);
  });
});

describe("decode", () => {
  test("reads a capabilities report", () => {
    const message = decode(line({ type: "capabilities", capabilities }));
    expect(message).toEqual({ v: PROTOCOL_VERSION, id: 1, type: "capabilities", capabilities });
  });

  test("carries an ok payload opaquely, because only the caller knows its shape", () => {
    const message = decode(line({ type: "ok", payload: { path: "/tmp/a.png", extra: [1, 2] } }));
    expect(message).toEqual({
      v: PROTOCOL_VERSION,
      id: 1,
      type: "ok",
      payload: { path: "/tmp/a.png", extra: [1, 2] },
    });
  });

  test("an ok with no payload is not malformed", () => {
    expect(decode(line({ type: "ok" }))).toEqual({
      v: PROTOCOL_VERSION,
      id: 1,
      type: "ok",
      payload: null,
    });
  });

  test("reads every error code and defaults retryable to false", () => {
    for (const code of ["unsupported", "denied", "timeout", "not-found", "internal"]) {
      expect(decode(line({ type: "err", code, message: "no" }))).toEqual({
        v: PROTOCOL_VERSION,
        id: 1,
        type: "err",
        code: code as never,
        message: "no",
        retryable: false,
      });
    }
  });

  test("rejects an error code outside the closed set", () => {
    expect(decode(line({ type: "err", code: "kaput", message: "no" }))).toMatchObject({
      type: "malformed",
      reason: 'unknown error code "kaput"',
    });
  });

  test("reads a pointer sample and an event id of zero", () => {
    const raw = JSON.stringify({
      v: PROTOCOL_VERSION,
      id: EVENT_ID,
      type: "pointer",
      sample: { x: 12, y: 34 },
    });
    expect(decode(raw)).toEqual({
      v: PROTOCOL_VERSION,
      id: 0,
      type: "pointer",
      sample: { x: 12, y: 34, output: null },
    });
  });

  test("a focus event fills every unanswered identity field with null", () => {
    const message = decode(
      line({ type: "focus", application: { appId: "blender" } }),
    ) as SidecarMessage;
    expect(message).toEqual({
      v: PROTOCOL_VERSION,
      id: 1,
      type: "focus",
      application: {
        appId: "blender",
        atspiName: null,
        desktopEntry: null,
        title: null,
        pid: null,
      },
    });
  });

  test.each([
    ["unknown type", line({ type: "nope" }), 'unknown message type "nope"'],
    [
      "wrong version",
      JSON.stringify({ v: 2, id: 1, type: "ok" }),
      "unsupported protocol version 2",
    ],
    [
      "missing id",
      JSON.stringify({ v: PROTOCOL_VERSION, type: "ok" }),
      "id must be a non-negative integer",
    ],
    [
      "fractional id",
      JSON.stringify({ v: PROTOCOL_VERSION, id: 1.5, type: "ok" }),
      "id must be a non-negative integer",
    ],
    [
      "negative id",
      JSON.stringify({ v: PROTOCOL_VERSION, id: -1, type: "ok" }),
      "id must be a non-negative integer",
    ],
    ["array", "[1,2,3]", "a message must be an object"],
    ["empty", "   ", "empty line"],
  ])("reports %s rather than throwing", (_name, raw, reason) => {
    expect(decode(raw)).toMatchObject({ type: "malformed", reason });
  });

  test("reports truncated JSON without throwing", () => {
    const message = decode('{"v":1,"id":1,"type":"ok"');
    expect(message.type).toBe("malformed");
  });

  test("clips the sample it reports, so a huge line is not logged whole", () => {
    const message = decode(`{"junk":"${"x".repeat(5000)}"}`);
    expect(message).toMatchObject({ type: "malformed" });
    if (message.type !== "malformed") throw new Error("expected malformed");
    expect(message.sample.length).toBe(200);
  });

  test("capabilities missing a strategy are malformed, not silently defaulted", () => {
    const { layerShell: _dropped, ...partial } = capabilities;
    expect(decode(line({ type: "capabilities", capabilities: partial }))).toMatchObject({
      type: "malformed",
    });
  });
});

describe("FrameReader", () => {
  test("reads two messages arriving in one chunk", () => {
    const reader = new FrameReader();
    const messages = reader.push(`${line({ type: "ok" })}\n${line({ type: "ok" })}\n`);
    expect(messages).toHaveLength(2);
    expect(reader.pending).toBe("");
  });

  test("holds a partial line until its newline arrives", () => {
    const reader = new FrameReader();
    expect(reader.push('{"v":1,"id":7,')).toEqual([]);
    expect(reader.push('"type":"ok","payload"')).toEqual([]);
    const messages = reader.push(":null}\n");
    expect(messages).toEqual([{ v: PROTOCOL_VERSION, id: 7, type: "ok", payload: null }]);
  });

  test("a trailing partial line is kept for the next push, not decoded", () => {
    const reader = new FrameReader();
    const messages = reader.push(`${line({ type: "ok" })}\n{"v":1,`);
    expect(messages).toHaveLength(1);
    expect(reader.pending).toBe('{"v":1,');
  });

  test("skips blank lines between messages", () => {
    const reader = new FrameReader();
    expect(reader.push(`\n\n${line({ type: "ok" })}\n\n`)).toHaveLength(1);
  });

  test("drops a line past the cap instead of buffering it forever", () => {
    const reader = new FrameReader(64);
    const messages = reader.push("x".repeat(100));
    expect(messages).toMatchObject([{ type: "malformed", reason: "line exceeded 64 bytes" }]);
    expect(reader.pending).toBe("");
  });

  test("an event between a request and its reply comes through in order", () => {
    const reader = new FrameReader();
    const chunk = [
      JSON.stringify({
        v: PROTOCOL_VERSION,
        id: EVENT_ID,
        type: "log",
        level: "info",
        message: "up",
      }),
      JSON.stringify({
        v: PROTOCOL_VERSION,
        id: EVENT_ID,
        type: "pointer",
        sample: { x: 1, y: 2 },
      }),
      line({ type: "ok", payload: null }),
    ].join("\n");

    const messages = reader.push(`${chunk}\n`);
    expect(messages.map((message) => message.type)).toEqual(["log", "pointer", "ok"]);
    expect(messages.map((message) => (message.type === "malformed" ? -1 : message.id))).toEqual([
      0, 0, 1,
    ]);
  });

  test("an escaped newline inside a message does not split the frame", () => {
    const reader = new FrameReader();
    const raw = JSON.stringify({
      v: PROTOCOL_VERSION,
      id: 0,
      type: "log",
      level: "warn",
      message: "one\ntwo",
    });
    const messages = reader.push(`${raw}\n`);
    expect(messages).toEqual([
      { v: PROTOCOL_VERSION, id: 0, type: "log", level: "warn", message: "one\ntwo" },
    ]);
  });

  test("a malformed line does not stop the messages after it", () => {
    const reader = new FrameReader();
    const messages = reader.push(`not json\n${line({ type: "ok" })}\n`);
    expect(messages.map((message) => message.type)).toEqual(["malformed", "ok"]);
  });

  test("reset drops a half-read line", () => {
    const reader = new FrameReader();
    reader.push('{"v":1,');
    reader.reset();
    expect(reader.pending).toBe("");
  });
});

describe("payload parsers", () => {
  test("reads a capture payload", () => {
    expect(
      parseCapturePayload({
        path: "/run/user/1000/shot.png",
        width: 3840,
        height: 2160,
        output: "DP-1",
        takenAt: 1_700_000_000,
        application: { appId: "blender", pid: 42 },
        layout: { x: 0, y: 0, width: 1920, height: 1080 },
        redacted: 2,
      }),
    ).toEqual({
      path: "/run/user/1000/shot.png",
      width: 3840,
      height: 2160,
      output: "DP-1",
      takenAt: 1_700_000_000,
      application: { appId: "blender", atspiName: null, desktopEntry: null, title: null, pid: 42 },
      layout: { x: 0, y: 0, width: 1920, height: 1080 },
      redacted: 2,
    });
  });

  test("a capture the compositor could not place reads as no layout, not as zero", () => {
    const payload = parseCapturePayload({ path: "/a.png", width: 10, height: 10 });
    expect(payload?.layout).toBeNull();
    expect(payload?.redacted).toBe(0);
  });

  test.each([
    ["no path", { width: 10, height: 10 }],
    ["empty path", { path: "", width: 10, height: 10 }],
    ["zero width", { path: "/a.png", width: 0, height: 10 }],
    ["negative height", { path: "/a.png", width: 10, height: -1 }],
    ["not an object", "nope"],
  ])("refuses a capture payload with %s", (_name, raw) => {
    expect(parseCapturePayload(raw)).toBeNull();
  });

  test("drops a malformed region rather than the whole tree", () => {
    const regions = parseDetectedRegions([
      {
        id: "a",
        rect: { x: 0, y: 0, width: 10, height: 10 },
        source: "atspi",
        confidence: 1,
        label: "OK",
      },
      { id: "b", rect: { x: 0, y: 0, width: 10, height: 10 }, source: "telepathy", confidence: 1 },
      { id: "", rect: { x: 0, y: 0, width: 10, height: 10 }, source: "pixel", confidence: 1 },
      { id: "c", rect: { x: 1, y: 2, width: 3 }, source: "pixel", confidence: 1 },
      {
        id: "d",
        rect: { x: 5, y: 5, width: 5, height: 5 },
        source: "pixel",
        confidence: 0.4,
        sensitive: true,
      },
    ]);

    expect(regions.map((region) => region.id)).toEqual(["a", "d"]);
    expect(regions[0]?.label).toBe("OK");
    expect(regions[1]?.sensitive).toBe(true);
  });

  test("a region with no confidence reads as zero rather than NaN", () => {
    const [region] = parseDetectedRegions([
      { id: "a", rect: { x: 0, y: 0, width: 1, height: 1 }, source: "pixel" },
    ]);
    expect(region?.confidence).toBe(0);
  });

  test("a non-array tree is empty, not a throw", () => {
    expect(parseDetectedRegions(null)).toEqual([]);
    expect(parseDetectedRegions({ regions: [] })).toEqual([]);
  });
});
