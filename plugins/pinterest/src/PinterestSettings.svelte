<script lang="ts">
  import { Button, Card, ListRow, SectionHeader } from "@neoworks-dev/ui";
  import type { SlotProps } from "@nib-ui/ui-contracts";
  import { pinterestState } from "./state.svelte";

  const { session: _session }: SlotProps = $props();

  const status = $derived(pinterestState.status);

  let appId = $state("");
  let appSecret = $state("");
  let redirectUri = $state("");

  $effect(() => {
    void pinterestState.load();
    return pinterestState.watchConnection();
  });

  $effect(() => {
    // The secret is never sent back to the browser, so only the fields the server
    // reports are filled in again after a reload.
    appId = status?.appId ?? "";
    redirectUri = status?.redirectUri ?? "";
  });

  const canSave = $derived(
    appId.trim().length > 0 && appSecret.trim().length > 0 && redirectUri.trim().length > 0,
  );

  async function save(): Promise<void> {
    await pinterestState.configure({
      appId: appId.trim(),
      appSecret: appSecret.trim(),
      redirectUri: redirectUri.trim(),
    });
    appSecret = "";
  }

  const connectionSubtitle = $derived.by(() => {
    if (!status?.configured) return "Register an app in the Pinterest developer console first.";
    if (status.connected) return `Connected with ${status.scope ?? "no scopes reported"}.`;
    return "The app is configured but no account has authorized it yet.";
  });
</script>

<section class="space-y-2">
  <SectionHeader title="Pinterest" />
  <Card padding="sm" class="space-y-3">
    <!--
      The design system has no text field, and the three values here are a plain
      form rather than a setting to pick from a list, so `Select` and `ListRow`
      cannot carry them. The input styling matches the browser pane's address bar.
    -->
    <label class="block space-y-1">
      <span class="text-2xs tracking-caps uppercase text-dim">App ID</span>
      <input
        bind:value={appId}
        type="text"
        spellcheck="false"
        autocomplete="off"
        class="h-9 w-full rounded-md border border-line bg-input px-3 font-mono text-xs text-default placeholder:text-faint focus:border-line-strong focus:outline-none"
      />
    </label>

    <label class="block space-y-1">
      <span class="text-2xs tracking-caps uppercase text-dim">App secret</span>
      <input
        bind:value={appSecret}
        type="password"
        spellcheck="false"
        autocomplete="off"
        placeholder={status?.configured ? "Stored — type to replace" : ""}
        class="h-9 w-full rounded-md border border-line bg-input px-3 font-mono text-xs text-default placeholder:text-faint focus:border-line-strong focus:outline-none"
      />
    </label>

    <label class="block space-y-1">
      <span class="text-2xs tracking-caps uppercase text-dim">Redirect URI</span>
      <input
        bind:value={redirectUri}
        type="text"
        spellcheck="false"
        autocomplete="off"
        placeholder="https://…/api/pinterest/callback"
        class="h-9 w-full rounded-md border border-line bg-input px-3 font-mono text-xs text-default placeholder:text-faint focus:border-line-strong focus:outline-none"
      />
    </label>

    <p class="text-2xs text-faint">
      Must match the redirect registered for the app exactly. Pinterest requires https, so a plain
      http dev server needs a tunnel in front of it.
    </p>

    <div class="flex gap-2">
      <Button size="sm" disabled={!canSave} onclick={() => void save()}>Save app</Button>
      <Button
        size="sm"
        variant="ghost"
        disabled={!status?.configured}
        onclick={() => pinterestState.connect()}
      >
        {status?.connected ? "Reconnect" : "Connect account"}
      </Button>
      {#if status?.connected}
        <Button size="sm" variant="ghost" onclick={() => void pinterestState.disconnect()}>
          Disconnect
        </Button>
      {/if}
    </div>

    <ListRow title="Connection" subtitle={connectionSubtitle} />

    {#if pinterestState.error}
      <p class="text-2xs text-red">{pinterestState.error}</p>
    {/if}
  </Card>
</section>
