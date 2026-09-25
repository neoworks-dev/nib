// charters: the exploration scopes that ship with the nib-debug skill.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Command } from "commander";
import { paths } from "../paths.ts";

/** Register the charters command. */
export function registerCharterCommands(program: Command): void {
  program
    .command("charters")
    .description("the charters `explore` accepts by name")
    .action(() => listCharters());
}

/** A charter by name from the skill's directory, or the text itself. */
export function charterText(name: string): string {
  const path = join(paths.charters, `${name}.md`);
  if (existsSync(path)) return readFileSync(path, "utf8");
  return name;
}

/** Print each charter's name and the title on its first line. */
function listCharters(): void {
  if (!existsSync(paths.charters)) {
    console.log("no charters");
    return;
  }
  for (const entry of readdirSync(paths.charters)) {
    if (!entry.endsWith(".md")) continue;
    const firstLine = readFileSync(join(paths.charters, entry), "utf8").split("\n")[0] ?? "";
    console.log(`${entry.replace(/\.md$/, "").padEnd(12)} ${firstLine.replace(/^#\s*/, "")}`);
  }
}
