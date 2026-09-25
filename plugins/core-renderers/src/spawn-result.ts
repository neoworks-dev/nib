import type { SpawnAgentResult } from "@nib-ui/protocol";

/**
 * The answer a spawn call left in the transcript. Three harnesses log it three
 * ways: pi keeps the object, Claude Code and Codex wrap it in the MCP envelope
 * whose one text block holds the JSON, and a transport that only kept the text
 * leaves the JSON as a string. Read leniently — the card needs the id and the
 * harness, and a spawn that failed leaves prose here rather than a result.
 */
export function parseSpawnResult(output: unknown): SpawnAgentResult | null {
  const decoded = decode(output);
  if (typeof decoded !== "object" || decoded === null) return null;

  const { sessionId, harness, model, title } = decoded as Partial<SpawnAgentResult>;
  if (typeof sessionId !== "string" || typeof harness !== "string") return null;
  return {
    sessionId,
    harness,
    model: typeof model === "string" ? model : null,
    title: typeof title === "string" ? title : null,
  };
}

function decode(output: unknown): unknown {
  if (typeof output === "string") return parseJson(output);
  if (typeof output !== "object" || output === null) return output;

  const content = (output as { content?: unknown }).content;
  if (!Array.isArray(content)) return output;
  for (const entry of content as unknown[]) {
    const text = (entry as { text?: unknown } | null)?.text;
    if (typeof text === "string") return parseJson(text);
  }
  return output;
}

function parseJson(text: string): unknown {
  try {
    const value: unknown = JSON.parse(text);
    return value;
  } catch {
    return null;
  }
}
