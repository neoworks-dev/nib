import { join } from "node:path";
import { type Context, createContext } from "@nib-ui/kernel";
import { claudeCodeHarness } from "@nib-ui/plugin-harness-claude-code";
import { codexHarness } from "@nib-ui/plugin-harness-codex";
import { piHarness } from "@nib-ui/plugin-harness-pi";
import { migrateLegacySessionLogs } from "./data-dir";
import {
  migrateSessionLogsIntoVaults,
  sessionLogDirectories,
  sessionLogDirectory,
} from "./session-logs";
import { agentControlPlugin } from "./plugins/agent-control";
import { assetsPlugin } from "./plugins/assets";
import { boardsPlugin } from "./plugins/boards";
import { gitPlugin } from "./plugins/git";
import { harnessRegistryPlugin } from "./plugins/harness-registry";
import { linkPreviewsPlugin } from "./plugins/link-previews";
import { pinterestPlugin } from "./plugins/pinterest";
import { sessionHostPlugin } from "./plugins/session-host";
import { vaultPlugin } from "./plugins/vault";
import { workspacePlugin } from "./plugins/workspace";
import type {
  AssetService,
  BoardService,
  GitService,
  HarnessRegistry,
  LinkPreviewService,
  PinterestService,
  SessionHost,
  VaultService,
  WorkspaceService,
} from "./services";

let context: Context | undefined;

/** The server kernel instance. Plugins are loaded statically from this manifest. */
export function serverContext(): Context {
  if (context) return context;
  // Two hops, in order: the pre-XDG directory into XDG, then XDG into the vault
  // of whichever project each transcript is about (PLAN §12).
  migrateLegacySessionLogs(join(process.cwd(), ".nib-ui", "sessions"));
  migrateSessionLogsIntoVaults();

  context = createContext();
  context.use(harnessRegistryPlugin);
  // Before the host: a prompt's attachments are resolved against the store.
  context.use(assetsPlugin);
  context.use(sessionHostPlugin, {
    logDirectoryFor: sessionLogDirectory,
    logDirectories: sessionLogDirectories,
  });
  // Harnesses are ordinary plugin packages; every mount's id, models and defaults
  // come from the config passed here, not from the adapter's own literals.
  context.use(claudeCodeHarness, {});
  context.use(codexHarness, {});
  context.use(piHarness, {});
  context.use(workspacePlugin);
  context.use(gitPlugin);
  context.use(boardsPlugin);
  context.use(vaultPlugin);
  // After the board and the vault, which its canvas tools arrange. Every session
  // the host launches — which is none until a request arrives — is handed the
  // endpoint its agent drives other sessions and the board through.
  context.use(agentControlPlugin);
  context.use(linkPreviewsPlugin);
  context.use(pinterestPlugin);
  return context;
}

export function harnesses(): HarnessRegistry {
  return serverContext().require("harnesses");
}

export function sessionHost(): SessionHost {
  return serverContext().require("sessionHost");
}

export function workspace(): WorkspaceService {
  return serverContext().require("workspace");
}

export function git(): GitService {
  return serverContext().require("git");
}

export function boards(): BoardService {
  return serverContext().require("boards");
}

export function vault(): VaultService {
  return serverContext().require("vault");
}

export function assets(): AssetService {
  return serverContext().require("assets");
}

export function linkPreviews(): LinkPreviewService {
  return serverContext().require("linkPreviews");
}

export function pinterest(): PinterestService {
  return serverContext().require("pinterest");
}
