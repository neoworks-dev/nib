<script lang="ts">
  import { Button, Card, ListRow, SectionHeader, StatusBadge } from "@neoworks-dev/ui";
  import type { ComfyRun, SlotProps } from "@nib-ui/ui-contracts";
  import { describeRun, isActive } from "./runs";
  import { comfyPluginState } from "./store.svelte";

  const { session: _session }: SlotProps = $props();

  /** Runs listed under the connection; the rest are in the server's history. */
  const VISIBLE_RUNS = 5;

  const store = $derived(comfyPluginState.store);
  const status = $derived(store?.status ?? null);
  const runs = $derived((store?.runs ?? []).slice(0, VISIBLE_RUNS));

  let baseUrl = $state("");
  let saving = $state(false);
  let saveError = $state<string | null>(null);

  $effect(() => {
    if (status) baseUrl = status.baseUrl;
  });

  /** Saves the address and checks it. */
  async function save(): Promise<void> {
    if (!store) return;
    saving = true;
    saveError = null;
    try {
      await store.configure(baseUrl.trim());
    } catch (cause) {
      saveError = cause instanceof Error ? cause.message : String(cause);
    } finally {
      saving = false;
    }
  }

  /** Asks again whether ComfyUI answers. */
  async function check(): Promise<void> {
    if (!store) return;
    await store.refreshStatus().catch(() => {});
  }

  /** The tone of a run's badge. */
  function runTone(run: ComfyRun): "green" | "red" | "blue" | "neutral" {
    if (run.status === "succeeded") return "green";
    if (run.status === "failed") return "red";
    if (isActive(run)) return "blue";
    return "neutral";
  }
</script>

<section class="space-y-2" data-testid="comfyui-settings">
  <SectionHeader title="ComfyUI" />
  <Card padding="sm" class="space-y-3">
    <div class="flex items-center gap-2">
      {#if status?.connected}
        <StatusBadge tone="green">Connected</StatusBadge>
        <span class="text-xs text-dim">ComfyUI {status.version ?? ""}</span>
      {:else if status}
        <StatusBadge tone="red">Not reachable</StatusBadge>
        <span class="truncate text-xs text-dim" title={status.error ?? ""}>{status.error}</span>
      {:else}
        <StatusBadge>Checking…</StatusBadge>
      {/if}
    </div>

    <!-- The design system has no text field; this matches the Pinterest section's. -->
    <label class="block space-y-1">
      <span class="text-2xs tracking-caps uppercase text-dim">Address</span>
      <input
        bind:value={baseUrl}
        type="url"
        spellcheck="false"
        autocomplete="off"
        placeholder="http://127.0.0.1:8188"
        class="h-9 w-full rounded-md border border-line bg-input px-3 font-mono text-xs text-default placeholder:text-faint focus:border-line-strong focus:outline-none"
      />
    </label>
    {#if saveError}
      <p class="text-xs text-red">{saveError}</p>
    {/if}

    <div class="flex gap-2">
      <Button
        size="sm"
        variant="primary"
        disabled={saving || baseUrl.trim().length === 0}
        onclick={save}
      >
        Save
      </Button>
      <Button size="sm" onclick={check}>Check again</Button>
    </div>
  </Card>

  {#if runs.length > 0}
    <div class="space-y-1" data-testid="comfyui-runs">
      {#each runs as run (run.id)}
        <ListRow title={run.id.slice(0, 8)} subtitle={describeRun(run)}>
          {#snippet trailing()}
            <div class="flex items-center gap-2">
              <StatusBadge tone={runTone(run)}>{run.status}</StatusBadge>
              {#if isActive(run)}
                <Button size="sm" variant="ghost" onclick={() => store?.cancel(run.id)}
                  >Cancel</Button
                >
              {/if}
            </div>
          {/snippet}
        </ListRow>
      {/each}
    </div>
  {/if}
</section>
