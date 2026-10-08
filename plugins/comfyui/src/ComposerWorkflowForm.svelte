<script lang="ts">
  /**
   * A picked workflow's parameters as pills beside the composer's workflow pill:
   * everything but the prompt, which is the text, and the picture, which is the
   * card it was asked from. They start at the workflow's defaults.
   */
  import type { ComposerTargetFormProps } from "@nib-ui/ui-contracts";
  import { findEntry, formParameters, formValues, sourceImage } from "./composer-target";
  import { initialValues } from "./form";
  import { sizePair } from "./parameter-pills";
  import ParameterPill from "./ParameterPill.svelte";
  import SizePill from "./SizePill.svelte";
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
  const size = $derived(sizePair(parameters));
  /** The parameters with a pill of their own; width and height share the size pill. */
  const single = $derived(
    parameters.filter((parameter) => parameter !== size?.width && parameter !== size?.height),
  );
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

  /** Sets width and height together, so a preset is one change. */
  function setSize(width: string | number, height: string | number): void {
    if (!size) return;
    onchange({ ...values, [size.width.id]: width, [size.height.id]: height });
  }
</script>

{#if entry}
  {#if size}
    <SizePill
      pair={size}
      width={shown[size.width.id]}
      height={shown[size.height.id]}
      onchange={setSize}
    />
  {/if}
  {#each single as parameter (parameter.id)}
    <ParameterPill
      {parameter}
      value={shown[parameter.id]}
      onchange={(value) => setValue(parameter.id, value)}
      {imagePaths}
    />
  {/each}
{/if}
