import { describe, expect, test } from "bun:test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AnyAgentEvent } from "@nib-ui/protocol";
import { readSessionLogs } from "../src/lib/server/session-store";

function event(
  seq: number,
  partial: Partial<AnyAgentEvent> & { type: string; data: unknown },
): string {
  return JSON.stringify({ id: `e${seq}`, sessionId: "s1", seq, ts: 1_000 + seq, ...partial });
}

const capabilities = {
  interrupt: true,
  permissionModes: ["default"],
  resume: true,
  fork: false,
  slashCommands: false,
  models: true,
};
const created = event(1, {
  type: "session.created",
  data: { harnessId: "claude-code", cwd: "/repos/one", capabilities },
});
const status = event(2, { type: "session.status", data: { status: "idle" } });

describe("readSessionLogs", () => {
  test("returns nothing when the directory is missing", () => {
    expect(readSessionLogs(join(tmpdir(), "nib-does-not-exist-9137"))).toEqual([]);
  });

  test("reads one entry per log, keyed by filename", async () => {
    const directory = await mkdtemp(join(tmpdir(), "nib-logs-"));
    await writeFile(join(directory, "s1.jsonl"), `${created}\n${status}\n`);

    const logs = readSessionLogs(directory);
    expect(logs).toHaveLength(1);
    expect(logs[0]?.id).toBe("s1");
    expect(logs[0]?.events.map((entry) => entry.seq)).toEqual([1, 2]);
  });

  test("drops corrupt and truncated lines instead of failing the boot", async () => {
    const directory = await mkdtemp(join(tmpdir(), "nib-logs-"));
    await writeFile(join(directory, "s1.jsonl"), `${created}\nnot json\n{"seq":\n${status}\n`);

    expect(readSessionLogs(directory)[0]?.events.map((entry) => entry.seq)).toEqual([1, 2]);
  });

  test("ignores files that are not logs and logs with no usable events", async () => {
    const directory = await mkdtemp(join(tmpdir(), "nib-logs-"));
    await writeFile(join(directory, "notes.txt"), "ignored");
    await writeFile(join(directory, "empty.jsonl"), "garbage\n");
    await writeFile(join(directory, "s1.jsonl"), `${created}\n`);

    expect(readSessionLogs(directory).map((log) => log.id)).toEqual(["s1"]);
  });

  test("orders sessions by the timestamp of their first event", async () => {
    const directory = await mkdtemp(join(tmpdir(), "nib-logs-"));
    await writeFile(
      join(directory, "zzz.jsonl"),
      `${JSON.stringify({ id: "x", sessionId: "zzz", seq: 1, ts: 10, type: "session.status", data: { status: "idle" } })}\n`,
    );
    await writeFile(
      join(directory, "aaa.jsonl"),
      `${JSON.stringify({ id: "y", sessionId: "aaa", seq: 1, ts: 99, type: "session.status", data: { status: "idle" } })}\n`,
    );

    expect(readSessionLogs(directory).map((log) => log.id)).toEqual(["zzz", "aaa"]);
  });
});
