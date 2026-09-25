// finding and evidence: what the harness posts to GitHub, as neoworks-bot.

import type { Command } from "commander";
import {
  AI_LABEL,
  bodyText,
  FINDINGS_REPO,
  github,
  headCommit,
  screenshotSection,
} from "../github.ts";
import { repoRoot } from "../paths.ts";

interface FindingOptions {
  title: string;
  body: string;
  label: string[];
  screenshot: string[];
}

interface EvidenceOptions {
  issue: string;
  body: string;
  screenshot: string[];
}

/** Collect every value of a repeatable option. */
function collect(value: string, previous: string[]): string[] {
  return [...previous, value];
}

/** Register finding and evidence. */
export function registerGithubCommands(program: Command): void {
  program
    .command("finding")
    .description(`file one finding on ${FINDINGS_REPO}, screenshots attached, labelled ${AI_LABEL}`)
    .requiredOption("--title <title>", "the issue title")
    .requiredOption("--body <file|text>", "a file holding the body, or the body itself")
    .option("--label <label>", "a label to add; repeat for more", collect, [])
    .option("--screenshot <path>", "a screenshot to embed; repeat for more", collect, [])
    .action((options: FindingOptions) => fileFinding(options));

  program
    .command("evidence")
    .description("comment on an issue that its fix works, with the screenshots that show it")
    .requiredOption("--issue <number>", "the issue the fix is for")
    .requiredOption("--body <file|text>", "what changed, as a file or the text itself")
    .option("--screenshot <path>", "a screenshot to embed; repeat for more", collect, [])
    .action((options: EvidenceOptions) => postEvidence(options));
}

/** Open an issue for a finding. */
function fileFinding(options: FindingOptions): void {
  const sections = [bodyText(options.body)];
  const images = screenshotSection(options.screenshot);
  if (images !== null) sections.push(images);
  sections.push(`---\n\n*Found by an exploratory debug run on ${headCommit(repoRoot)}.*`);

  const labels = [AI_LABEL, ...options.label];
  const created = github([
    "issue",
    "create",
    "--repo",
    FINDINGS_REPO,
    "--title",
    options.title,
    "--body",
    sections.join("\n\n"),
    ...labels.flatMap((name) => ["--label", name]),
  ]);
  if (created.status !== 0) throw new Error(`could not file the issue:\n${created.stderr.trim()}`);
  console.log(created.stdout.trim());
}

/** Comment on an issue with what changed and the screenshots that prove it. */
function postEvidence(options: EvidenceOptions): void {
  const sections = [bodyText(options.body)];
  const images = screenshotSection(options.screenshot);
  if (images !== null) sections.push(images);
  // The checkout the command runs from, which is the branch under test.
  sections.push(`---\n\n*Verified on ${headCommit(process.cwd())}.*`);

  const commented = github([
    "issue",
    "comment",
    options.issue,
    "--repo",
    FINDINGS_REPO,
    "--body",
    sections.join("\n\n"),
  ]);
  if (commented.status !== 0) {
    throw new Error(`could not comment on #${options.issue}:\n${commented.stderr.trim()}`);
  }
  console.log(commented.stdout.trim());
}
