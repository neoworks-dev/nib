<script lang="ts">
  import { type IconComponent, Tooltip } from "@neoworks-dev/ui";

  type Tone = "primary" | "danger";
  type IconWeight = "bold" | "fill";

  const {
    icon: Icon,
    iconWeight = "bold",
    label,
    shortcut,
    tone = "primary",
    disabled = false,
    onclick,
  }: {
    icon: IconComponent;
    /** Bold by default, like the design system's buttons; a stop square reads better filled. */
    iconWeight?: IconWeight;
    /** The accessible name, and the tooltip's text: the button shows only its icon. */
    label: string;
    /** The key that does the same, named in the tooltip after the label. */
    shortcut?: string;
    tone?: Tone;
    disabled?: boolean;
    onclick: () => void;
  } = $props();

  // Tones follow `Button` from @neoworks-dev/ui, so the round button reads as the same family.
  const toneClasses: Record<Tone, string> = {
    primary: "bg-action text-action-fg border-transparent hover:opacity-90",
    danger: "bg-red-soft text-red border-red/30 hover:bg-red/20",
  };

  let pressed = $state(false);

  /** The tooltip names the action, then its key when it has one. */
  function tooltipText(): string {
    if (shortcut === undefined) return label;
    return `${label} · ${shortcut}`;
  }

  /** Presses in on pointer down, as the design system's buttons do. */
  function press(): void {
    if (!disabled) pressed = true;
  }

  /** Springs back once the pointer lets go or leaves. */
  function release(): void {
    pressed = false;
  }
</script>

<Tooltip text={tooltipText()} {disabled}>
  <button
    type="button"
    aria-label={label}
    {disabled}
    {onclick}
    onpointerdown={press}
    onpointerup={release}
    onpointerleave={release}
    onpointercancel={release}
    style:transform="scale({pressed ? 0.9 : 1})"
    class="inline-flex size-8 shrink-0 items-center justify-center rounded-full border transition-[transform,background-color,opacity] duration-150 ease-[cubic-bezier(0.34,1.45,0.64,1)] select-none disabled:cursor-not-allowed disabled:opacity-30 {toneClasses[
      tone
    ]}"
  >
    <Icon size={16} weight={iconWeight} />
  </button>
</Tooltip>
