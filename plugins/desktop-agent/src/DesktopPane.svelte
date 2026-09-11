<script lang="ts">
  import { Button, Card, ListRow, SectionHeader, StatusBadge } from "@neoworks-dev/ui";
  import type { DesktopCapabilities, PaneProps, SidecarStatus } from "@nib-ui/ui-contracts";
  import MonitorIcon from "phosphor-svelte/lib/MonitorIcon";
  import { sortForReading } from "./prompt";
  import { describeRegion } from "./regions";
  import { applicationName, desktopState } from "./state.svelte";

  const _props: PaneProps = $props();

  /** What the send sheet is holding, keyed by capture. Empty until one is opened. */
  let sending = $state<string | null>(null);
  let prompt = $state("");

  const capabilities = $derived(desktopState.capabilities);
  const sidecar = $derived(desktopState.sidecar);
  const captures = $derived(desktopState.captures);
  const decision = $derived(desktopState.focusedDecision);
  const focusedName = $derived(applicationName(desktopState.focused));

  const sidecarTones: Record<SidecarStatus, "green" | "amber" | "red" | "neutral"> = {
    ready: "green",
    starting: "amber",
    failed: "red",
    stopped: "neutral",
  };

  const policyTones = { allow: "green", ask: "amber", deny: "red" } as const;

  /**
   * `unavailable` is neutral rather than red: a machine without layer-shell or without a
   * cursor source is not broken, and the note beside it says what that costs.
   */
  function tone(strategy: string): "green" | "neutral" {
    return strategy === "unavailable" ? "neutral" : "green";
  }

  function rows(report: DesktopCapabilities) {
    return [
      { title: "Capture", subtitle: "Taking a screenshot of the desktop.", value: report.capture },
      {
        title: "Overlay",
        subtitle: "Drawing highlights above other windows.",
        value: report.overlay,
      },
      {
        title: "Focused application",
        subtitle: "Which application a capture belongs to.",
        value: report.focus,
      },
      {
        title: "Pointer",
        subtitle: "Where the cursor is, for an overlay that follows it.",
        value: report.pointer,
      },
    ];
  }

  function describeRequest(request: { mode: string }): string {
    if (request.mode === "window") return "the focused window";
    if (request.mode === "region") return "a region of the screen";
    return "the whole screen";
  }

  function openSend(captureId: string): void {
    sending = captureId;
    prompt = "";
  }

  async function send(): Promise<void> {
    const captureId = sending;
    if (!captureId) return;
    const sessionId = await desktopState.sendToHarness(captureId, prompt);
    if (sessionId) sending = null;
  }
</script>

<div class="flex h-full min-h-0 flex-col">
  <header class="flex items-center gap-2 border-b border-line px-4 py-3">
    <MonitorIcon size={16} />
    <h2 class="text-sm font-semibold">Desktop</h2>
    {#if desktopState.armed}
      <StatusBadge tone="amber">armed {desktopState.armedSeconds}s</StatusBadge>
    {/if}
  </header>

  <div class="min-h-0 flex-1 space-y-5 overflow-y-auto p-4">
    {#if desktopState.error}
      <Card padding="sm">
        <p class="text-xs text-amber">{desktopState.error}</p>
      </Card>
    {/if}

    {#if desktopState.notice}
      <Card padding="sm">
        <p class="text-xs text-dim">{desktopState.notice}</p>
      </Card>
    {/if}

    {#if desktopState.pending}
      {@const request = desktopState.pending.request}
      <section class="space-y-2">
        <SectionHeader title="Confirm" />
        <Card padding="sm" class="space-y-2">
          <p class="text-xs text-dim">
            Capture {describeRequest(request)}{focusedName ? `, with ${focusedName} in front` : ""}?
            The picture goes on the board and is not sent anywhere until you send it.
          </p>
          <div class="flex items-center gap-3">
            <Button size="sm" onclick={() => desktopState.resolvePending(true)}>Capture</Button>
            <Button size="sm" variant="ghost" onclick={() => desktopState.resolvePending(false)}
              >Cancel</Button
            >
          </div>
        </Card>
      </section>
    {/if}

    <section class="space-y-2">
      <SectionHeader title="Capture" />
      <Card padding="sm" class="space-y-2">
        <ListRow
          title={focusedName ?? "Nothing identified"}
          subtitle={desktopState.focused?.title ??
            "The compositor did not name the focused window."}
        >
          {#snippet trailing()}
            <StatusBadge tone={policyTones[decision.policy]}>{decision.policy}</StatusBadge>
          {/snippet}
        </ListRow>
      </Card>

      <div class="flex flex-wrap items-center gap-3 px-1">
        <Button
          size="sm"
          disabled={!desktopState.canCapture || desktopState.busy}
          onclick={() => desktopState.capture({ mode: "screen" })}
        >
          Whole screen
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={!desktopState.canCapture ||
            desktopState.busy ||
            capabilities?.focus === "unavailable"}
          onclick={() => desktopState.capture({ mode: "window" })}
        >
          Focused window
        </Button>
        {#if desktopState.armed}
          <Button size="sm" variant="ghost" onclick={() => desktopState.disarm()}>Disarm</Button>
        {:else}
          <Button
            size="sm"
            variant="ghost"
            disabled={!desktopState.canCapture}
            onclick={() => desktopState.arm(5)}
          >
            Arm for 5 min
          </Button>
        {/if}
      </div>
      {#if desktopState.captureBlocker}
        <p class="px-1 text-2xs text-faint">{desktopState.captureBlocker}</p>
      {:else}
        <p class="px-1 text-2xs text-faint">
          A capture lands on the board. From there: <strong>Find elements</strong> to locate the
          controls in it,
          <strong>Show on screen</strong> to draw them on the desktop,
          <strong>Send to harness…</strong> to ask a model about it. Nothing leaves this machine until
          you send it.
        </p>
      {/if}
    </section>

    {#if captures.length > 0}
      <section class="space-y-2">
        <SectionHeader title="Captures on this board" />
        {#each captures as capture (capture.id)}
          <Card padding="sm" class="space-y-2">
            <ListRow
              title={applicationName(capture.regions.application ?? null) ??
                "Unidentified application"}
              subtitle={capture.regions.regions.length > 0
                ? `${capture.regions.regions.length} elements found`
                : "Not looked at yet"}
            >
              {#snippet trailing()}
                <StatusBadge tone={capture.regions.regions.length > 0 ? "green" : "neutral"}>
                  {capture.regions.imageWidth}×{capture.regions.imageHeight}
                </StatusBadge>
              {/snippet}
            </ListRow>

            {@const blocker = desktopState.overlayBlocker(capture.id)}
            <div class="flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                variant="ghost"
                disabled={desktopState.busy}
                onclick={() => desktopState.detect(capture.id)}
              >
                Find elements
              </Button>
              {#if desktopState.overlaid === capture.id}
                <Button size="sm" variant="ghost" onclick={() => desktopState.hideOverlay()}
                  >Hide overlay</Button
                >
              {:else}
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={blocker !== null}
                  onclick={() => desktopState.showOverlay(capture.id)}
                >
                  Show on screen
                </Button>
              {/if}
              <Button size="sm" variant="ghost" onclick={() => openSend(capture.id)}
                >Send to harness…</Button
              >
            </div>
            {#if blocker}
              <p class="text-2xs text-faint">{blocker}</p>
            {/if}

            {#if sending === capture.id}
              <div class="space-y-2 border-t border-line pt-2">
                <p class="text-2xs text-faint">
                  This is the last point of refusal. The picture below, these elements and this text
                  are what leaves the machine.
                </p>
                <textarea
                  bind:value={prompt}
                  rows="3"
                  placeholder="What should the harness do with this?"
                  class="w-full rounded border border-line bg-raised p-2 text-xs"></textarea>

                {#if capture.regions.regions.length > 0}
                  <ul class="max-h-32 space-y-0.5 overflow-y-auto text-2xs text-dim">
                    {#each sortForReading(capture.regions.regions).slice(0, 12) as region (region.id)}
                      <li>{region.sensitive ? "redacted field" : describeRegion(region)}</li>
                    {/each}
                  </ul>
                {/if}

                <div class="flex items-center gap-3">
                  <Button size="sm" disabled={desktopState.busy} onclick={send}>Send</Button>
                  <Button size="sm" variant="ghost" onclick={() => (sending = null)}>Cancel</Button>
                </div>
              </div>
            {/if}
          </Card>
        {/each}
      </section>
    {/if}

    <section class="space-y-2">
      <SectionHeader title="Sidecar" />
      <Card padding="sm" class="space-y-2">
        <ListRow
          title="nib-overlay"
          subtitle={sidecar.detail ?? "The native process that talks to the compositor."}
        >
          {#snippet trailing()}
            <StatusBadge tone={sidecarTones[sidecar.status]}>{sidecar.status}</StatusBadge>
          {/snippet}
        </ListRow>
      </Card>

      <div class="flex items-center gap-3 px-1">
        <Button
          size="sm"
          variant="ghost"
          disabled={!desktopState.available || desktopState.busy}
          onclick={() => desktopState.start()}
        >
          {sidecar.status === "ready" ? "Restart" : "Start"}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={!desktopState.available || desktopState.busy || sidecar.status === "stopped"}
          onclick={() => desktopState.stop()}
        >
          Stop
        </Button>
      </div>
    </section>

    {#if capabilities}
      <section class="space-y-2">
        <SectionHeader title="Capabilities" />
        <Card padding="sm" class="space-y-2">
          {#each rows(capabilities) as row (row.title)}
            <ListRow title={row.title} subtitle={row.subtitle}>
              {#snippet trailing()}
                <StatusBadge tone={tone(row.value)}>{row.value}</StatusBadge>
              {/snippet}
            </ListRow>
          {/each}
        </Card>

        <p class="px-1 text-2xs text-faint">
          {capabilities.compositor ?? "An unnamed compositor"} on a {capabilities.sessionType} session.
        </p>
      </section>

      {#if capabilities.notes.length > 0}
        <section class="space-y-2">
          <SectionHeader title="Why something is missing" />
          <Card padding="sm" class="space-y-1">
            {#each capabilities.notes as note, index (index)}
              <p class="text-xs text-dim">{note}</p>
            {/each}
          </Card>
        </section>
      {/if}
    {/if}
  </div>
</div>
