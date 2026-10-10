import { describe, expect, test } from "bun:test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createContext } from "@nib-ui/kernel";
import type { AnyAgentEvent, HarnessAdapter, HarnessSession } from "@nib-ui/protocol";
import { sessionHostPlugin } from "../src/lib/server/plugins/session-host";
import type { AssetService, HarnessRegistry } from "../src/lib/server/services";

const capabilities = {
  interrupt: true,
  permissionModes: ["default"],
  resume: true,
  fork: true,
  slashCommands: false,
  models: true,
};

function line(seq: number, type: string, data: unknown): string {
  return JSON.stringify({
    id: `e${seq}`,
    sessionId: "source",
    seq,
    ts: 1_000 + seq,
    type,
    data,
  } as AnyAgentEvent);
}

const attachedSession: HarnessSession = {
  send: () => Promise.resolve(),
  interrupt: () => Promise.resolve(),
  respondToPermission: () => {},
  dispose: () => Promise.resolve(),
};

const adapter: HarnessAdapter = {
  id: "claude-code",
  displayName: "Claude Code",
  capabilities,
  defaultPermissionMode: "default",
  defaultModel: "default-model",
  models: [],
  createSession: () => Promise.resolve(attachedSession),
  resumeSession: () => Promise.resolve(attachedSession),
};

const harnesses = {
  register: () => () => {},
  get: () => adapter,
  list: () => [],
} satisfies HarnessRegistry;

const assets = {
  store: () => Promise.reject(new Error("not used")),
  read: () => Promise.resolve(null),
  path: () => Promise.resolve(null),
} satisfies AssetService;

/** A host that has restored one finished conversation, `source`, from its log. */
async function hostWithSource() {
  const logDirectory = await mkdtemp(join(tmpdir(), "nib-fork-"));
  const lines = [
    line(1, "session.created", { harnessId: "claude-code", cwd: "/repos/one", capabilities }),
    line(2, "session.meta", { label: "Greeting", model: "opus" }),
    line(3, "user.message", { text: "hello there" }),
    line(4, "session.status", { status: "idle" }),
  ];
  await writeFile(join(logDirectory, "source.jsonl"), `${lines.join("\n")}\n`);

  const context = createContext();
  context.provide("harnesses", harnesses);
  context.provide("assets", assets);
  context.use(sessionHostPlugin, {
    logDirectoryFor: () => logDirectory,
    logDirectories: () => [logDirectory],
  });
  return context.require("sessionHost");
}

describe("forking a session", () => {
  test("opens with the source's conversation, its own label and the picks it was given", async () => {
    const host = await hostWithSource();

    const forkId = await host.resume({
      harnessId: "claude-code",
      cwd: "/repos/one",
      nativeSessionId: "native-1",
      fork: true,
      label: "Greeting (branch)",
      options: { model: "opus", effort: "high" },
      copyHistoryFrom: "source",
    });

    const fork = host.view(forkId);
    expect(fork?.title).toBe("Greeting (branch)");
    expect(fork?.model).toBe("opus");
    expect(fork?.effort).toBe("high");
    expect(fork?.items.map((item) => item.type)).toEqual(["user"]);
    expect(host.view("source")?.items).toHaveLength(1);
  });

  test("refuses to fork from a session that does not exist", async () => {
    const host = await hostWithSource();

    const attempt = host.resume({
      harnessId: "claude-code",
      cwd: "/repos/one",
      nativeSessionId: "native-1",
      fork: true,
      copyHistoryFrom: "missing",
    });

    await expect(attempt).rejects.toThrow('unknown session "missing"');
  });
});
