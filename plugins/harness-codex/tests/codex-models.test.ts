import { describe, expect, test } from "bun:test";
import { chmod, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { appServerRequest, type JsonRpcMessage, readJsonLines } from "../src/app-server";
import { parseModelList } from "../src/mapping";

/** Trimmed from a real `model/list` answer of codex-cli 0.145. */
const modelListResult = {
  data: [
    {
      id: "gpt-5.6-sol",
      model: "gpt-5.6-sol",
      displayName: "GPT-5.6-Sol",
      description: "Older coding model for complex work.",
      hidden: false,
      isDefault: true,
    },
    {
      id: "gpt-5.6-luna",
      model: "gpt-5.6-luna",
      displayName: "",
      description: "Older fast and efficient model.",
      hidden: false,
      isDefault: false,
    },
    { id: "codex-auto-review", displayName: "Auto review", hidden: true, isDefault: false },
  ],
};

/**
 * A stand-in `codex` that speaks just enough of the app-server protocol: it
 * answers the handshake, prints a diagnostic line, then answers `model/list`.
 */
const fakeCodex = `#!/usr/bin/env node
const readline = require("node:readline");
const lines = readline.createInterface({ input: process.stdin });
lines.on("line", (line) => {
  const message = JSON.parse(line);
  if (message.method === "initialize") {
    process.stdout.write(JSON.stringify({ id: message.id, result: {} }) + "\\n");
    process.stdout.write("warming up\\n");
  }
  if (message.method === "model/list") {
    process.stdout.write(JSON.stringify({ id: message.id, result: ${JSON.stringify(modelListResult)} }) + "\\n");
  }
});
`;

describe("parseModelList", () => {
  test("offers what the CLI's own picker shows, without the hidden routing targets", () => {
    expect(parseModelList(modelListResult)).toEqual([
      {
        id: "gpt-5.6-sol",
        displayName: "GPT-5.6-Sol",
        description: "Older coding model for complex work.",
      },
      {
        id: "gpt-5.6-luna",
        displayName: "gpt-5.6-luna",
        description: "Older fast and efficient model.",
      },
    ]);
  });

  test("reads nothing from an answer it does not recognise", () => {
    expect(parseModelList(null)).toEqual([]);
    expect(parseModelList({ data: "nope" })).toEqual([]);
  });
});

describe("readJsonLines", () => {
  test("reassembles messages split across chunks and skips diagnostics", () => {
    const stream = new PassThrough();
    const seen: JsonRpcMessage[] = [];
    readJsonLines(stream, (message) => seen.push(message));

    stream.write('{"id":1,"res');
    stream.write('ult":{"ok":true}}\nstarting up\n\n{"id":2}\n');

    expect(seen).toEqual([{ id: 1, result: { ok: true } }, { id: 2 }]);
  });
});

describe("appServerRequest", () => {
  test("handshakes with the app-server and answers with the request's result", async () => {
    const directory = await mkdtemp(join(tmpdir(), "nib-codex-"));
    const executable = join(directory, "codex");
    await writeFile(executable, fakeCodex);
    await chmod(executable, 0o755);

    const result = await appServerRequest(executable, "model/list", {});
    expect(parseModelList(result).map((model) => model.id)).toEqual([
      "gpt-5.6-sol",
      "gpt-5.6-luna",
    ]);
  });

  test("rejects when the executable cannot be started", async () => {
    const missing = join(tmpdir(), "nib-codex-does-not-exist", "codex");
    await expect(appServerRequest(missing, "model/list", {})).rejects.toThrow();
  });
});
