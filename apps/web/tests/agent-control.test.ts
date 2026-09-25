import { afterEach, describe, expect, test } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Options } from "@anthropic-ai/claude-agent-sdk";
import type { Context, ForkHandle } from "@nib-ui/kernel";
import { createContext } from "@nib-ui/kernel";
import {
  type AgentControlLink,
  agentControlInstructions,
  type AgentReport,
  type AgentToolName,
  type CreateSessionOptions,
} from "@nib-ui/protocol";
import { agentControlTools } from "../../../plugins/harness-pi/src/adapter";
import { withAgentControl } from "../../../plugins/harness-claude-code/src/adapter";
import { codexOptions } from "../../../plugins/harness-codex/src/adapter";
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

function readAppend(options: Options): string {
  const prompt = options.systemPrompt;
  if (typeof prompt !== "object" || Array.isArray(prompt)) throw new Error("no preset prompt");
  return prompt.append ?? "";
}

describe("harness adapters", () => {
  test("claude code merges the nib server into the caller's mcp servers and says to use it", () => {
    const opts: CreateSessionOptions = {
      cwd: "/repo",
      options: { model: "opus", mcpServers: { other: { type: "http", url: "http://elsewhere" } } },
      agentControl: link,
    };
    const options = withAgentControl(opts);
    expect(options).toMatchObject({
      model: "opus",
      mcpServers: {
        other: { type: "http", url: "http://elsewhere" },
        nib: { type: "http", url: link.url, timeout: 3_600_000 },
      },
      systemPrompt: { type: "preset", preset: "claude_code" },
    });
    const append = readAppend(options);
    expect(append).toContain(".nib");
    expect(append).toContain(agentControlInstructions);
    expect(append).toContain("never a built-in Agent or Task tool");
  });

  test("claude code keeps the vault rules, and only those, when there is no link", () => {
    const options = withAgentControl({ cwd: "/repo", options: { model: "opus" } });
    expect(options.model).toBe("opus");
    expect(options.mcpServers).toBeUndefined();
    const append = readAppend(options);
    expect(append).toContain(".nib");
    expect(append).not.toContain("Agent or Task tool");
  });

  test("codex takes the endpoint as an mcp_servers config override", () => {
    expect(codexOptions("/usr/bin/codex", { cwd: "/repo", agentControl: link })).toEqual({
      codexPathOverride: "/usr/bin/codex",
      config: { mcp_servers: { nib: { url: link.url, tool_timeout_sec: 3600 } } },
    });
    expect(codexOptions("/usr/bin/codex", { cwd: "/repo" })).toEqual({
      codexPathOverride: "/usr/bin/codex",
    });
  });

  test("pi takes the tools in process, with json schema parameters", async () => {
    const { link: rootLink } = await mount();
    const tools = agentControlTools(rootLink.tools);
    expect(tools.map((tool) => tool.name)).toEqual(toolNames);

    const read = tools.find((tool) => tool.name === "read_agent");
    if (!read) throw new Error("pi was handed no read_agent tool");
    expect(read.parameters).toMatchObject({
      type: "object",
      properties: { sessionId: { type: "string" } },
      required: ["sessionId"],
    });

    // pi passes its own ExtensionContext as the fifth argument; these tools never read it.
    const extensionContext = undefined as never;
    const result = await read.execute(
      "call-1",
      { sessionId: "child" },
      undefined,
      undefined,
      extensionContext,
    );
    expect(parseResult<AgentReport>(result.content).sessionId).toBe("child");
  });
});
