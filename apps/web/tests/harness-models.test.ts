import { describe, expect, test } from "bun:test";
import type { HarnessAdapter, HarnessDescriptor, ModelInfo } from "@nib-ui/protocol";
import type { TransportService } from "@nib-ui/ui-contracts";
import { ReactiveSessionsStore } from "../src/lib/client/registries/sessions.svelte";
import { availableModels } from "../src/lib/server/harness-models";

const staticModels: ModelInfo[] = [
  { id: "default", displayName: "Default" },
  { id: "gpt-5.5", displayName: "GPT-5.5" },
];
const discovered: ModelInfo[] = [
  { id: "default", displayName: "Default" },
  { id: "gpt-5.6-sol", displayName: "GPT-5.6-Sol" },
  { id: "gpt-5.6-luna", displayName: "GPT-5.6-Luna" },
];

const codex: HarnessDescriptor = {
  id: "codex",
  displayName: "Codex",
  capabilities: {
    interrupt: true,
    permissionModes: ["workspace-write"],
    resume: true,
    fork: false,
    slashCommands: false,
    models: true,
  },
  defaultPermissionMode: "workspace-write",
  models: staticModels,
};

/** A transport that answers the harness list at once and the model list when told to. */
function fakeTransport(listHarnessModels: (harnessId: string) => Promise<ModelInfo[]>): {
  asked: string[];
  transport: TransportService;
} {
  const asked: string[] = [];
  const transport = {
    listHarnesses: () => Promise.resolve([codex]),
    listSessions: () => Promise.resolve([]),
    listHarnessModels: (harnessId: string) => {
      asked.push(harnessId);
      return listHarnessModels(harnessId);
    },
  };
  // Only the three calls `refresh` makes are faked.
  return { asked, transport: transport as unknown as TransportService };
}

/** Lets the discovery the store started without awaiting settle. */
function settle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe("the composer's model list", () => {
  test("is what the runtime reported, once it has, and survives a refresh", async () => {
    const { asked, transport } = fakeTransport(() => Promise.resolve(discovered));
    const store = new ReactiveSessionsStore(transport);

    await store.refresh();
    await settle();
    expect(store.harnesses[0]?.models).toEqual(discovered);

    await store.refresh();
    await settle();
    expect(store.harnesses[0]?.models).toEqual(discovered);
    expect(asked).toEqual(["codex"]);
  });

  test("stays on the static list while the runtime cannot answer, and asks again", async () => {
    let failing = true;
    const { asked, transport } = fakeTransport(() =>
      failing ? Promise.reject(new Error("not logged in")) : Promise.resolve(discovered),
    );
    const store = new ReactiveSessionsStore(transport);

    await store.refresh();
    await settle();
    expect(store.harnesses[0]?.models).toEqual(staticModels);

    failing = false;
    await store.refresh();
    await settle();
    expect(store.harnesses[0]?.models).toEqual(discovered);
    expect(asked).toEqual(["codex", "codex"]);
  });
});

describe("availableModels", () => {
  /** An adapter whose runtime answers with the given listing. */
  function adapter(listModels?: () => Promise<ModelInfo[]>): HarnessAdapter {
    return {
      id: "codex",
      displayName: "Codex",
      capabilities: codex.capabilities,
      defaultPermissionMode: "workspace-write",
      models: staticModels,
      listModels,
      createSession: () => Promise.reject(new Error("not in this test")),
    };
  }

  test("answers with the runtime's list", async () => {
    expect(await availableModels(adapter(() => Promise.resolve(discovered)))).toEqual(discovered);
  });

  test("falls back to the static list when the runtime fails or cannot be asked", async () => {
    const failing = adapter(() => Promise.reject(new Error("codex is not installed")));
    expect(await availableModels(failing)).toEqual(staticModels);
    expect(await availableModels(adapter())).toEqual(staticModels);
  });
});
