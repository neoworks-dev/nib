import { randomBytes } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { Plugin } from "@nib-ui/kernel";
import {
  type AgentControlLink,
  type AgentControlTool,
  agentControlServerName,
  type HarnessCatalog,
} from "@nib-ui/protocol";
import {
  type AgentToolServices,
  createAgentNotifier,
  createAgentTools,
  harnessCatalog,
} from "../agent-tools";
import type { AgentControlService } from "../services";

/**
 * How long one model catalog serves. Building it asks pi's runtime which
 * providers are authenticated, which is too slow to repeat on every tool call
 * and too changeable to do once.
 */
const catalogTtlMs = 30_000;

/**
 * The agent-control endpoint. Claude Code and Codex reach the tools over MCP, so
 * they need a url; the desktop build serves the app through Electron's protocol
 * handler and has no http port at all, which makes this listener the only thing
 * a harness subprocess can connect to. It binds loopback on a port the operating
 * system picks, and the session id in the path is paired with a secret so a
 * harness cannot call the tools as a session other than its own.
 */
class AgentControlHost implements AgentControlService {
  private readonly secrets = new Map<string, string>();
  private listener: Server | null = null;
  private origin: Promise<string> | null = null;
  private catalog: { builtAt: number; pending: Promise<HarnessCatalog[]> } | null = null;

  constructor(private readonly services: AgentToolServices) {}

  async linkFor(sessionId: string): Promise<AgentControlLink> {
    const secret = this.secrets.get(sessionId) ?? randomBytes(16).toString("hex");
    this.secrets.set(sessionId, secret);
    const origin = await this.listen();
    return { url: `${origin}/mcp/${sessionId}/${secret}`, tools: await this.toolsFor(sessionId) };
  }

  stop(): void {
    const listener = this.listener;
    this.listener = null;
    this.origin = null;
    this.secrets.clear();
    listener?.closeAllConnections();
    listener?.close();
  }

  private async toolsFor(sessionId: string): Promise<AgentControlTool[]> {
    return createAgentTools(this.services, sessionId, await this.currentCatalog());
  }

  private currentCatalog(): Promise<HarnessCatalog[]> {
    const now = Date.now();
    if (this.catalog && now - this.catalog.builtAt < catalogTtlMs) return this.catalog.pending;
    const pending = harnessCatalog(this.services.host, this.services.harnesses);
    this.catalog = { builtAt: now, pending };
    // A failed build is not worth serving for half a minute.
    pending.catch(() => {
      if (this.catalog?.pending === pending) this.catalog = null;
    });
    return pending;
  }

  private listen(): Promise<string> {
    if (this.origin) return this.origin;
    this.origin = new Promise<string>((resolve, reject) => {
      const listener = createServer((req, res) => void this.handle(req, res));
      this.listener = listener;
      listener.once("error", reject);
      listener.listen(0, "127.0.0.1", () => {
        const address = listener.address();
        if (address === null || typeof address === "string") {
          reject(new Error("agent-control listener bound to no port"));
          return;
        }
        resolve(`http://127.0.0.1:${address.port}`);
      });
    });
    return this.origin;
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const [, prefix, sessionId, secret] = new URL(
      req.url ?? "/",
      "http://127.0.0.1",
    ).pathname.split("/");
    if (prefix !== "mcp" || !sessionId || !secret || this.secrets.get(sessionId) !== secret) {
      res.writeHead(404).end();
      return;
    }

    // A transport and server per request: the MCP session is stateless, so two
    // concurrent tool calls never share a stream and nothing has to be reaped
    // when a harness process dies without saying goodbye.
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    try {
      const server = createMcpServer(await this.toolsFor(sessionId));
      res.on("close", () => {
        void transport.close();
        void server.close();
      });
      await server.connect(transport);
      await transport.handleRequest(req, res);
    } catch (error) {
      if (res.headersSent) return void res.end();
      res.writeHead(500).end(error instanceof Error ? error.message : String(error));
    }
  }
}

function createMcpServer(tools: AgentControlTool[]): McpServer {
  const server = new McpServer({ name: agentControlServerName, version: "1.0.0" });
  for (const tool of tools) {
    server.registerTool(
      tool.name,
      { description: tool.description, inputSchema: tool.inputSchema },
      async (input) => ({
        content: [{ type: "text", text: JSON.stringify(await tool.handler(input)) }],
      }),
    );
  }
  return server;
}

export const agentControlPlugin: Plugin = {
  name: "agent-control",
  inject: ["sessionHost", "harnesses", "boards", "vault"],
  apply(ctx) {
    const sessionHost = ctx.require("sessionHost");
    const service = new AgentControlHost({
      host: sessionHost,
      harnesses: ctx.require("harnesses"),
      boards: ctx.require("boards"),
      vault: ctx.require("vault"),
    });
    ctx.provide("agentControl", service);
    ctx.effect(() => sessionHost.useAgentControl((sessionId) => service.linkFor(sessionId)));
    ctx.effect(() => ctx.on("session/event", createAgentNotifier(sessionHost)));
    ctx.effect(() => () => service.stop());
  },
};
