// The system prompt nib gives an agent, in place of the harness's own.
//
// Built the way grove builds its own: a short preamble, then tagged sections.
// Every harness gets the same prompt, so an agent behaves alike whichever runs
// it. The harness's tools stay, and their descriptions say how to use them.
//
// Nothing in it changes between attaches (no date, no clock), so a resumed
// conversation is handed the prompt it started with and keeps its cache.

import { join } from "node:path";
import { agentControlInstructions, comfyInstructions } from "@nib-ui/protocol";
import { VAULT_DIRECTORY, vaultInstructions } from "@nib-ui/vault";

const NIB =
  "nib, a canvas where a project's files are cards on a board and agents work alongside the person looking at it";

const WORKING_RULES = [
  "Match the surrounding code and writing; change only what the task needs",
  "Do not commit, push, reset or delete work unless the person asks",
  "If the task is ambiguous in a way that changes the outcome, ask; otherwise pick the sensible default and say which",
  "Be concise in your responses",
  "Show file paths as path:line",
];

/** Where a session runs and what it is connected to. */
export interface PromptEnvironment {
  cwd: string;
  platform: string;
  /** The session reaches the board and other agents through nib's MCP server. */
  agentControl: boolean;
}

/** The whole system prompt for one session. */
export function nibSystemPrompt(environment: PromptEnvironment): string {
  const sections = [
    `You are an expert assistant operating inside ${NIB}. You help by reading files, searching, running commands, editing and writing files, and keeping the project's vault current.`,
    section("rules", WORKING_RULES.map((rule) => `- ${rule}`).join("\n")),
    section("vault", vaultInstructions(join(environment.cwd, VAULT_DIRECTORY))),
  ];
  if (environment.agentControl) {
    sections.push(section("board", agentControlInstructions));
    sections.push(section("comfyui", comfyInstructions));
  }
  sections.push(section("environment", environmentLines(environment)));
  return sections.join("\n\n");
}

/** Content wrapped in a tag of its name. */
function section(name: string, content: string): string {
  return `<${name}>\n${content.trim()}\n</${name}>`;
}

/** Where the session runs, one fact a line. */
function environmentLines(environment: PromptEnvironment): string {
  return [`cwd: ${environment.cwd}`, `platform: ${environment.platform}`].join("\n");
}
