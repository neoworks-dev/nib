import type { HarnessAdapter, ModelInfo } from "@nib-ui/protocol";

/**
 * The models a harness takes right now: its runtime's own answer where the
 * adapter can ask for one, its static list when it cannot or the runtime fails
 * to answer (not installed, logged out, offline).
 */
export async function availableModels(adapter: HarnessAdapter): Promise<ModelInfo[]> {
  if (!adapter.listModels) return adapter.models;
  try {
    return await adapter.listModels();
  } catch {
    return adapter.models;
  }
}
