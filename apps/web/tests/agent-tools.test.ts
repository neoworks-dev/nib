import { describe, expect, test } from "bun:test";
import { z } from "zod";
import type {
  AgentReport,
  ListAgentsResult,
  ListHarnessesResult,
  PlaceOnCanvasResult,
  ReadAgentResult,
  ReadCanvasResult,
  SpawnAgentResult,
} from "@nib-ui/protocol";
import {
  type AgentToolServices,
  createAgentNotifier,
  createAgentTools,
  harnessCatalog,
  resolveModel,
} from "../src/lib/server/agent-tools";
import type { SessionHost } from "../src/lib/server/services";
import { FakeSessionHost, fakeHarnesses, message, piRuntimeModels } from "./fake-session-host";
import { FakeBoards, FakeVault, fakeVaultEntries } from "./fake-vault";

/** The slice of a tool's JSON schema these tests read. */
const jsonSchemaShape = z.object({
  properties: z.record(
    z.string(),
    z.object({ enum: z.array(z.string()).optional(), description: z.string().optional() }),
  ),
});

/** The services a test that never touches the board still has to hand over. */
function services(
  host: SessionHost,
  overrides: Partial<AgentToolServices> = {},
): AgentToolServices {
  return {
    host,
    harnesses: fakeHarnesses,
    boards: new FakeBoards("/repo"),
    vault: new FakeVault("/repo", fakeVaultEntries()),
    ...overrides,
  };
}

/**
 * Invoked the way both consumers do, from inside a promise: a handler that
 * rejects its input does so before its first await, and an `await` call site
 * turns that into a rejection while a bare call would let it throw.
 */
async function call(
  host: SessionHost,
  callerId: string,
  name: string,
  input: unknown,
  overrides: Partial<AgentToolServices> = {},
): Promise<unknown> {
  const catalog = await harnessCatalog(host, fakeHarnesses);
  const tool = createAgentTools(services(host, overrides), callerId, catalog).find(
    (candidate) => candidate.name === name,
  );
  if (!tool) throw new Error(`no tool "${name}"`);
  return tool.handler(input);
}

describe("createAgentTools", () => {
  test("exposes the agent tools and the canvas pair", async () => {
    const host = new FakeSessionHost();
    host.add("root");
    const catalog = await harnessCatalog(host, fakeHarnesses);
    expect(createAgentTools(services(host), "root", catalog).map((tool) => tool.name)).toEqual([
      "list_harnesses",
      "spawn_agent",
      "send_to_agent",
      "read_agent",
      "list_agents",
      "stop_agent",
      "read_canvas",
      "place_on_canvas",
    ]);
  });

  test("spawn's schema enumerates the harnesses and names every model", async () => {
    const host = new FakeSessionHost();
    host.add("root");
    const catalog = await harnessCatalog(host, fakeHarnesses);
    const spawn = createAgentTools(services(host), "root", catalog).find(
      (tool) => tool.name === "spawn_agent",
    );
    const { properties } = jsonSchemaShape.parse(spawn?.inputSchema.toJSONSchema());
    expect(properties.harness?.enum).toEqual(["claude-code", "pi"]);
    expect(properties.model?.description).toContain("claude-code: default, opus");
    expect(properties.model?.description).toContain("deepseek/deepseek-v4.1-flash");
  });

  test("list_harnesses answers from the runtime where it can, and the static list elsewhere", async () => {
    const host = new FakeSessionHost();
    host.add("root");
    const result = (await call(host, "root", "list_harnesses", {})) as ListHarnessesResult;
    expect(result.harnesses.map((harness) => harness.id)).toEqual(["claude-code", "pi"]);
    const [claude, pi] = result.harnesses;
    expect(claude?.models.map((model) => model.id)).toEqual(["default", "opus"]);
    expect(pi?.models).toEqual(piRuntimeModels);
    expect(pi?.effortLevels).toEqual(["low", "high"]);
    expect(pi?.defaultModel).toBe("default");
  });

  test("the catalog widens a static list with what a session of that harness reported", async () => {
    const host = new FakeSessionHost();
    host.add("root", {
      models: [
        { id: "opus", displayName: "Opus 5 · the strongest" },
        { id: "sonnet", displayName: "Sonnet 5" },
      ],
    });
    const [claude] = await harnessCatalog(host, fakeHarnesses);
    expect(claude?.models.map((model) => model.id)).toEqual(["default", "opus", "sonnet"]);
  });

  test("spawn records the caller as the parent and sends the prompt behind a preamble", async () => {
    const host = new FakeSessionHost();
    host.add("root", { title: "Ship the release" });

    const result = (await call(host, "root", "spawn_agent", {
      harness: "claude-code",
      prompt: "Audit the migration",
      model: "opus",
      label: "Auditor",
    })) as SpawnAgentResult;

    expect(result).toEqual({
      sessionId: "spawned-1",
      harness: "claude-code",
      model: "opus",
      title: "Auditor",
    });
    expect(host.created[0]).toMatchObject({
      harnessId: "claude-code",
      cwd: "/repo",
      label: "Auditor",
      parentSessionId: "root",
      options: { model: "opus" },
    });

    const sent = host.commands[0];
    expect(sent?.sessionId).toBe("spawned-1");
    if (sent?.command.type !== "session.send") throw new Error("the spawn sent no prompt");
    expect(sent.command.text).toContain("Ship the release");
    expect(sent.command.text).toContain("send_to_agent");
    expect(sent.command.text).toContain("notification");
    expect(sent.command.text.endsWith("Audit the migration")).toBe(true);
  });

  test("spawn resolves a model named in words to the one id it matches", async () => {
    const host = new FakeSessionHost();
    host.add("root");
    const result = (await call(host, "root", "spawn_agent", {
      harness: "pi",
      prompt: "Go",
      model: "deepseek v4.1 flash",
    })) as SpawnAgentResult;
    expect(result.model).toBe("deepseek/deepseek-v4.1-flash");
    expect(host.created[0]?.options).toEqual({ model: "deepseek/deepseek-v4.1-flash" });
  });

  test("spawn refuses a model name that fits several, naming them", async () => {
    const host = new FakeSessionHost();
    host.add("root");
    await expect(
      call(host, "root", "spawn_agent", { harness: "pi", prompt: "Go", model: "deepseek v4.1" }),
    ).rejects.toThrow(/deepseek\/deepseek-v4\.1, deepseek\/deepseek-v4\.1-flash/);
    expect(host.created).toHaveLength(0);
  });

  test("spawn passes only the options the caller named", async () => {
    const host = new FakeSessionHost();
    host.add("root");
    await call(host, "root", "spawn_agent", {
      harness: "claude-code",
      prompt: "Go",
      effort: "high",
    });
    expect(host.created[0]?.options).toEqual({ effort: "high" });
  });

  test("spawn falls back to the caller's working directory", async () => {
    const host = new FakeSessionHost();
    host.add("root", { cwd: "/elsewhere" });
    await call(host, "root", "spawn_agent", { harness: "claude-code", prompt: "Go" });
    expect(host.created[0]?.cwd).toBe("/elsewhere");
  });

  test("an unknown harness is a tool error, not a crash", async () => {
    const host = new FakeSessionHost();
    host.add("root");
    await expect(
      call(host, "root", "spawn_agent", { harness: "nope", prompt: "Go" }),
    ).rejects.toThrow();
    expect(host.created).toHaveLength(0);
  });

  test("a harness that fails to start is reported and the dead session removed", async () => {
    const host = new FakeSessionHost();
    host.add("root");
    host.failNextCreate = 'unknown pi model "x/y"';
    await expect(
      call(host, "root", "spawn_agent", { harness: "pi", prompt: "Go", model: "x/y" }),
    ).rejects.toThrow(/failed to start: unknown pi model "x\/y"/);
    expect(host.has("spawned-1")).toBe(false);
    expect(host.commands).toHaveLength(0);
  });

  test("input is validated against the tool's schema", async () => {
    const host = new FakeSessionHost();
    host.add("root");
    await expect(call(host, "root", "spawn_agent", { harness: "claude-code" })).rejects.toThrow();
  });

  test("read with wait resolves when the target leaves working, and unsubscribes", async () => {
    const host = new FakeSessionHost();
    host.add("root");
    const child = host.add("child", { parentSessionId: "root", status: "working" });
    host.views.set("child", { ...child, messages: [message("assistant", "all done")] });

    const pending = call(host, "root", "read_agent", { sessionId: "child", wait: true });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(host.subscriberCount("child")).toBe(1);

    host.status("child", "idle");
    const result = (await pending) as ReadAgentResult;

    expect(result.timedOut).toBe(false);
    expect(result.status).toBe("idle");
    expect(result.reply).toBe("all done");
    expect(host.subscriberCount("child")).toBe(0);
  });

  test("read without wait answers at once, mid-turn or not", async () => {
    const host = new FakeSessionHost();
    host.add("root");
    host.add("child", { parentSessionId: "root", status: "working" });

    const result = (await call(host, "root", "read_agent", {
      sessionId: "child",
    })) as ReadAgentResult;

    expect(result.status).toBe("working");
    expect(result.timedOut).toBe(false);
    expect(host.subscriberCount("child")).toBe(0);
  });

  test("read with wait reports the timeout and leaves the agent running", async () => {
    const host = new FakeSessionHost();
    host.add("root");
    host.add("child", { parentSessionId: "root", status: "working" });

    const result = (await call(host, "root", "read_agent", {
      sessionId: "child",
      wait: true,
      timeoutSeconds: 0.01,
    })) as ReadAgentResult;

    expect(result.timedOut).toBe(true);
    expect(result.status).toBe("working");
    expect(host.subscriberCount("child")).toBe(0);
  });

  test("a session outside the caller's family cannot be addressed", async () => {
    const host = new FakeSessionHost();
    host.add("root");
    host.add("child", { parentSessionId: "root" });
    host.add("stranger");

    await expect(
      call(host, "child", "send_to_agent", { sessionId: "stranger", text: "hi" }),
    ).rejects.toThrow(/not in your family/);
    await expect(call(host, "child", "read_agent", { sessionId: "stranger" })).rejects.toThrow(
      /not in your family/,
    );
    await expect(call(host, "child", "stop_agent", { sessionId: "stranger" })).rejects.toThrow(
      /not in your family/,
    );
    expect(host.commands).toHaveLength(0);
  });

  test("send delivers to a sibling and reports it queued", async () => {
    const host = new FakeSessionHost();
    host.add("root");
    host.add("one", { parentSessionId: "root" });
    host.add("two", { parentSessionId: "root" });

    const result = await call(host, "one", "send_to_agent", {
      sessionId: "two",
      text: "take the other half",
    });

    expect(result).toEqual({ sessionId: "two", delivered: true });
    expect(host.commands).toEqual([
      { sessionId: "two", command: { type: "session.send", text: "take the other half" } },
    ]);
  });

  test("list returns the parent and every other agent under the same root", async () => {
    const host = new FakeSessionHost();
    host.add("root", { title: "Root" });
    host.add("one", { parentSessionId: "root", title: "One" });
    host.add("two", { parentSessionId: "root", title: "Two" });
    host.add("grandchild", { parentSessionId: "two", title: "Grandchild" });
    host.add("stranger", { title: "Stranger" });

    const result = (await call(host, "one", "list_agents", {})) as ListAgentsResult;

    expect(result.self).toBe("one");
    expect(result.parent?.sessionId).toBe("root");
    expect(result.agents.map((agent) => agent.sessionId)).toEqual(["two", "grandchild"]);
  });

  test("list reports no parent for a session a person started", async () => {
    const host = new FakeSessionHost();
    host.add("root");
    host.add("child", { parentSessionId: "root" });

    const result = (await call(host, "root", "list_agents", {})) as ListAgentsResult;
    expect(result.parent).toBeNull();
    expect(result.agents.map((agent) => agent.sessionId)).toEqual(["child"]);
  });

  test("read returns the prompt and the newest reply", async () => {
    const host = new FakeSessionHost();
    host.add("root");
    const child = host.add("child", { parentSessionId: "root", model: "opus", title: "Child" });
    host.views.set("child", {
      ...child,
      messages: [message("user", "find the bug"), message("assistant", "it is in the reducer")],
    });

    const report = (await call(host, "root", "read_agent", {
      sessionId: "child",
    })) as ReadAgentResult;

    expect(report).toEqual({
      sessionId: "child",
      harness: "claude-code",
      model: "opus",
      title: "Child",
      parentSessionId: "root",
      status: "idle",
      statusDetail: null,
      prompt: "find the bug",
      reply: "it is in the reducer",
      timedOut: false,
    });
  });

  test("stop interrupts a working agent and then closes it", async () => {
    const host = new FakeSessionHost();
    host.add("root");
    host.add("child", { parentSessionId: "root", status: "working" });

    const report = (await call(host, "root", "stop_agent", { sessionId: "child" })) as AgentReport;

    expect(host.commands.map((entry) => entry.command.type)).toEqual([
      "session.interrupt",
      "session.close",
    ]);
    expect(report.status).toBe("closed");
  });

  test("stop does not interrupt an agent that is already between turns", async () => {
    const host = new FakeSessionHost();
    host.add("root");
    host.add("child", { parentSessionId: "root", status: "idle" });

    await call(host, "root", "stop_agent", { sessionId: "child" });
    expect(host.commands.map((entry) => entry.command.type)).toEqual(["session.close"]);
  });
});

describe("the canvas tools", () => {
  /** A root session over a vault of four items, with the board they sit on. */
  function canvas(): { host: FakeSessionHost; boards: FakeBoards; vault: FakeVault } {
    const host = new FakeSessionHost();
    host.add("root");
    return {
      host,
      boards: new FakeBoards("/repo"),
      vault: new FakeVault("/repo", fakeVaultEntries()),
    };
  }

  test("read_canvas reports the vault root's items, unplaced until something places them", async () => {
    const { host, boards, vault } = canvas();
    const result = (await call(
      host,
      "root",
      "read_canvas",
      {},
      { boards, vault },
    )) as ReadCanvasResult;

    expect(result.cwd).toBe("/repo");
    expect(result.directory).toBe("");
    expect(result.cards.map((card) => card.path)).toEqual(["notes.md", "plan.md", "topic"]);
    expect(result.cards.map((card) => card.rect)).toEqual([null, null, null]);
  });

  test("read_canvas reads one topic's own board", async () => {
    const { host, boards, vault } = canvas();
    const result = (await call(
      host,
      "root",
      "read_canvas",
      { directory: "topic" },
      { boards, vault },
    )) as ReadCanvasResult;

    expect(result.directory).toBe("topic");
    expect(result.cards.map((card) => card.path)).toEqual(["topic/deep.md"]);
  });

  test("place_on_canvas writes the whole arrangement as one revision", async () => {
    const { host, boards, vault } = canvas();
    const result = (await call(
      host,
      "root",
      "place_on_canvas",
      {
        items: [
          { path: "notes.md", x: 0, y: 0, w: 300, h: 200 },
          { path: "plan.md", x: 332, y: 0, w: 300, h: 200 },
          { path: "topic/deep.md", x: 40, y: 40 },
        ],
      },
      { boards, vault },
    )) as PlaceOnCanvasResult;

    expect(boards.doc.rev).toBe(1);
    expect(boards.doc.placements).toEqual({
      "": {
        "notes.md": { x: 0, y: 0, w: 300, h: 200, z: 1 },
        "plan.md": { x: 332, y: 0, w: 300, h: 200, z: 2 },
      },
      // A card lands on the board of its own directory, so a path inside a topic
      // never reaches the root's.
      topic: { "topic/deep.md": { x: 40, y: 40, w: 256, h: 300, z: 1 } },
    });
    expect(result.cards.map((card) => card.rect?.x)).toEqual([0, 332, 40]);
  });

  test("placing a card again moves it without resizing or restacking it", async () => {
    const { host, boards, vault } = canvas();
    await call(
      host,
      "root",
      "place_on_canvas",
      { items: [{ path: "notes.md", x: 0, y: 0, w: 300, h: 200 }] },
      { boards, vault },
    );
    boards.doc = {
      ...boards.doc,
      placements: { "": { "notes.md": { x: 0, y: 0, w: 300, h: 200, z: 1, stack: "pile" } } },
    };

    const result = (await call(
      host,
      "root",
      "place_on_canvas",
      { items: [{ path: "notes.md", x: 500, y: 120 }] },
      { boards, vault },
    )) as PlaceOnCanvasResult;

    expect(boards.doc.placements[""]?.["notes.md"]).toEqual({
      x: 500,
      y: 120,
      w: 300,
      h: 200,
      z: 1,
    });
    expect(result.cards[0]?.stack).toBeNull();
  });

  test("a path the vault does not have is a tool error, and nothing is written", async () => {
    const { host, boards, vault } = canvas();
    await expect(
      call(
        host,
        "root",
        "place_on_canvas",
        {
          items: [
            { path: "notes.md", x: 0, y: 0 },
            { path: "ghost.md", x: 10, y: 10 },
          ],
        },
        { boards, vault },
      ),
    ).rejects.toThrow(/ghost\.md/);
    expect(boards.doc.rev).toBe(0);
    expect(boards.doc.placements).toEqual({});
  });
});

describe("resolveModel", () => {
  test("an exact id wins even when words would match more", () => {
    expect(resolveModel(piRuntimeModels, "deepseek/deepseek-v4.1")).toBe("deepseek/deepseek-v4.1");
  });

  test("words match against the display name as well as the id", () => {
    expect(resolveModel(piRuntimeModels, "Opus 5")).toBe("anthropic/claude-opus-5");
    expect(resolveModel(piRuntimeModels, "claude opus")).toBe("anthropic/claude-opus-5");
  });

  test("a name the catalog does not know passes through for the harness to judge", () => {
    expect(resolveModel(piRuntimeModels, "mistral/devstral")).toBe("mistral/devstral");
  });
});

/** Runs the notifier off the fake host's own status transitions. */
function notifying(host: FakeSessionHost, sessionId: string): void {
  const notify = createAgentNotifier(host);
  host.subscribe(sessionId, (event) => notify(sessionId, event));
}

describe("createAgentNotifier", () => {
  test("delivers a spawned agent's report to its spawner when a turn ends", () => {
    const host = new FakeSessionHost();
    host.add("root");
    const child = host.add("child", { parentSessionId: "root", title: "Auditor", harnessId: "pi" });
    host.views.set("child", { ...child, messages: [message("assistant", "no bugs found")] });
    notifying(host, "child");

    host.status("child", "working");
    expect(host.commands).toHaveLength(0);
    host.status("child", "idle");

    const [delivered] = host.commands;
    expect(delivered?.sessionId).toBe("root");
    if (delivered?.command.type !== "session.send") throw new Error("nothing was sent");
    expect(delivered.command.text).toBe(
      [
        "<agent-notification>",
        "<sessionId>child</sessionId>",
        "<harness>pi</harness>",
        "<title>Auditor</title>",
        "<status>idle</status>",
        "<result>",
        "no bugs found",
        "</result>",
        "</agent-notification>",
      ].join("\n"),
    );
  });

  test("a failed turn is delivered with its detail", () => {
    const host = new FakeSessionHost();
    host.add("root");
    host.add("child", { parentSessionId: "root", statusDetail: "rate limited" });
    notifying(host, "child");

    host.status("child", "working");
    host.status("child", "error");

    const [delivered] = host.commands;
    if (delivered?.command.type !== "session.send") throw new Error("nothing was sent");
    expect(delivered.command.text).toContain("<status>error</status>");
    expect(delivered.command.text).toContain("<detail>rate limited</detail>");
  });

  test("going idle without having worked is not an answer", () => {
    const host = new FakeSessionHost();
    host.add("root");
    host.add("child", { parentSessionId: "root" });
    notifying(host, "child");

    host.status("child", "idle");
    host.status("child", "closed");
    expect(host.commands).toHaveLength(0);
  });

  test("closing mid-turn is not an answer either", () => {
    const host = new FakeSessionHost();
    host.add("root");
    host.add("child", { parentSessionId: "root" });
    notifying(host, "child");

    host.status("child", "working");
    host.status("child", "closed");
    expect(host.commands).toHaveLength(0);
  });

  test("a spawner whose harness is gone takes no delivery", () => {
    const host = new FakeSessionHost();
    host.add("root");
    host.add("child", { parentSessionId: "root" });
    host.detached.add("root");
    notifying(host, "child");

    host.status("child", "working");
    host.status("child", "idle");
    expect(host.commands).toHaveLength(0);
  });

  test("a session a person started notifies nobody", () => {
    const host = new FakeSessionHost();
    host.add("root");
    notifying(host, "root");

    host.status("root", "working");
    host.status("root", "idle");
    expect(host.commands).toHaveLength(0);
  });
});
