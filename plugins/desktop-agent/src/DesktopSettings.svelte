<script lang="ts">
  import { Button, Card, ListRow, SectionHeader, Select, StatusBadge } from "@neoworks-dev/ui";
  import type { SlotProps } from "@nib-ui/ui-contracts";
  import { type CapturePolicy, MATCH_LEVELS, type RoutingRule } from "./routing";
  import { applicationName, desktopState } from "./state.svelte";

  const _props: SlotProps = $props();

  const policies: CapturePolicy[] = ["allow", "ask", "deny"];
  const policyOptions = policies.map((policy) => ({ value: policy, label: policy }));
  const policyTones = { allow: "green", ask: "amber", deny: "red" } as const;

  const config = $derived(desktopState.routing);
  const decision = $derived(desktopState.focusedDecision);
  const focused = $derived(desktopState.focused);

  function describeMatch(rule: RoutingRule): string {
    const parts = MATCH_LEVELS.flatMap((level) => {
      if (level === "desktopEntry" && rule.match.desktopEntry)
        return [`desktop entry ${rule.match.desktopEntry}`];
      if (level === "appId" && rule.match.appId) return [`app id ${rule.match.appId}`];
      if (level === "atspiName" && rule.match.atspiName) return [`name ${rule.match.atspiName}`];
      return [];
    });
    return parts.join(", ") || "nothing";
  }

  async function update(index: number, patch: Partial<RoutingRule>): Promise<void> {
    const applications = config.applications.map((rule, position) =>
      position === index ? { ...rule, ...patch } : rule,
    );
    await desktopState.updateRouting({ ...config, applications });
  }

  async function remove(index: number): Promise<void> {
    const applications = config.applications.filter((_rule, position) => position !== index);
    await desktopState.updateRouting({ ...config, applications });
  }

  /**
   * A new rule is seeded from whatever has focus. Writing an `app_id` by hand means
   * knowing what the compositor calls the window, which is the one thing the user cannot
   * see and the one thing this pane already knows.
   */
  async function addForFocused(policy: CapturePolicy): Promise<void> {
    if (!focused?.appId && !focused?.desktopEntry && !focused?.atspiName) return;
    const rule: RoutingRule = {
      match: {
        ...(focused.desktopEntry && { desktopEntry: focused.desktopEntry }),
        ...(focused.appId && { appId: focused.appId }),
        ...(!focused.desktopEntry &&
          !focused.appId &&
          focused.atspiName && { atspiName: focused.atspiName }),
      },
      policy,
    };
    await desktopState.updateRouting({ ...config, applications: [rule, ...config.applications] });
  }

  async function setDefault(policy: string | string[]): Promise<void> {
    if (Array.isArray(policy)) return;
    const chosen = policies.find((entry) => entry === policy);
    if (chosen)
      await desktopState.updateRouting({
        ...config,
        default: { ...config.default, policy: chosen },
      });
  }
</script>

<section class="space-y-2">
  <SectionHeader title="Desktop capture" />
  <Card padding="sm" class="space-y-2">
    <ListRow
      title="Unknown applications"
      subtitle="What happens for an application with no rule of its own."
    >
      {#snippet trailing()}
        <div class="w-32">
          <Select value={config.default.policy} options={policyOptions} onChange={setDefault} />
        </div>
      {/snippet}
    </ListRow>

    <ListRow
      title={applicationName(focused) ?? "Nothing identified"}
      subtitle={decision.matchedBy
        ? `Matched on ${decision.matchedBy}.`
        : "No rule matches; the default applies."}
    >
      {#snippet trailing()}
        <StatusBadge tone={policyTones[decision.policy]}>{decision.policy}</StatusBadge>
      {/snippet}
    </ListRow>
  </Card>

  {#if focused}
    <div class="flex items-center gap-3 px-1">
      <Button size="sm" variant="ghost" onclick={() => addForFocused("allow")}
        >Always allow this app</Button
      >
      <Button size="sm" variant="ghost" onclick={() => addForFocused("deny")}
        >Never capture this app</Button
      >
    </div>
  {/if}
</section>

{#if config.applications.length > 0}
  <section class="space-y-2">
    <SectionHeader title="Application rules" />
    <Card padding="sm" class="space-y-2">
      {#each config.applications as rule, index (index)}
        <ListRow
          title={rule.match.desktopEntry ??
            rule.match.appId ??
            rule.match.atspiName ??
            "Matches nothing"}
          subtitle={`${describeMatch(rule)}${rule.harnessId ? ` — ${rule.harnessId}` : ""}`}
        >
          {#snippet trailing()}
            <div class="flex items-center gap-2">
              <div class="w-28">
                <Select
                  value={rule.policy}
                  options={policyOptions}
                  onChange={(value) => {
                    const chosen = policies.find((entry) => entry === value);
                    if (chosen) void update(index, { policy: chosen });
                  }}
                />
              </div>
              <Button size="sm" variant="ghost" onclick={() => remove(index)}>Remove</Button>
            </div>
          {/snippet}
        </ListRow>
      {/each}
    </Card>
    <p class="px-1 text-2xs text-faint">
      More specific wins: desktop entry, then app id, then name. A deny outranks every allow,
      wherever it sits in this list. Stored in ~/.config/nib/desktop-agent.json.
    </p>
  </section>
{/if}
