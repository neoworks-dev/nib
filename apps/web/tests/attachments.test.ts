import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Context, createContext } from "@nib-ui/kernel";
import { attachmentMetadata, composeAttachmentPrompt } from "@nib-ui/protocol";
import { harnessRegistryPlugin } from "../src/lib/server/plugins/harness-registry";
import { sessionHostPlugin } from "../src/lib/server/plugins/session-host";
import type {
  AssetService,
  HarnessAdapter,
  SessionAttachment,
  SessionHost,
} from "../src/lib/server/services";

const shot: SessionAttachment = {
  assetId: "aaa.png",
  mime: "image/png",
  name: "shot.png",
  path: "/assets/aaa.png",
};
const notes: SessionAttachment = {
  assetId: "bbb.txt",
  mime: "text/plain",
  name: "notes.csv",
  path: "/assets/bbb.txt",
};

describe("composeAttachmentPrompt", () => {
  test("names every attachment by the path its bytes are at", () => {
    expect(composeAttachmentPrompt("have a look", [shot, notes])).toBe(
      "have a look\n\nAttached files, readable at these paths:\n" +
        "- shot.png (image/png): /assets/aaa.png\n" +
        "- notes.csv (text/plain): /assets/bbb.txt",
    );
  });

  test("a prompt with nothing attached is passed through untouched", () => {
    expect(composeAttachmentPrompt("just text", [])).toBe("just text");
    expect(composeAttachmentPrompt("", [])).toBe("");
  });

  test("an attachment with no words of its own does not open with blank lines", () => {
    expect(composeAttachmentPrompt("  ", [shot])).toBe(
      "Attached files, readable at these paths:\n- shot.png (image/png): /assets/aaa.png",
    );
  });
});

describe("attachmentMetadata", () => {
  test("keeps the store id out of the path and stays absent when there is nothing to record", () => {
    expect(attachmentMetadata([shot])).toEqual([
      { assetId: "aaa.png", mime: "image/png", name: "shot.png" },
    ]);
    expect(attachmentMetadata([])).toBeUndefined();
  });
});

interface RecordedSend {
  text: string;
  attachments: readonly SessionAttachment[];
}

function stubAdapter(sends: RecordedSend[]): HarnessAdapter {
  return {
    id: "stub",
    displayName: "Stub",
    capabilities: {
      interrupt: false,
      permissionModes: [],
      resume: false,
      fork: false,
      slashCommands: false,
      models: false,
    },
    defaultPermissionMode: "default",
    models: [],
    async createSession() {
      return {
        async send(text, attachments = []) {
          sends.push({ text, attachments });
        },
        async interrupt() {},
        respondToPermission() {},
        async dispose() {},
      };
    },
  };
}

/** Only `aaa.png` is in this store; anything else has been swept away. */
const assets: AssetService = {
  async store() {
    throw new Error("not used");
  },
  async read() {
    return null;
  },
  async path(assetId) {
    return assetId === "aaa.png" ? "/assets/aaa.png" : null;
  },
};

describe("session.send dispatch", () => {
  let ctx: Context;
  let host: SessionHost;
  let sends: RecordedSend[];

  beforeEach(async () => {
    sends = [];
    ctx = createContext();
    ctx.use(harnessRegistryPlugin);
    ctx.provide("assets", assets);
    ctx.use(sessionHostPlugin, { logDirectory: await mkdtemp(join(tmpdir(), "nib-attachments-")) });
    ctx.require("harnesses").register(stubAdapter(sends));
    host = ctx.require("sessionHost");
  });

  afterEach(() => {
    ctx.dispose();
  });

  test("hands the adapter each attachment resolved to a file on disk", async () => {
    const sessionId = await host.create({ harnessId: "stub", cwd: "/repo" });
    await host.execute(sessionId, {
      type: "session.send",
      text: "look at this",
      attachments: [{ assetId: "aaa.png", mime: "image/png", name: "shot.png" }],
    });

    expect(sends).toEqual([{ text: "look at this", attachments: [shot] }]);
  });

  test("a prompt with no attachments reaches the adapter unchanged", async () => {
    const sessionId = await host.create({ harnessId: "stub", cwd: "/repo" });
    await host.execute(sessionId, { type: "session.send", text: "plain" });

    expect(sends).toEqual([{ text: "plain", attachments: [] }]);
  });

  test("an attachment that no longer resolves is dropped and logged, not fatal", async () => {
    const sessionId = await host.create({ harnessId: "stub", cwd: "/repo" });
    await host.execute(sessionId, {
      type: "session.send",
      text: "look at this",
      attachments: [
        { assetId: "ccc.png", mime: "image/png", name: "gone.png" },
        { assetId: "aaa.png", mime: "image/png", name: "shot.png" },
      ],
    });

    expect(sends).toEqual([{ text: "look at this", attachments: [shot] }]);
    expect(host.view(sessionId)!.logs).toEqual([
      {
        level: "warn",
        message: 'attachment "gone.png" is no longer stored and was not sent',
        ts: expect.any(Number),
      },
    ]);
  });
});
