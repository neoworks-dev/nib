<script lang="ts">
  import type { IconComponent } from "@neoworks-dev/ui";
  import CaretUpDownIcon from "phosphor-svelte/lib/CaretUpDownIcon";
  import type { Snippet } from "svelte";

  let {
    open = $bindable(false),
    icon: Icon,
    iconTone = "faint",
    label,
    title,
    placement = "top",
    wide = false,
    children,
  }: {
    open?: boolean;
    icon?: IconComponent;
    /** A picked option's own icon reads at full strength; a stand-in icon stays faint. */
    iconTone?: "faint" | "muted";
    label: string;
    /** Tooltip for the pill, for what its short label leaves out. */
    title?: string;
    placement?: "top" | "bottom";
    /** A wider popover, for menus with more than one list in them. */
    wide?: boolean;
    /** The popover's contents. */
    children: Snippet;
  } = $props();
</script>

<div
  class="relative"
  onfocusout={(event) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) open = false;
  }}
>
  <button
    type="button"
    {title}
    class="flex items-center gap-1.5 rounded-full border border-line bg-raised px-2.5 py-1 text-xs text-muted transition-colors duration-fast hover:border-line-strong hover:text-default"
    onclick={() => (open = !open)}
  >
    {#if Icon}
      <span class={{ "text-muted": iconTone === "muted", "text-faint": iconTone === "faint" }}
        ><Icon size={12} /></span
      >
    {/if}
    <span class="max-w-64 truncate">{label}</span>
    <span class="text-faint"><CaretUpDownIcon size={12} /></span>
  </button>

  {#if open}
    <div
      data-placement={placement}
      class={[
        "pop-in absolute left-0 z-overlay flex flex-col gap-1 overflow-hidden rounded-xl border border-line-strong bg-raised p-1 shadow-xs",
        { "w-64": !wide, "w-80": wide },
        { "bottom-full mb-1": placement === "top", "top-full mt-1": placement === "bottom" },
      ]}
    >
      {@render children()}
    </div>
  {/if}
</div>

<style>
  /* Clipped reveal rather than a scale: the rows stay crisp while the panel
	   unfolds from the corner the trigger sits at. */
  .pop-in {
    animation: unfold-down 60ms ease-out;
  }

  .pop-in[data-placement="top"] {
    animation-name: unfold-up;
  }

  @keyframes unfold-down {
    from {
      opacity: 0;
      clip-path: inset(0 100% 100% 0 round 0.75rem);
    }
    to {
      opacity: 1;
      clip-path: inset(0 0 0 0 round 0.75rem);
    }
  }

  @keyframes unfold-up {
    from {
      opacity: 0;
      clip-path: inset(100% 100% 0 0 round 0.75rem);
    }
    to {
      opacity: 1;
      clip-path: inset(0 0 0 0 round 0.75rem);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .pop-in {
      animation: none;
    }
  }
</style>
