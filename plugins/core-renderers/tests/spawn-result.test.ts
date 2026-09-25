import { describe, expect, it } from "bun:test";
import { parseSpawnResult } from "../src/spawn-result";

const result = { sessionId: "agent-1", harness: "codex", model: "gpt-5", title: "Ports the API" };

describe("reading what a spawn answered", () => {
  it("takes the object a harness logged as it is", () => {
    expect(parseSpawnResult(result)).toEqual(result);
  });

  it("takes the JSON a transport kept as text", () => {
    expect(parseSpawnResult(JSON.stringify(result))).toEqual(result);
  });

  it("unwraps the MCP envelope", () => {
    const envelope = { content: [{ type: "text", text: JSON.stringify(result) }] };
    expect(parseSpawnResult(envelope)).toEqual(result);
  });

  it("fills in what the harness did not say", () => {
    expect(parseSpawnResult({ sessionId: "agent-1", harness: "pi" })).toEqual({
      sessionId: "agent-1",
      harness: "pi",
      model: null,
      title: null,
    });
  });

  it("is nothing for prose, an error, or a call still in flight", () => {
    expect(parseSpawnResult("the harness refused")).toBeNull();
    expect(parseSpawnResult({ content: [{ type: "text", text: "no such harness" }] })).toBeNull();
    expect(parseSpawnResult({ sessionId: "agent-1" })).toBeNull();
    expect(parseSpawnResult(undefined)).toBeNull();
  });
});
