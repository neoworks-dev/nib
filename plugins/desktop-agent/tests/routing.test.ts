import { describe, expect, test } from "bun:test";
import type { ApplicationIdentity } from "@nib-ui/ui-contracts";
import {
  emptyRoutingConfig,
  mergeRoutingConfig,
  parseRoutingConfig,
  type RoutingConfig,
  type RoutingRule,
  resolveRouting,
} from "../src/routing";

function identity(partial: Partial<ApplicationIdentity> = {}): ApplicationIdentity {
  return { appId: null, atspiName: null, desktopEntry: null, title: null, pid: null, ...partial };
}

function config(applications: RoutingRule[], fallback = emptyRoutingConfig.default): RoutingConfig {
  return { version: 1, default: fallback, applications };
}

describe("resolveRouting precedence", () => {
  const rules: RoutingRule[] = [
    { match: { atspiName: "blend" }, policy: "allow", harnessId: "atspi-substring" },
    { match: { atspiName: "Blender" }, policy: "allow", harnessId: "atspi-exact" },
    { match: { appId: "org.blender." }, policy: "allow", harnessId: "appid-prefix" },
    { match: { appId: "org.blender.Blender" }, policy: "allow", harnessId: "appid-exact" },
    { match: { desktopEntry: "blender.desktop" }, policy: "allow", harnessId: "desktop-entry" },
  ];
  const full = identity({
    appId: "org.blender.Blender",
    atspiName: "Blender",
    desktopEntry: "blender.desktop",
  });

  test("desktopEntry outranks everything, wherever it sits in the list", () => {
    const decision = resolveRouting(full, config(rules));
    expect(decision.matchedBy).toBe("desktopEntry");
    expect(decision.harnessId).toBe("desktop-entry");
  });

  test.each([
    ["appId exact", ["desktopEntry"], "appId", "appid-exact"],
    ["appId prefix", ["desktopEntry", "appId"], "appIdPrefix", "appid-prefix"],
    ["atspi exact", ["desktopEntry", "appId", "appIdPrefix"], "atspiName", "atspi-exact"],
    [
      "atspi substring",
      ["desktopEntry", "appId", "appIdPrefix", "atspiName"],
      "atspiSubstring",
      "atspi-substring",
    ],
  ])("falls to %s once the levels above it are gone", (_name, removed, level, harnessId) => {
    const remaining = rules.filter((rule) => {
      if (removed.includes("desktopEntry") && rule.match.desktopEntry) return false;
      if (removed.includes("appId") && rule.match.appId && !rule.match.appId.endsWith("."))
        return false;
      if (removed.includes("appIdPrefix") && rule.match.appId?.endsWith(".")) return false;
      if (removed.includes("atspiName") && rule.match.atspiName === "Blender") return false;
      return true;
    });
    const decision = resolveRouting(full, config(remaining));
    expect(decision.matchedBy).toBe(level as never);
    expect(decision.harnessId).toBe(harnessId);
  });

  test("a wildcard is the last rule tried, ahead of the default", () => {
    const decision = resolveRouting(
      identity({ appId: "unknown.app" }),
      config([{ match: { appId: "*" }, policy: "ask", harnessId: "catch-all" }]),
    );
    expect(decision.matchedBy).toBe("wildcard");
    expect(decision.harnessId).toBe("catch-all");
  });

  test("list order breaks a tie between two rules at the same level", () => {
    const decision = resolveRouting(
      identity({ appId: "a" }),
      config([
        { match: { appId: "a" }, policy: "allow", harnessId: "first" },
        { match: { appId: "a" }, policy: "allow", harnessId: "second" },
      ]),
    );
    expect(decision.harnessId).toBe("first");
  });

  test("a prefix rule needs the trailing dot; a bare prefix does not match", () => {
    const decision = resolveRouting(
      identity({ appId: "org.mozilla.firefox" }),
      config([{ match: { appId: "org.mozilla" }, policy: "allow" }]),
    );
    expect(decision.matchedBy).toBeNull();
  });

  test("atspi matching is case-insensitive both ways", () => {
    const decision = resolveRouting(
      identity({ atspiName: "BLENDER" }),
      config([{ match: { atspiName: "blender" }, policy: "allow", harnessId: "x" }]),
    );
    expect(decision.matchedBy).toBe("atspiName");
  });
});

describe("resolveRouting deny", () => {
  test("a loose deny outranks a more specific allow", () => {
    const decision = resolveRouting(
      identity({ appId: "org.keepassxc.KeePassXC", desktopEntry: "keepassxc.desktop" }),
      config([
        { match: { desktopEntry: "keepassxc.desktop" }, policy: "allow", harnessId: "nope" },
        { match: { appId: "org.keepassxc." }, policy: "deny" },
      ]),
    );
    expect(decision.policy).toBe("deny");
  });

  test("a deny wins even when it is the last rule in the list", () => {
    const decision = resolveRouting(
      identity({ appId: "a" }),
      config([
        { match: { appId: "a" }, policy: "allow" },
        { match: { appId: "*" }, policy: "deny" },
      ]),
    );
    expect(decision.policy).toBe("deny");
  });
});

describe("resolveRouting fallbacks", () => {
  test("an unknown application gets the default and asks", () => {
    const decision = resolveRouting(identity({ appId: "unknown" }), emptyRoutingConfig);
    expect(decision).toMatchObject({
      policy: "ask",
      harnessId: null,
      matchedBy: null,
      rule: null,
      options: {},
    });
  });

  test("an identity with nothing in it matches nothing", () => {
    const decision = resolveRouting(
      identity(),
      config([{ match: { appId: "a" }, policy: "allow" }]),
    );
    expect(decision.matchedBy).toBeNull();
  });

  test("a null identity falls back without throwing", () => {
    expect(
      resolveRouting(null, config([{ match: { appId: "*" }, policy: "allow" }])).matchedBy,
    ).toBeNull();
  });

  test("a rule with no harness of its own inherits the default harness", () => {
    const decision = resolveRouting(
      identity({ appId: "a" }),
      config([{ match: { appId: "a" }, policy: "allow" }], {
        policy: "ask",
        harnessId: "claude-code",
      }),
    );
    expect(decision.harnessId).toBe("claude-code");
  });

  test("carries the adapter options and the prefix through unchanged", () => {
    const options = { mcpServers: { blender: { command: "blender-mcp" } } };
    const decision = resolveRouting(
      identity({ appId: "blender" }),
      config([
        {
          match: { appId: "blender" },
          policy: "allow",
          promptPrefix: "Help in Blender.",
          options,
          skill: "modelling",
        },
      ]),
    );
    expect(decision.options).toEqual(options);
    expect(decision.promptPrefix).toBe("Help in Blender.");
    expect(decision.skill).toBe("modelling");
  });
});

describe("parseRoutingConfig", () => {
  test("reads a full config", () => {
    const parsed = parseRoutingConfig({
      version: 1,
      default: { policy: "allow", harnessId: "claude-code" },
      applications: [{ match: { appId: "blender" }, policy: "allow", model: "claude-opus-5" }],
    });
    expect(parsed.default).toEqual({ policy: "allow", harnessId: "claude-code" });
    expect(parsed.applications).toHaveLength(1);
    expect(parsed.applications[0]?.model).toBe("claude-opus-5");
  });

  test.each([
    ["null", null],
    ["a string", "nope"],
    ["an array", []],
  ])("falls back to the empty config for %s", (_name, raw) => {
    expect(parseRoutingConfig(raw)).toEqual(emptyRoutingConfig);
  });

  test("an unknown policy reads as ask rather than as allow", () => {
    const parsed = parseRoutingConfig({
      applications: [{ match: { appId: "a" }, policy: "always" }],
    });
    expect(parsed.applications[0]?.policy).toBe("ask");
    expect(parsed.default.policy).toBe("ask");
  });

  test("drops a rule that matches on nothing, which would otherwise match everything", () => {
    const parsed = parseRoutingConfig({
      applications: [
        { match: {}, policy: "allow" },
        { match: { appId: "" }, policy: "allow" },
        { match: { appid: "typo" }, policy: "allow" },
        { policy: "allow" },
        "not an object",
        { match: { appId: "kept" }, policy: "allow" },
      ],
    });
    expect(parsed.applications).toHaveLength(1);
    expect(parsed.applications[0]?.match.appId).toBe("kept");
  });

  test("an options field that is not an object is dropped, not coerced", () => {
    const parsed = parseRoutingConfig({
      applications: [{ match: { appId: "a" }, policy: "allow", options: ["x"] }],
    });
    expect(parsed.applications[0]?.options).toBeUndefined();
  });

  test("applications that is not an array reads as no rules", () => {
    expect(parseRoutingConfig({ applications: "all of them" }).applications).toEqual([]);
  });
});

describe("mergeRoutingConfig", () => {
  test("keeps a key a newer build wrote", () => {
    const merged = mergeRoutingConfig({ futureField: 42 }, emptyRoutingConfig);
    expect(merged.futureField).toBe(42);
    expect(merged.version).toBe(1);
  });

  test("replaces the rules wholesale rather than merging them", () => {
    const next = config([{ match: { appId: "b" }, policy: "allow" }]);
    const merged = mergeRoutingConfig(
      { applications: [{ match: { appId: "a" }, policy: "deny" }] },
      next,
    );
    expect(merged.applications).toEqual(next.applications);
  });

  test("a non-object existing file is replaced rather than spread", () => {
    expect(mergeRoutingConfig("corrupt", emptyRoutingConfig)).toEqual({
      version: 1,
      default: emptyRoutingConfig.default,
      applications: [],
    });
  });
});
