// explore: hand the running app to a Claude Code instance and let it report
// what it finds.
//
// Sonnet by default, because this is hours of clicking and looking rather than
// a hard problem, and a process of its own rather than a subagent so it has a
// whole context to spend. It can read the repo and drive the harness; it
// cannot edit anything. What it produces is issues, not fixes.

import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { Command } from "commander";
import { AI_LABEL, FINDINGS_REPO } from "../github.ts";
import { paths, repoRoot } from "../paths.ts";
import { readSession } from "../session.ts";
import { slug, stamp } from "../shots.ts";
import { renderTranscript } from "../transcript.ts";
import { charterText } from "./charters.ts";

interface ExploreOptions {
  model: string;
  dryRun?: boolean;
}

/**
 * The tools an exploring run may use. It has nobody to answer a permission
 * prompt, so anything missing here stops it dead. `Edit` is on it because the
 * report is kept up to date as the run goes.
 */
const ALLOWED_TOOLS = [
  "Read",
  "Glob",
  "Grep",
  "Write",
  "Edit",
  "Bash(bun run debug:*)",
  // The same harness, spelled the way `bun run` itself echoes it.
  "Bash(bun scripts/debug/cli.ts:*)",
  "Bash(gh issue:*)",
  "Bash(gh label:*)",
];

/** Register the explore command. */
export function registerExploreCommand(program: Command): void {
  program
    .command("explore [scope]")
    .description("hand the app to a Claude Code run that tests it and files what it finds")
    .option("--model <model>", "the model the run uses", "sonnet")
    .option("--dry-run", "write the report, file no issues")
    .action((scope: string | undefined, options: ExploreOptions) => explore(scope, options));
}

/** Start the exploring run and stream its transcript until it exits. */
function explore(scope: string | undefined, options: ExploreOptions): void {
  if (!readSession()) {
    throw new Error('no session is running — "debug start" first, so the run has an app to drive');
  }

  let label = "whole-app";
  let charter = "Explore the whole app. Cover every surface you can reach.";
  if (scope !== undefined) {
    label = scope;
    charter = charterText(scope);
  }
  mkdirSync(paths.reports, { recursive: true });
  const report = join(paths.reports, `${stamp()}-${slug(label)}.md`);

  const child = spawn(
    "claude",
    [
      "--model",
      options.model,
      "--allowedTools",
      ALLOWED_TOOLS.join(","),
      // Exploring fills the context with screenshots and probe dumps; compact
      // rather than stop halfway through a charter.
      "--autocompact",
      "200000",
      "--output-format",
      "stream-json",
      "--include-partial-messages",
      "--verbose",
      "-p",
      explorePrompt(charter, report, options.dryRun !== true),
    ],
    {
      cwd: repoRoot,
      stdio: ["ignore", "pipe", "inherit"],
      // `gh issue view --web` is inside the permissions a run needs, and would
      // open a real browser on the desktop that launched this. Make it a no-op.
      env: { ...process.env, BROWSER: "/usr/bin/true", GH_BROWSER: "/usr/bin/true" },
    },
  );

  console.log(`exploring: ${label}\n`);
  void renderTranscript(child.stdout);

  // Ctrl-C reaches the agent too — it shares this process group — so the run
  // ends either way. Say where the half-finished report is before going.
  process.on("SIGINT", () => {
    console.log(`\ninterrupted. report so far: ${report}`);
    console.log('the session is still up; "bun run debug stop" ends it');
    process.exit(130);
  });
  child.on("exit", (code) => {
    console.log(`\nreport: ${report}`);
    process.exit(code ?? 0);
  });
}

/** The instructions the exploring run starts from. */
function explorePrompt(charter: string, report: string, fileIssues: boolean): string {
  let filing = "Do not file any issues — this is a dry run. The report is the deliverable.";
  if (fileIssues) {
    filing = `File each finding as its own GitHub issue with "bun run debug finding", which
attaches the screenshot and adds the ${AI_LABEL} label. Say what you did, what
happened, and what you expected.`;
  }

  return `You are testing nib by using it, the way a person would.

Read .claude/skills/nib-debug/SKILL.md first. It has the harness commands, how to
see what is on screen, and what is worth reporting.

A session is already running. Do not start, stop or rebuild one.

Every harness command is "bun run debug <command>". Nothing else can be run, and a
command outside that list stops the run dead rather than asking anyone.

Before you touch the app, read what is already known about the part you are
testing:

    gh issue list --repo ${FINDINGS_REPO} --state open --limit 100
    gh issue view <number> --repo ${FINDINGS_REPO}

A finding that is already filed is not a finding — say in your report that you
saw it again, and comment on the issue if you learned something new. An open
issue is also a lead: see whether it is still true, whether it is worse than it
says, and what sits next to it that nobody has filed yet.

What to cover:

${charter}

Work in small loops: act, probe, decide. The probe is the board and the docks
around it, which is what tells you where you are; take a screenshot when the
question is visual — alignment, overlap, a card drawn wrong, a pane gone blank —
and read the PNG with the Read tool when you do.

Never open a browser, and never pass --web to anything.

Note anything that is broken, confusing, inconsistent, ugly, slow, or that made
you guess what to do — the last one matters as much as the crashes.

Keep ${report} up to date as you go, so the work survives running out of context.

${filing}

Read the code to understand what you are seeing, but do not change any of it.`;
}
