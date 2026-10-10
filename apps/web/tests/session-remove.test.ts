import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createContext } from "@nib-ui/kernel";
import type { EmitEvent, HarnessAdapter, HarnessSession } from "@nib-ui/protocol";
import { sessionHostPlugin } from "../src/lib/server/plugins/session-host";
import type { AssetService, HarnessRegistry, SessionHost } from "../src/lib/server/services";

const capabilities = {
  interrupt: true,
  permissionModes: ["default"],
  resume: true,
  fork: true,
  slashCommands: false,
  models: true,
};

const assets = {
  store: () => Promise.reject(new Error("not used")),
  read: () => Promise.resolve(null),
  path: () => Promise.resolve(null),
} satisfies AssetService;

interface Fixture {
  host: SessionHost;
  directory: string;
  /** What the harness behind the last forked session was given to report with. */
  lateEmit: () => EmitEvent;
}

/**
 * A host holding one logged conversation, `source`, whose harness fails to shut
 * down when `disposeFails` is set.
 */
async function fixture(disposeFails: boolean): Promise<Fixture> {
  const directory = await mkdtemp(join(tmpdir(), "nib-remove-"));
  const events = [{ type: "session.created", data: { harnessId: "h", cwd: "/x", capabilities } }];
  for (let index = 0; index < 150; index += 1) {
    events.push({ type: "user.message", data: { text: `message ${index}` } } as never);
  }
  const lines = events.map((event, index) =>
    JSON.stringify({
      id: `e${index}`,
      sessionId: "source",
      seq: index + 1,
      ts: 1_000 + index,
      ...event,
    }),
  );
  await writeFile(join(directory, "source.jsonl"), `${lines.join("\n")}\n`);

  let emitter: EmitEvent = () => {};
  const harnessSession: HarnessSession = {
    send: () => Promise.resolve(),
    interrupt: () => Promise.resolve(),
    respondToPermission: () => {},
    dispose: () => (disposeFails ? Promise.reject(new Error("would not stop")) : Promise.resolve()),
  };
  const adapter: HarnessAdapter = {
    id: "h",
    displayName: "H",
    capabilities,
    defaultPermissionMode: "default",
    models: [],
    createSession: () => Promise.resolve(harnessSession),
    resumeSession: (_nativeSessionId, _options, emit) => {
      emitter = emit;
      return Promise.resolve(harnessSession);
    },
  };
  const harnesses = {
    register: () => () => {},
    get: () => adapter,
    list: () => [],
  } satisfies HarnessRegistry;

  const context = createContext();
  context.provide("harnesses", harnesses);
  context.provide("assets", assets);
  context.use(sessionHostPlugin, {
    logDirectoryFor: () => directory,
    logDirectories: () => [directory],
  });
  return { host: context.require("sessionHost"), directory, lateEmit: () => emitter };
}

async function fork(host: SessionHost): Promise<string> {
  return host.resume({
    harnessId: "h",
    cwd: "/x",
    nativeSessionId: "native",
    fork: true,
    copyHistoryFrom: "source",
  });
}

const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 200));

describe("removing a session", () => {
  test("deletes the log even when it is removed the moment it was written", async () => {
    const { host, directory } = await fixture(false);
    const id = await fork(host);

    await host.remove(id);
    await settle();

    expect(existsSync(join(directory, `${id}.jsonl`))).toBe(false);
  });

  test("still deletes the log, and succeeds, when the harness fails to shut down", async () => {
    const { host, directory } = await fixture(true);
    const id = await fork(host);
    await settle();
    expect(existsSync(join(directory, `${id}.jsonl`))).toBe(true);

    await host.remove(id);

    expect(existsSync(join(directory, `${id}.jsonl`))).toBe(false);
    expect(host.has(id)).toBe(false);
  });

  test("does not write, or throw, when the harness reports after the removal", async () => {
    const { host, directory, lateEmit } = await fixture(false);
    const id = await fork(host);
    await host.remove(id);

    lateEmit()({ type: "session.status", data: { status: "idle" } });
    await settle();

    expect(existsSync(join(directory, `${id}.jsonl`))).toBe(false);
  });
});
