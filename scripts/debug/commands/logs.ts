// logs: what the app has complained about, from both of its halves.

import { readFileSync } from "node:fs";
import type { Command } from "commander";
import { drive, parseDriverOutput } from "../drive.ts";
import { paths } from "../paths.ts";
import { requireSession } from "../session.ts";

interface LogOptions {
  main?: boolean;
  renderer?: boolean;
}

/** Register the logs command. */
export function registerLogCommands(program: Command): void {
  program
    .command("logs [count]")
    .description("the renderer's console, then the main process and SvelteKit server output")
    .option("--main", "only the main process")
    .option("--renderer", "only the renderer")
    .action((count: string | undefined, options: LogOptions) =>
      showLogs(Number(count ?? 40), options),
    );
}

/**
 * Print both logs. The renderer's buffer and the main process's stdout hold
 * different failures — the vault writes, the harnesses and the SvelteKit
 * handler only ever appear in the second — and a fault usually needs both.
 */
function showLogs(count: number, options: LogOptions): void {
  if (!options.main) {
    const entries = parseDriverOutput<Array<{ level: string; at: string; text: string }>>(
      drive(requireSession(), { action: "console" }),
    );
    console.log(`renderer (${entries.length} entries, last ${Math.min(count, entries.length)}):`);
    for (const entry of entries.slice(-count)) {
      console.log(`  [${entry.level}] ${entry.at.slice(11, 19)} ${entry.text}`);
    }
  }
  if (options.renderer) return;

  if (!options.main) console.log("");
  console.log(`main process (${paths.appLog}, last ${count} lines):`);
  const lines = readFileSync(paths.appLog, "utf8").split("\n");
  for (const line of lines.slice(-count)) console.log(`  ${line}`);
}
