<script lang="ts">
	import { Button, portal } from '@neoworks-dev/ui';
	import type { HarnessSwitchConfirmation } from './harness-switch';

	const {
		confirmation,
		busy = false,
		onConfirm,
		onCancel,
	}: {
		confirmation: HarnessSwitchConfirmation;
		busy?: boolean;
		onConfirm: () => void;
		onCancel: () => void;
	} = $props();
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<!-- Portalled: the pane it is asked from is a stacking context of its own, and a
     confirmation has to sit over the whole window rather than over one pane. -->
<div
	use:portal
	class="fixed inset-0 z-modal flex items-center justify-center bg-black/50 p-6"
	onclick={(event) => event.target === event.currentTarget && onCancel()}
	onkeydown={(event) => event.key === 'Escape' && onCancel()}
>
	<div
		role="alertdialog"
		aria-modal="true"
		aria-label={confirmation.title}
		class="flex w-[520px] max-w-full flex-col gap-2.5 rounded-2xl border border-line bg-elevated px-4 py-3.5"
	>
		<h2 class="text-xs font-medium text-default">{confirmation.title}</h2>
		<p class="whitespace-pre-line text-2xs leading-relaxed text-muted">{confirmation.body}</p>

		<div class="flex items-center justify-end gap-2">
			<Button size="sm" variant="ghost" disabled={busy} onclick={onCancel}>{confirmation.cancelLabel}</Button>
			<Button size="sm" variant="primary" disabled={busy} onclick={onConfirm}>{confirmation.confirmLabel}</Button>
		</div>
	</div>
</div>
