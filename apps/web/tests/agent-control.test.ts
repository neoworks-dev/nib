import { afterEach, describe, expect, test } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { SessionInit } from "@neoworks/harness";
import type { Context, ForkHandle } from "@nib-ui/kernel";
import { createContext } from "@nib-ui/kernel";
import {
  type AgentControlLink,
  agentControlInstructions,
  type AgentReport,
  type AgentToolName,
  type CreateSessionOptions,
} from "@nib-ui/protocol";
import { sharedHarnessSpecs } from "../src/lib/server/harness/harnesses";
import { PendingAnswers, sessionInit } from "../src/lib/server/harness/session";
import { agentControlPlugin } from "../src/lib/server/plugins/agent-control";
import { FakeSessionHost, fakeHarnesses, message } from "./fake-session-host";
import { FakeBoards, FakeVault, fakeVaultEntries } from "./fake-vault";

const toolNames: AgentToolName[] = [
  "list_harnesses",
  "spawn_agent",
  "send_to_agent",
  "read_agent",
  "list_agents",
  "stop_agent",
  "read_canvas",
  "place_on_canvas",
];

/** Every agent tool answers with one JSON text block, whichever way it was called. */
function parseResult<T>(content: unknown): T {
  const [block] = content as { type: string; text: string }[];
  if (!block) throw new Error("the tool answered with no content");
  return JSON.parse(block.text);
}

let mounted: ForkHandle | null = null;
let connected: Client | null = null;

afterEach(async () => {
  await connected?.close();
  connected = null;
  mounted?.dispose();
  mounted = null;
});

/** Mounts the plugin over a fake host and hands back the link for `root`. */
async function mount(): Promise<{
  host: FakeSessionHost;
  link: AgentControlLink;
  ctx: Context;
}> {
  const host = new FakeSessionHost();
  host.add("root", { title: "Root" });
  const child = host.add("child", { parentSessionId: "root", title: "Child", model: "opus" });
  host.views.set("child", {
    ...child,
    messages: [message("user", "find the bug"), message("assistant", "it is in the reducer")],
  });

  const ctx = createContext();
  ctx.provide("sessionHost", host);
  ctx.provide("harnesses", fakeHarnesses);
  ctx.provide("boards", new FakeBoards("/repo"));
  ctx.provide("vault", new FakeVault("/repo", fakeVaultEntries()));
  mounted = ctx.use(agentControlPlugin);
  await mounted.ready;

  const service = ctx.get("agentControl");
  if (!service) throw new Error("the plugin provided no agentControl service");
  return { host, link: await service.linkFor("root"), ctx };
}

async function connect(url: string): Promise<Client> {
  const client = new Client({ name: "agent-control-test", version: "1.0.0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(url)));
  connected = client;
  return client;
}

describe("agentControlPlugin", () => {
  test("hands every session a loopback url and the same tools in process", async () => {
    const { link } = await mount();
    expect(link.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/mcp\/root\/[0-9a-f]{32}$/);
    expect(link.tools.map((tool) => tool.name)).toEqual(toolNames);
  });

  test("serves every tool over MCP", async () => {
    const { link } = await mount();
    const client = await connect(link.url);

    const { tools } = await client.listTools();
    expect(tools.map((tool) => tool.name).sort()).toEqual([...toolNames].sort());

    const spawn = tools.find((tool) => tool.name === "spawn_agent");
    expect(spawn?.description).toContain("does NOT wait");
    expect(spawn?.inputSchema.properties).toMatchObject({
      harness: { enum: ["claude-code", "pi"] },
    });
    expect(spawn?.inputSchema.required).toContain("prompt");
  });

  test("a spawned agent's turn end reaches the spawner as a message", async () => {
    const { host, ctx } = await mount();
    host.status("child", "working");
    ctx.emit("session/event", "child", {
      id: "e-working",
      sessionId: "child",
      seq: 1,
      ts: 1,
      type: "session.status",
      data: { status: "working" },
    });
    host.status("child", "idle");
    ctx.emit("session/event", "child", {
      id: "e-idle",
      sessionId: "child",
      seq: 2,
      ts: 2,
      type: "session.status",
      data: { status: "idle" },
    });

    const [delivered] = host.commands;
    expect(delivered?.sessionId).toBe("root");
    if (delivered?.command.type !== "session.send") throw new Error("nothing was sent");
    expect(delivered.command.text).toContain("<sessionId>child</sessionId>");
    expect(delivered.command.text).toContain("it is in the reducer");
  });

  test("calls a tool as the session the url names", async () => {
    const { link } = await mount();
    const client = await connect(link.url);

    const result = await client.callTool({ name: "read_agent", arguments: { sessionId: "child" } });

    expect(parseResult<AgentReport>(result.content)).toMatchObject({
      sessionId: "child",
      harness: "claude-code",
      model: "opus",
      parentSessionId: "root",
      prompt: "find the bug",
      reply: "it is in the reducer",
    });
  });

  test("reports a tool failure instead of dropping the connection", async () => {
    const { link } = await mount();
    const client = await connect(link.url);

    const result = await client.callTool({
      name: "read_agent",
      arguments: { sessionId: "nobody" },
    });
    expect(result.isError).toBe(true);

    // The connection still works afterwards.
    const listed = await client.listTools();
    expect(listed.tools).toHaveLength(toolNames.length);
  });

  test("rejects a url whose secret is wrong", async () => {
    const { link } = await mount();
    const wrong = link.url.replace(/[0-9a-f]{32}$/, "0".repeat(32));
    const client = new Client({ name: "agent-control-test", version: "1.0.0" });
    await expect(
      client.connect(new StreamableHTTPClientTransport(new URL(wrong))),
    ).rejects.toThrow();
  });

  test("unloading the plugin closes the listener", async () => {
    const { link } = await mount();
    await connect(link.url);
    await connected?.close();
    connected = null;
    mounted?.dispose();
    mounted = null;

    await expect(fetch(link.url, { method: "GET" })).rejects.toThrow();
  });
});

const link: AgentControlLink = { url: "http://127.0.0.1:4242/mcp/s1/secret", tools: [] };

/** The prompt a session replaces its harness's own with. */
function readPrompt(init: SessionInit): string {
  const prompt = init.options?.systemPrompt?.replace;
  if (prompt === undefined) throw new Error("the session does not replace the system prompt");
  return prompt;
}

/** The session setup for one harness, with answers nobody gives. */
function initFor(harnessId: string, opts: CreateSessionOptions): SessionInit {
  const spec = sharedHarnessSpecs.find((candidate) => candidate.id === harnessId);
  if (!spec) throw new Error(`no harness "${harnessId}"`);
  return sessionInit(spec, opts, new PendingAnswers(() => {}));
}

describe("shared harness sessions", () => {
  test("every harness gets the nib server and is told to use it", () => {
    for (const harnessId of ["claude-code", "codex", "pi"]) {
      const init = initFor(harnessId, { cwd: "/repo", agentControl: link });
      expect(init.mcpServers).toEqual([
        { type: "http", name: "nib", url: link.url, headers: [] },
      ]);
      const prompt = readPrompt(init);
      expect(prompt).toContain("/repo/.nib");
      expect(prompt).toContain(agentControlInstructions);
      expect(prompt).toContain("never a built-in Agent or Task tool");
    }
  });

  test("claude code waits as long as an agent-control call may run", () => {
    const init = initFor("claude-code", { cwd: "/repo", agentControl: link });
    expect(init.env).toEqual({ MCP_TOOL_TIMEOUT: "3600000" });
  });

  test("without a link there is no server, and the prompt keeps only the vault rules", () => {
    const init = initFor("claude-code", { cwd: "/repo", options: { model: "opus" } });
    expect(init.options?.model).toBe("opus");
    expect(init.mcpServers).toBeUndefined();
    const prompt = readPrompt(init);
    expect(prompt).toContain("/repo/.nib");
    expect(prompt).not.toContain("Agent or Task tool");
  });
});
