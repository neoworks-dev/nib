import { join } from "node:path";
import { type Context, createContext } from "@nib-ui/kernel";
import { claudeCodeHarness } from "@nib-ui/plugin-harness-claude-code";
import { codexHarness } from "@nib-ui/plugin-harness-codex";
import { piHarness } from "@nib-ui/plugin-harness-pi";
import { migrateLegacySessionLogs, sessionsDirectory } from "./data-dir";
import { assetsPlugin } from "./plugins/assets";
import { boardsPlugin } from "./plugins/boards";
import { gitPlugin } from "./plugins/git";
import { harnessRegistryPlugin } from "./plugins/harness-registry";
import { linkPreviewsPlugin } from "./plugins/link-previews";
import { sessionHostPlugin } from "./plugins/session-host";
import { workspacePlugin } from "./plugins/workspace";
import type {
  AssetService,
  BoardService,
  GitService,
  HarnessRegistry,
  LinkPreviewService,
  SessionHost,
  WorkspaceService,
} from "./services";

let context: Context | undefined;

/** The server kernel instance. Plugins are loaded statically from this manifest. */
export function serverContext(): Context {
  if (context) return context;
  migrateLegacySessionLogs(join(process.cwd(), ".nib-ui", "sessions"));

  context = createContext();
  context.use(harnessRegistryPlugin);
  // Before the host: a prompt's attachments are resolved against the store.
  context.use(assetsPlugin);
  context.use(sessionHostPlugin, { logDirectory: sessionsDirectory() });
  // Harnesses are ordinary plugin packages; every mount's id, models and defaults
  // come from the config passed here, not from the adapter's own literals.
  context.use(claudeCodeHarness, {});
  context.use(codexHarness, {});
  context.use(piHarness, {});
  context.use(workspacePlugin);
  context.use(gitPlugin);
  context.use(boardsPlugin);
  context.use(linkPreviewsPlugin);
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

export function assets(): AssetService {
  return serverContext().require("assets");
}

export function linkPreviews(): LinkPreviewService {
  return serverContext().require("linkPreviews");
}
