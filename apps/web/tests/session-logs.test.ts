import { afterEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { VAULT_DIRECTORY } from "@nib-ui/vault";
import { migrateSessionLogsIntoVaults, sessionLogDirectory } from "../src/lib/server/session-logs";

const created: string[] = [];

afterEach(() => {
  for (const root of created.splice(0)) rmSync(root, { recursive: true, force: true });
});

function temporary(prefix: string): string {
  const root = mkdtempSync(join(tmpdir(), prefix));
  created.push(root);
  return root;
}

function log(cwd: string | null, text = "hello"): string {
  const lines = [
    JSON.stringify({
      type: "session.created",
      data: cwd === null ? { harnessId: "claude-code" } : { harnessId: "claude-code", cwd },
    }),
    JSON.stringify({ type: "message.user", data: { text } }),
  ];
  return `${lines.join("\n")}\n`;
}

describe("sessionLogDirectory", () => {
  it("puts a transcript in the vault of the project it is about", () => {
    expect(sessionLogDirectory("/work/project")).toBe(join("/work/project", VAULT_DIRECTORY));
  });
});

describe("migrateSessionLogsIntoVaults", () => {
  it("files each transcript under the project its own log names", () => {
    const legacy = temporary("nib-legacy-");
    const project = temporary("nib-project-");
    writeFileSync(join(legacy, "s1.jsonl"), log(project));

    const moved = migrateSessionLogsIntoVaults(legacy);

    expect(moved).toEqual([join(project, VAULT_DIRECTORY, "s1.jsonl")]);
    expect(readFileSync(join(project, VAULT_DIRECTORY, "s1.jsonl"), "utf8")).toContain("hello");
    expect(existsSync(join(legacy, "s1.jsonl"))).toBe(false);
  });

  it("leaves a transcript whose project is gone exactly where it is", () => {
    const legacy = temporary("nib-legacy-");
    writeFileSync(join(legacy, "s1.jsonl"), log("/not/a/directory/anymore"));

    expect(migrateSessionLogsIntoVaults(legacy)).toEqual([]);
    expect(existsSync(join(legacy, "s1.jsonl"))).toBe(true);
  });

  it("leaves a transcript that never recorded a directory", () => {
    const legacy = temporary("nib-legacy-");
    writeFileSync(join(legacy, "s1.jsonl"), log(null));

    expect(migrateSessionLogsIntoVaults(legacy)).toEqual([]);
    expect(existsSync(join(legacy, "s1.jsonl"))).toBe(true);
  });

  it("never overwrites a transcript the vault already holds", () => {
    const legacy = temporary("nib-legacy-");
    const project = temporary("nib-project-");
    mkdirSync(join(project, VAULT_DIRECTORY), { recursive: true });
    writeFileSync(join(project, VAULT_DIRECTORY, "s1.jsonl"), "the one that is already there");
    writeFileSync(join(legacy, "s1.jsonl"), log(project));

    expect(migrateSessionLogsIntoVaults(legacy)).toEqual([]);
    expect(readFileSync(join(project, VAULT_DIRECTORY, "s1.jsonl"), "utf8")).toBe(
      "the one that is already there",
    );
  });

  it("is a no-op when there is nothing to move", () => {
    expect(migrateSessionLogsIntoVaults(join(tmpdir(), "nib-nothing-here"))).toEqual([]);
  });
});
