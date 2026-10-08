import { type PlanEntry, type SessionView, toolInput, type ToolItem } from "@nib-ui/protocol";

export type TodoStatus = "pending" | "in_progress" | "completed";

export interface TodoItem {
  content: string;
  /** Present-tense wording the harness uses while the step is running. */
  activeForm: string;
  status: TodoStatus;
}

export interface TodoProgress {
  items: TodoItem[];
  completed: number;
  total: number;
  /** The step being worked on right now, if the plan names one. */
  current: TodoItem | null;
}

const todoToolName = "TodoWrite";
const statuses = new Set<TodoStatus>(["pending", "in_progress", "completed"]);

/** Claude's own task list, which older sessions logged as a tool call. */
export function isTodoCall(tool: ToolItem): boolean {
  return tool.name === todoToolName;
}

/**
 * The plan is whatever the harness reported last: every report replaces the
 * whole list, so folding earlier ones in would resurrect deleted steps. ACP's
 * `plan` updates are the plan; a session logged before those were kept reads its
 * newest `TodoWrite` call instead.
 */
export function readTodos(session: SessionView): TodoItem[] {
  if (session.plan.length > 0) return session.plan.map(todoOfPlanEntry);
  for (let index = session.items.length - 1; index >= 0; index -= 1) {
    const item = session.items[index]!;
    if (item.type !== "tool" || !isTodoCall(item)) continue;
    const items = parseTodos(item);
    if (items.length > 0) return items;
  }
  return [];
}

/** A plan entry has one wording, so the running step reads the same as the pending one. */
function todoOfPlanEntry(entry: PlanEntry): TodoItem {
  return { content: entry.content, activeForm: entry.content, status: entry.status };
}

/** The steps a `TodoWrite` call wrote. */
export function parseTodos(tool: ToolItem): TodoItem[] {
  const raw = toolInput(tool)?.todos;
  if (!Array.isArray(raw)) return [];

  const items: TodoItem[] = [];
  for (const entry of raw) {
    const todo = entry as Record<string, unknown>;
    if (typeof todo.content !== "string") continue;
    const status = todo.status as TodoStatus;
    items.push({
      content: todo.content,
      activeForm: typeof todo.activeForm === "string" ? todo.activeForm : todo.content,
      status: statuses.has(status) ? status : "pending",
    });
  }
  return items;
}

export function todoProgress(items: TodoItem[]): TodoProgress {
  return {
    items,
    completed: items.filter((item) => item.status === "completed").length,
    total: items.length,
    current: items.find((item) => item.status === "in_progress") ?? null,
  };
}
