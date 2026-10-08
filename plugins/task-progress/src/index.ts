import type { Plugin } from "@nib-ui/kernel";
import TargetIcon from "phosphor-svelte/lib/TargetIcon";
import ProgressPanel from "./ProgressPanel.svelte";
import TodoBlock from "./TodoBlock.svelte";

const paneId = "progress";
const toolName = "TodoWrite";

export const taskProgressPlugin: Plugin = {
  name: "task-progress",
  inject: ["panes", "renderers", "commands"],
  apply(ctx) {
    const renderers = ctx.require("renderers");
    const panes = ctx.require("panes");
    ctx.effect(() =>
      panes.register({
        id: paneId,
        kind: "tasks",
        title: "Progress",
        icon: TargetIcon,
        component: ProgressPanel,
      }),
    );
    ctx.effect(() =>
      renderers.register({ type: "tool", toolName, priority: 10, component: TodoBlock }),
    );
    ctx.effect(() =>
      ctx.require("commands").register({
        id: "progress.toggle",
        title: "Toggle progress pane",
        run: () => panes.toggle(paneId),
      }),
    );
  },
};

export {
  isTodoCall,
  parseTodos,
  readTodos,
  type TodoItem,
  type TodoProgress,
  type TodoStatus,
  todoProgress,
} from "./todos";
