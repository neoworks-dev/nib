import { describe, expect, test } from "bun:test";
import type { CanvasObject, CanvasObjectKind } from "@nib-ui/ui-contracts";
import { activateObject, byOrder, type Claimable, dispatch } from "../src/dispatch";

type Payload = { text: string };

function handler(
  log: string[],
  id: string,
  claims: boolean,
  order?: number,
): Claimable<Payload, number> {
  return {
    ...(order !== undefined && { order }),
    handle(payload) {
      log.push(`${id}:${payload.text}`);
      return claims;
    },
  };
}

describe("byOrder", () => {
  test("an unordered contribution sits at zero, not at the end", () => {
    const entries = [{ order: 5, id: "late" }, { id: "default" }, { order: -1, id: "early" }];

    expect(byOrder(entries).map((entry) => entry.id)).toEqual(["early", "default", "late"]);
  });
});

describe("dispatch", () => {
  test("runs handlers in order and stops at the first claim", async () => {
    const log: string[] = [];
    const handlers = new Set([
      handler(log, "generic", true, 10),
      handler(log, "specific", true, -5),
      handler(log, "never", true, 20),
    ]);

    expect(await dispatch(handlers, { text: "x" }, 0)).toBe(true);
    expect(log).toEqual(["specific:x"]);
  });

  test("a handler that passes lets the next one see the payload", async () => {
    const log: string[] = [];
    const handlers = new Set([handler(log, "first", false, 0), handler(log, "second", true, 1)]);

    expect(await dispatch(handlers, { text: "x" }, 0)).toBe(true);
    expect(log).toEqual(["first:x", "second:x"]);
  });

  test("nothing claiming the payload leaves it to the browser", async () => {
    const log: string[] = [];
    expect(await dispatch(new Set([handler(log, "only", false)]), { text: "x" }, 0)).toBe(false);
  });

  test("a handler removed from the set stops receiving payloads", async () => {
    const log: string[] = [];
    const disposed = handler(log, "disposed", true);
    const handlers = new Set([disposed, handler(log, "kept", true, 1)]);
    handlers.delete(disposed);

    await dispatch(handlers, { text: "x" }, 0);
    expect(log).toEqual(["kept:x"]);
  });

  test("an async handler is awaited before the next one is offered the payload", async () => {
    const log: string[] = [];
    const handlers: Claimable<Payload, number>[] = [
      {
        order: 0,
        async handle() {
          await Promise.resolve();
          log.push("slow");
          return false;
        },
      },
      handler(log, "fast", true, 1),
    ];

    await dispatch(handlers, { text: "x" }, 0);
    expect(log).toEqual(["slow", "fast:x"]);
  });
});

describe("activateObject", () => {
  const model: CanvasObject = { kind: "model", id: "model:1", assetId: "a.obj" };

  function kind(overrides: Partial<CanvasObjectKind> = {}): CanvasObjectKind {
    return {
      kind: "model",
      parse: (raw) => raw as CanvasObject,
      createRenderer: () => {
        throw new Error("not rendered in this test");
      },
      ...overrides,
    };
  }

  test("a double-click opens the object through the kind that owns it", () => {
    const opened: string[] = [];
    const fallback: string[] = [];

    activateObject(
      kind({ activate: (object) => opened.push(object.id) }),
      model,
      (object) => fallback.push(object.id),
      "doubleClick",
    );

    expect(opened).toEqual(["model:1"]);
    expect(fallback).toEqual([]);
  });

  test("both gestures reach the kind that owns the object", () => {
    const seen: string[] = [];
    const withGesture = kind({ activate: (_object, gesture) => seen.push(gesture) });

    activateObject(withGesture, model, null, "click");
    activateObject(withGesture, model, null, "doubleClick");

    expect(seen).toEqual(["click", "doubleClick"]);
  });

  test("a kind that answers clicks keeps the board's handler out of it", () => {
    const fallback: string[] = [];

    activateObject(
      kind({ activate: () => undefined }),
      model,
      (object) => fallback.push(object.id),
      "click",
    );

    expect(fallback).toEqual([]);
  });

  test("the kind is handed its own parsed object rather than the stored one", () => {
    const seen: CanvasObject[] = [];
    const parsed: CanvasObject = { kind: "model", id: "model:1", assetId: "a.obj", distance: 2.9 };

    activateObject(
      kind({ parse: () => parsed, activate: (object) => seen.push(object) }),
      model,
      null,
      "doubleClick",
    );

    expect(seen).toEqual([parsed]);
  });

  test("a kind without an activate hook leaves both gestures to the board", () => {
    const fallback: string[] = [];

    activateObject(kind(), model, (object) => fallback.push(object.id), "click");
    activateObject(kind(), model, (object) => fallback.push(object.id), "doubleClick");

    expect(fallback).toEqual(["model:1", "model:1"]);
  });

  test("an object whose kind no plugin claims still reaches the board", () => {
    const fallback: string[] = [];

    activateObject(undefined, model, (object) => fallback.push(object.id), "click");

    expect(fallback).toEqual(["model:1"]);
  });

  test("an object its own kind refuses to parse falls back rather than opening nothing", () => {
    const opened: string[] = [];
    const fallback: string[] = [];

    activateObject(
      kind({ parse: () => null, activate: (object) => opened.push(object.id) }),
      model,
      (object) => fallback.push(object.id),
      "doubleClick",
    );

    expect(opened).toEqual([]);
    expect(fallback).toEqual(["model:1"]);
  });
});
