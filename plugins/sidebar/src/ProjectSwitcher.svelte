<script lang="ts">
  /**
   * The project switcher in the floating toolbar: one button naming the board on
   * screen, and behind it the projects on disk with the workstreams under each
   * that still want attention. The list is the sidebar's, folded into a menu so
   * the board has the whole window.
   *
   * `@neoworks-dev/ui` has no menu or popover primitive; `Select` is a form
   * control bound to a value, and this is a list of places to go with rows that
   * carry badges and their own actions.
   */
  import { StatusBadge } from "@neoworks-dev/ui";
  import { desktopBridge, type SlotProps, statusLabel, statusTone } from "@nib-ui/ui-contracts";
  import CaretUpDownIcon from "phosphor-svelte/lib/CaretUpDownIcon";
  import CheckIcon from "phosphor-svelte/lib/CheckIcon";
  import FolderOpenIcon from "phosphor-svelte/lib/FolderOpenIcon";
  import DirectoryPicker from "./DirectoryPicker.svelte";
  import type { WorkstreamRow } from "./projects";
  import { sidebarState } from "./state.svelte";
  import WorkspaceBadge from "./WorkspaceBadge.svelte";

  // A slot component is typed by its slot and handed the open session; the list
  // follows the board index and the session store instead, so none of it is read.
  // oxlint-disable-next-line no-empty-pattern
  const {}: SlotProps = $props();

  let open = $state(false);
  let picking = $state(false);
  let draft = $state("");

  const projects = $derived(sidebarState.projects);
  const openPath = $derived(sidebarState.openPath);
  const current = $derived(projects.find((project) => project.path === openPath) ?? null);
  const recent = $derived(sidebarState.sessions?.recentDirectories ?? []);

  function close(): void {
    open = false;
    picking = false;
    draft = "";
  }

  /** Native chooser when the desktop shell is there; the typed picker is the fallback. */
  async function browse(): Promise<void> {
    const bridge = desktopBridge();
    if (!bridge) {
      picking = !picking;
      draft = "";
      return;
    }
    const picked = await bridge.pickDirectory(openPath || undefined);
    if (picked) {
      close();
      await sidebarState.open(picked);
    }
  }

  async function submit(path: string): Promise<void> {
    close();
    await sidebarState.open(path.replace(/(.)\/+$/, "$1"));
  }

  async function go(path: string): Promise<void> {
    close();
    await sidebarState.open(path);
  }

  async function goWorkstream(row: WorkstreamRow): Promise<void> {
    close();
    await sidebarState.openWorkstream(row);
  }

  /** A workstream that is doing something says so; an idle one is just a row. */
  function badge(
    row: WorkstreamRow,
  ): { tone: ReturnType<typeof statusTone>; label: string } | null {
    if (!row.status) return { tone: "neutral", label: "Not started" };
    const label = statusLabel(row.status);
    return label ? { tone: statusTone(row.status), label } : null;
  }

  function onKeydown(event: KeyboardEvent): void {
    if (event.key === "Escape" && open) close();
  }
</script>

<svelte:window onkeydown={onKeydown} />

<div class="relative">
  <button
    type="button"
    class="flex max-w-56 items-center gap-2 rounded-lg px-2 py-1 text-left text-sm text-neutral-100 transition-colors hover:bg-white/10"
    aria-haspopup="menu"
    aria-expanded={open}
    aria-label="Switch project"
    title={openPath}
    onclick={() => (open ? close() : (open = true))}
  >
    {#if current}
      <WorkspaceBadge path={current.path} name={current.name} />
      <span class="min-w-0 flex-1 truncate">{current.name}</span>
    {:else}
      <span class="text-neutral-400"><FolderOpenIcon size={17} /></span>
      <span class="truncate text-neutral-400">Open a project</span>
    {/if}
    <span class="text-neutral-400"><CaretUpDownIcon size={14} /></span>
  </button>

  {#if open}
    <button
      type="button"
      class="fixed inset-0 z-overlay cursor-default"
      aria-label="Close the project list"
      onclick={close}
    ></button>
    <div
      class="absolute top-full left-0 z-overlay mt-2 flex max-h-[60vh] w-[320px] flex-col overflow-hidden rounded-xl border border-line bg-elevated shadow-lg"
      role="menu"
    >
      <div class="flex items-center gap-1 px-2 py-2">
        <span class="px-1 text-xs font-medium text-dim">Projects</span>
        <button
          type="button"
          class="ml-auto rounded-md p-1 text-faint hover:bg-hover hover:text-default"
          aria-label="Open a project folder"
          aria-pressed={picking}
          onclick={browse}
        >
          <FolderOpenIcon size={15} />
        </button>
      </div>

      {#if picking}
        <div class="px-2 pb-2">
          <DirectoryPicker
            value={draft}
            {recent}
            onChange={(value) => (draft = value)}
            onSubmit={submit}
          />
        </div>
      {/if}

      {#if sidebarState.error}
        <p class="px-3 pb-2 text-2xs text-red">{sidebarState.error}</p>
      {/if}

      <div class="min-h-0 flex-1 overflow-y-auto px-1.5 pb-2">
        {#each projects as project (project.path)}
          <section class="mb-1">
            <button
              type="button"
              role="menuitem"
              class="flex w-full items-center gap-2 rounded-lg px-1.5 py-1.5 text-left"
              class:bg-hover={project.path === openPath}
              class:text-default={project.path === openPath}
              class:text-muted={project.path !== openPath}
              class:hover:bg-hover={project.path !== openPath}
              class:hover:text-default={project.path !== openPath}
              onclick={() => go(project.path)}
              title={project.path}
            >
              <WorkspaceBadge path={project.path} name={project.name} />
              <span class="min-w-0 flex-1 truncate text-sm">{project.name}</span>
              {#if project.activeCount > 0}
                <StatusBadge tone="blue">{project.activeCount}</StatusBadge>
              {/if}
            </button>

            {#if project.workstreams.length > 0}
              <ul class="ml-3 border-l border-line pl-1.5">
                {#each project.workstreams as row (row.id)}
                  {@const tag = badge(row)}
                  <li class="group flex items-center gap-1">
                    <button
                      type="button"
                      role="menuitem"
                      class="min-w-0 flex-1 truncate rounded-md px-1.5 py-1 text-left text-xs text-dim hover:bg-hover hover:text-default"
                      onclick={() => goWorkstream(row)}
                      title={row.title}
                    >
                      {row.title}
                    </button>
                    {#if tag}
                      <StatusBadge tone={tag.tone}>{tag.label}</StatusBadge>
                    {/if}
                    {#if !row.active}
                      <button
                        type="button"
                        class="rounded-md p-1 text-faint opacity-0 group-hover:opacity-100 hover:bg-hover hover:text-default"
                        aria-label="Mark reviewed"
                        title="Mark reviewed"
                        onclick={() => sidebarState.review(row, true)}
                      >
                        <CheckIcon size={12} />
                      </button>
                    {/if}
                  </li>
                {/each}
              </ul>
            {/if}
          </section>
        {:else}
          <p class="px-2.5 py-3 text-xs text-dim">No projects yet — open a folder to start one.</p>
        {/each}
      </div>
    </div>
  {/if}
</div>
