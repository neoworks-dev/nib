<script lang="ts">
	import { Button } from '@neoworks-dev/ui';
	import ArrowLeftIcon from 'phosphor-svelte/lib/ArrowLeftIcon';
	import ArrowRightIcon from 'phosphor-svelte/lib/ArrowRightIcon';
	import ArrowsClockwiseIcon from 'phosphor-svelte/lib/ArrowsClockwiseIcon';
	import GlobeIcon from 'phosphor-svelte/lib/GlobeIcon';
	import PlusIcon from 'phosphor-svelte/lib/PlusIcon';
	import XIcon from 'phosphor-svelte/lib/XIcon';
	import type { PaneProps } from '@nib-ui/ui-contracts';
	import { maxTabCount, webBrowserState } from './state.svelte';

	// The browser is session-independent, but the pane contract still types the props.
	const {}: PaneProps = $props();

	let addressDraft = $state('');
	let reloadNonces = $state<Record<string, number>>({});

	const activeTab = $derived(webBrowserState.activeTab);
	const canGoBack = $derived((activeTab?.historyIndex ?? 0) > 0);
	const canGoForward = $derived(activeTab !== null && activeTab.historyIndex < activeTab.history.length - 1);

	$effect(() => {
		addressDraft = webBrowserState.activeTab?.url ?? '';
	});

	function submitAddress(event: SubmitEvent) {
		event.preventDefault();
		if (!activeTab) return;
		webBrowserState.navigate(activeTab.id, addressDraft);
	}

	function reload() {
		if (!activeTab) return;
		reloadNonces[activeTab.id] = (reloadNonces[activeTab.id] ?? 0) + 1;
	}
</script>

<div aria-label="Web browser" class="flex h-full min-h-0 flex-col">
		<div class="flex items-center gap-1 border-b border-line bg-raised px-2 py-1.5">
			{#each webBrowserState.tabs as tab (tab.id)}
				<div
					class="flex min-w-0 max-w-48 flex-1 items-center gap-1.5 rounded-md border px-2 py-1 {tab.id ===
					webBrowserState.activeId
						? 'border-line-strong bg-elevated'
						: 'border-transparent hover:bg-hover'}"
				>
					<button
						type="button"
						class="flex min-w-0 flex-1 items-center gap-1.5 text-left"
						onclick={() => (webBrowserState.activeId = tab.id)}
					>
						<GlobeIcon size={12} class="shrink-0 text-faint" />
						<span class="truncate text-2xs text-default">{tab.title || 'New tab'}</span>
					</button>
					<button
						type="button"
						class="shrink-0 text-faint hover:text-default"
						aria-label="Close {tab.title || 'new'} tab"
						onclick={() => webBrowserState.close(tab.id)}
					>
						<XIcon size={12} />
					</button>
				</div>
			{/each}
			<button
				type="button"
				class="shrink-0 rounded-md p-1 text-dim hover:bg-hover hover:text-default disabled:opacity-30"
				aria-label="New tab"
				disabled={webBrowserState.tabs.length >= maxTabCount}
				onclick={() => webBrowserState.openTab()}
			>
				<PlusIcon size={14} />
			</button>
			<button
				type="button"
				class="ml-auto shrink-0 pl-2 text-dim hover:text-default"
				aria-label="Close the browser panel"
				onclick={() => webBrowserState.toggle(false)}
			>
				<XIcon size={16} />
			</button>
		</div>

		<div class="flex items-center gap-1.5 border-b border-line px-2 py-1.5">
			<Button
				size="sm"
				variant="ghost"
				icon={ArrowLeftIcon}
				disabled={!canGoBack}
				onclick={() => activeTab && webBrowserState.back(activeTab.id)}
			>
				<span class="sr-only">Back</span>
			</Button>
			<Button
				size="sm"
				variant="ghost"
				icon={ArrowRightIcon}
				disabled={!canGoForward}
				onclick={() => activeTab && webBrowserState.forward(activeTab.id)}
			>
				<span class="sr-only">Forward</span>
			</Button>
			<Button size="sm" variant="ghost" icon={ArrowsClockwiseIcon} disabled={!activeTab?.url} onclick={reload}>
				<span class="sr-only">Reload</span>
			</Button>
			<form class="min-w-0 flex-1" onsubmit={submitAddress}>
				<input
					bind:value={addressDraft}
					type="text"
					spellcheck="false"
					autocapitalize="off"
					autocomplete="off"
					aria-label="Address"
					placeholder="Search or enter address"
					disabled={!activeTab}
					class="h-9 w-full rounded-md border border-line bg-input px-3 font-mono text-xs text-default placeholder:text-faint focus:border-line-strong focus:outline-none disabled:opacity-30"
				/>
			</form>
		</div>

		<div class="relative min-h-0 flex-1">
			{#each webBrowserState.tabs as tab (tab.id)}
				{#if tab.url}
					<div class="absolute inset-0" class:hidden={tab.id !== webBrowserState.activeId}>
						{#key `${tab.url}#${reloadNonces[tab.id] ?? 0}`}
							<!-- `allow-same-origin` is required for cookie-bound sites to render at all; combined
							     with `allow-scripts` a framed page can drop its own sandbox, so only user-typed
							     URLs ever reach this element. The white base is for the foreign document, which
							     usually assumes a light canvas — it is deliberately not a design token. -->
							<iframe
								src={tab.url}
								title="Browser tab: {tab.title || tab.url}"
								sandbox="allow-scripts allow-forms allow-popups allow-same-origin"
								referrerpolicy="no-referrer"
								class="h-full w-full border-0 bg-white"
							></iframe>
						{/key}
					</div>
				{/if}
			{/each}

			{#if !activeTab || activeTab.url.length === 0}
				<div class="absolute inset-0 flex flex-col items-center justify-center gap-2 text-dim">
					<GlobeIcon size={28} />
					<p class="text-xs">Type a URL or a search phrase in the address bar.</p>
				</div>
			{/if}
		</div>

		<footer class="flex items-center gap-3 border-t border-line px-3 py-1.5 text-2xs text-faint">
			<span class="min-w-0 flex-1 truncate font-mono">{activeTab?.url || 'No page loaded'}</span>
			<span class="shrink-0">Some sites refuse to be embedded.</span>
			{#if activeTab?.url}
				<a
					href={activeTab.url}
					target="_blank"
					rel="noreferrer"
					class="shrink-0 text-dim underline underline-offset-2 hover:text-default"
				>
					Open in a new tab
				</a>
			{/if}
		</footer>
	</div>
