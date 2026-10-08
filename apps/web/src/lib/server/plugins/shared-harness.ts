import type { Harness } from "@neoworks/harness";
import type { Plugin } from "@nib-ui/kernel";
import type { HarnessAdapter } from "@nib-ui/protocol";
import {
  capabilitiesOf,
  defaultModelId,
  defaultPermissionPolicy,
  type SharedHarnessSpec,
  sharedHarnessSpecs,
} from "../harness/harnesses";
import { startSharedSession } from "../harness/session";

/**
 * The one shared harness every session runs on, started on first use. It
 * spawns Claude Code, Codex and pi as child processes and pools them.
 */
class SharedHarnessHost {
  private harness: Promise<Harness> | null = null;

  /** The harness, started the first time something needs it. */
  get(): Promise<Harness> {
    if (this.harness === null) {
      // An empty config keeps the user's own `~/.config/neoworks/harness.json`
      // out of it: which harness a session runs on is nib's to say.
      this.harness = import("@neoworks/harness").then(({ createHarness }) => createHarness({}));
    }
    return this.harness;
  }

  /** Stops every harness process. */
  async close(): Promise<void> {
    const harness = this.harness;
    this.harness = null;
    if (harness === null) {
      return;
    }
    await (await harness).close();
  }
}

/** One of the shared harness's harnesses, as nib's adapter. */
function sharedAdapter(host: SharedHarnessHost, spec: SharedHarnessSpec): HarnessAdapter {
  return {
    id: spec.id,
    displayName: spec.displayName,
    capabilities: capabilitiesOf(spec),
    defaultPermissionMode: defaultPermissionPolicy,
    models: spec.models,
    defaultModel: defaultModelId,
    async listModels() {
      const listed = await (await host.get()).listModels(spec.runsOn);
      return listed.map((model) => ({
        id: model.id,
        displayName: model.name,
        description: model.description,
      }));
    },
    async createSession(opts, emit) {
      return startSharedSession(await host.get(), spec, opts, emit, { kind: "create" });
    },
    async resumeSession(nativeSessionId, opts, emit) {
      let kind: "resume" | "fork" = "resume";
      if (opts.fork) {
        kind = "fork";
      }
      return startSharedSession(await host.get(), spec, opts, emit, { kind, nativeSessionId });
    },
  };
}

/** Claude Code, Codex and pi, all driven through `@neoworks/harness`. */
export const sharedHarnessPlugin: Plugin = {
  name: "shared-harness",
  inject: ["harnesses"],
  apply(ctx) {
    const harnesses = ctx.require("harnesses");
    const host = new SharedHarnessHost();
    for (const spec of sharedHarnessSpecs) {
      ctx.effect(() => harnesses.register(sharedAdapter(host, spec)));
    }
    ctx.effect(() => () => void host.close());
  },
};
