<script lang="ts">
  /**
   * A picked workflow's parameters under the composer's text: everything but the
   * prompt, which is the text, and the picture, which is the card it was asked
   * from. The fields start at the workflow's defaults.
   */
  import type { ComposerTargetFormProps } from "@nib-ui/ui-contracts";
  import { findEntry, formParameters, formValues, sourceImage } from "./composer-target";
  import { initialValues } from "./form";
  import ParameterField from "./ParameterField.svelte";
  import { comfyPluginState } from "./store.svelte";

  const { optionId, context, values, onchange }: ComposerTargetFormProps = $props();

  const IMAGE_FILE = /\.(png|jpe?g|webp|gif|bmp)$/i;

  const store = $derived(comfyPluginState.store);
  const host = $derived(comfyPluginState.host);
  const entry = $derived.by(() => {
    if (!store) return null;
    return findEntry(store.cachedLibrary(context.cwd), optionId);
  });
  const parameters = $derived.by(() => {
    if (!entry) return [];
    return formParameters(entry.manifest, context);
  });
  const shown = $derived.by(() => {
    if (!entry) return {};
    return { ...initialValues(entry.manifest, sourceImage(context)), ...formValues(values) };
  });
  const needsImagePicker = $derived(parameters.some((parameter) => parameter.kind === "image"));

  let imagePaths = $state<string[]>([]);

  $effect(() => {
    if (!needsImagePicker) return;
    void loadImages(context.cwd);
  });

  /** The vault's pictures, for an image parameter no card filled. */
  async function loadImages(cwd: string): Promise<void> {
    if (!host || cwd.length === 0) return;
    const vault = await host.transport.loadVault(cwd, { previewChars: 0 });
    imagePaths = vault.items.map((item) => item.path).filter((path) => IMAGE_FILE.test(path));
  }

  /** Sets one field, keeping the others. */
  function setValue(id: string, value: string | number | boolean): void {
    onchange({ ...values, [id]: value });
  }
</script>

{#if entry && parameters.length > 0}
  <div class="grid grid-cols-2 gap-3 px-1 text-xs" data-testid="composer-workflow-form">
    {#each parameters as parameter (parameter.id)}
      <ParameterField
        {parameter}
        value={shown[parameter.id]}
        onchange={(value) => setValue(parameter.id, value)}
        {imagePaths}
        imageUrl={(path) => host?.transport.vaultFileUrl(context.cwd, path) ?? ""}
      />
    {/each}
  </div>
{/if}
