import { describe, expect, test } from "bun:test";
import { type Context, createContext, type Disposer, type Plugin } from "@nib-ui/kernel";

interface Counter {
  value: number;
}

declare module "@nib-ui/kernel" {
  interface Services {
    counter: Counter;
    logger: { lines: string[] };
  }
  interface Events {
    ping(payload: string): void;
  }
}

const counterProvider: Plugin = {
  name: "counter-provider",
  apply(ctx) {
    ctx.provide("counter", { value: 1 });
  },
};

describe("activation gating", () => {
  test("a plugin waits for its injected services regardless of registration order", () => {
    const ctx = createContext();
    const order: string[] = [];

    const consumer: Plugin = {
      name: "consumer",
      inject: ["counter"],
      apply(inner) {
        order.push(`consumer:${inner.require("counter").value}`);
      },
    };

    const handle = ctx.use(consumer);
    expect(handle.active).toBe(false);
    expect(order).toEqual([]);

    ctx.use(counterProvider);
    expect(handle.active).toBe(true);
    expect(order).toEqual(["consumer:1"]);
  });

  test("removing a service deactivates dependents and re-providing reactivates them", () => {
    const ctx = createContext();
    const events: string[] = [];

    const consumer: Plugin = {
      name: "consumer",
      inject: ["counter"],
      apply(inner) {
        events.push("apply");
        inner.effect(() => () => events.push("cleanup"));
      },
    };

    const handle = ctx.use(consumer);
    const providerHandle = ctx.use(counterProvider);
    expect(events).toEqual(["apply"]);

    providerHandle.dispose();
    expect(handle.active).toBe(false);
    expect(events).toEqual(["apply", "cleanup"]);

    ctx.use(counterProvider);
    expect(handle.active).toBe(true);
    expect(events).toEqual(["apply", "cleanup", "apply"]);
  });

  test("a chain of injections settles in dependency order", () => {
    const ctx = createContext();
    const order: string[] = [];

    const middle: Plugin = {
      name: "middle",
      inject: ["counter"],
      apply(inner) {
        order.push("middle");
        inner.provide("logger", { lines: [] });
      },
    };
    const leaf: Plugin = {
      name: "leaf",
      inject: ["logger"],
      apply() {
        order.push("leaf");
      },
    };

    ctx.use(leaf);
    ctx.use(middle);
    expect(order).toEqual([]);

    ctx.use(counterProvider);
    expect(order).toEqual(["middle", "leaf"]);
  });

  test("disposing the service owner cascades through the whole dependency chain", () => {
    const ctx = createContext();
    const middle: Plugin = {
      name: "middle",
      inject: ["counter"],
      apply(inner) {
        inner.provide("logger", { lines: [] });
      },
    };
    let leafActive = false;
    const leaf: Plugin = {
      name: "leaf",
      inject: ["logger"],
      apply(inner) {
        leafActive = true;
        inner.effect(() => () => {
          leafActive = false;
        });
      },
    };

    ctx.use(leaf);
    ctx.use(middle);
    const providerHandle = ctx.use(counterProvider);
    expect(leafActive).toBe(true);

    providerHandle.dispose();
    expect(leafActive).toBe(false);
    expect(ctx.get("logger")).toBeUndefined();
  });
});

describe("dispose", () => {
  test("effects, listeners and child scopes roll back in reverse registration order", () => {
    const ctx = createContext();
    const order: string[] = [];

    const child: Plugin = {
      name: "child",
      apply(inner) {
        inner.effect(() => () => order.push("child-effect"));
      },
    };

    const parent: Plugin = {
      name: "parent",
      apply(inner) {
        inner.effect(() => () => order.push("first"));
        inner.use(child);
        inner.on("ping", () => order.push("listener-called"));
        inner.effect(() => () => order.push("last"));
      },
    };

    const handle = ctx.use(parent);
    ctx.emit("ping", "hello");
    expect(order).toEqual(["listener-called"]);

    order.length = 0;
    handle.dispose();
    expect(order).toEqual(["last", "child-effect", "first"]);

    ctx.emit("ping", "hello");
    expect(order).toEqual(["last", "child-effect", "first"]);
  });

  test("services provided by a disposed scope disappear", () => {
    const ctx = createContext();
    const handle = ctx.use(counterProvider);
    expect(ctx.get("counter")).toEqual({ value: 1 });
    handle.dispose();
    expect(ctx.get("counter")).toBeUndefined();
  });

  test("registering on an already disposed scope runs the disposer immediately", () => {
    const ctx = createContext();
    let disposed = false;
    let captured: Context | undefined;

    const handle = ctx.use({
      name: "capture",
      apply(inner) {
        captured = inner;
      },
    });
    handle.dispose();

    captured!.effect(() => () => {
      disposed = true;
    });
    expect(disposed).toBe(true);
  });
});

describe("reload", () => {
  test("reload re-runs apply with a new config and disposes the previous scope", () => {
    const ctx = createContext();
    const applied: string[] = [];
    const cleaned: string[] = [];

    const configurable: Plugin<{ label: string }> = {
      name: "configurable",
      apply(inner, config) {
        applied.push(config.label);
        inner.effect(() => () => cleaned.push(config.label));
      },
    };

    const handle = ctx.use(configurable, { label: "a" });
    expect(applied).toEqual(["a"]);

    handle.reload({ label: "b" });
    expect(cleaned).toEqual(["a"]);
    expect(applied).toEqual(["a", "b"]);
    expect(handle.active).toBe(true);

    handle.reload();
    expect(applied).toEqual(["a", "b", "b"]);
    expect(cleaned).toEqual(["a", "b"]);
  });

  test("reload of a gated plugin stays inactive while the service is missing", () => {
    const ctx = createContext();
    const handle = ctx.use({ name: "gated", inject: ["counter"], apply() {} });
    handle.reload();
    expect(handle.active).toBe(false);
  });
});

describe("async plugins", () => {
  test("ready resolves after an async apply and registrations still unwind", async () => {
    const ctx = createContext();
    let cleanedUp = false;

    const handle = ctx.use({
      name: "async",
      async apply(inner) {
        await Promise.resolve();
        inner.provide("counter", { value: 42 });
        inner.effect(() => () => {
          cleanedUp = true;
        });
      },
    });

    expect(ctx.get("counter")).toBeUndefined();
    await handle.ready;
    expect(ctx.get("counter")).toEqual({ value: 42 });

    handle.dispose();
    expect(cleanedUp).toBe(true);
    expect(ctx.get("counter")).toBeUndefined();
  });
});

describe("services and events", () => {
  test("providing the same service twice throws", () => {
    const ctx = createContext();
    ctx.use(counterProvider);
    expect(() => ctx.provide("counter", { value: 2 })).toThrow(
      'service "counter" is already provided',
    );
  });

  test("require throws for a missing service", () => {
    const ctx = createContext();
    expect(() => ctx.require("counter")).toThrow('service "counter" is not available');
  });

  test("service registrations emit internal/service", () => {
    const ctx = createContext();
    const seen: Array<[string, unknown]> = [];
    ctx.on("internal/service", (name, value) => seen.push([name, value]));

    const handle = ctx.use(counterProvider);
    handle.dispose();
    expect(seen).toEqual([
      ["counter", { value: 1 }],
      ["counter", undefined],
    ]);
  });

  test("a plugin cannot require a service it did not declare", () => {
    const ctx = createContext();
    ctx.use(counterProvider);
    let error: unknown;

    ctx.use({
      name: "undeclared",
      apply(inner) {
        try {
          inner.require("counter");
        } catch (thrown) {
          error = thrown;
        }
      },
    });

    expect((error as Error).message).toBe(
      `service "counter" is not declared in this plugin's inject`,
    );
  });

  test("get stays permissive where require refuses", () => {
    const ctx = createContext();
    ctx.use(counterProvider);
    let seen: unknown;

    ctx.use({
      name: "undeclared-get",
      apply(inner) {
        seen = inner.get("counter");
      },
    });

    expect(seen).toEqual({ value: 1 });
  });

  test("a plugin reads what a plugin above it declared", () => {
    const ctx = createContext();
    ctx.use(counterProvider);
    let seen: unknown;

    ctx.use({
      name: "parent",
      inject: ["counter"],
      apply(inner) {
        inner.use({
          name: "child",
          apply(grandchild) {
            seen = grandchild.require("counter");
          },
        });
      },
    });

    expect(seen).toEqual({ value: 1 });
  });

  test("a declared service stays readable while the withdrawal that unloaded the plugin unwinds", () => {
    const ctx = createContext();
    let withdraw: Disposer | undefined;
    ctx.use({
      name: "provider",
      apply(inner) {
        withdraw = inner.provide("counter", { value: 1 });
      },
    });

    let readDuringTeardown: unknown;
    ctx.use({
      name: "consumer",
      inject: ["counter"],
      apply(inner) {
        inner.effect(() => () => {
          readDuringTeardown = inner.require("counter");
        });
      },
    });

    withdraw!();
    expect(readDuringTeardown).toEqual({ value: 1 });
  });

  test("a listener disposer returned to the plugin removes it early", () => {
    const ctx = createContext();
    let calls = 0;
    let remove: Disposer | undefined;

    ctx.use({
      name: "listener",
      apply(inner) {
        remove = inner.on("ping", () => {
          calls += 1;
        });
      },
    });

    ctx.emit("ping", "x");
    remove!();
    ctx.emit("ping", "x");
    expect(calls).toBe(1);
  });
});
