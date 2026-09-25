<script lang="ts">
  /**
   * The markdown editor: CodeMirror over the note's text, drawn as what it
   * means by `live-preview`. The text is the file — no block model in between —
   * so selection, undo, IME and paste are the browser's and CodeMirror's, not
   * ours.
   *
   * `@neoworks-dev/ui` has no editor. `Textarea` is a form field: one font, no
   * per-line styling, and no way to hide syntax on the lines the caret is not on.
   */
  import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
  import { markdown, markdownKeymap, markdownLanguage } from "@codemirror/lang-markdown";
  import { EditorState } from "@codemirror/state";
  import { EditorView, keymap } from "@codemirror/view";
  import { untrack } from "svelte";
  import { type EditorThemeKind, editorTheme } from "./editor-theme";
  import { livePreview } from "./live-preview";
  // KaTeX draws with its own fonts and its own metrics; without the stylesheet
  // a formula is a pile of overlapping characters.
  import "katex/dist/katex.min.css";

  interface Props {
    text: string;
    onChange: (text: string) => void;
    theme: EditorThemeKind;
    /** Focus on mount with the caret at the end of what is written. */
    autofocus?: boolean;
  }

  const { text, onChange, theme, autofocus = false }: Props = $props();

  let host = $state<HTMLElement | null>(null);
  let view: EditorView | null = null;

  $effect(() => {
    const parent = host;
    if (!parent) return;

    const created = new EditorView({
      parent,
      state: EditorState.create({
        doc: untrack(() => text),
        extensions: [
          history(),
          keymap.of([...markdownKeymap, ...defaultKeymap, ...historyKeymap]),
          markdown({ base: markdownLanguage }),
          livePreview(),
          EditorView.lineWrapping,
          editorTheme(theme),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) onChange(update.state.doc.toString());
          }),
        ],
      }),
    });
    view = created;

    if (autofocus) {
      // At the end of the note rather than the end of its first line: the caret
      // reveals the markdown on the line it is on, and parking it in the title
      // means opening a note to `# Heading` where the card showed a heading.
      created.dispatch({ selection: { anchor: created.state.doc.length } });
      created.focus();
    }

    return () => {
      created.destroy();
      view = null;
    };
  });

  // A change from outside — a reload, another writer — replaces the document.
  // The editor's own edits are already the text, so they do not come back
  // through here and the caret stays where it is.
  $effect(() => {
    const next = text;
    const current = view;
    if (!current) return;
    const doc = current.state.doc;
    if (doc.toString() === next) return;
    current.dispatch({ changes: { from: 0, to: doc.length, insert: next } });
  });
</script>

<div bind:this={host} class="h-full w-full"></div>
