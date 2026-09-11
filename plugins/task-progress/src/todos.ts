import { type BlockView, blockToolInput, type SessionView } from "@nib-ui/protocol";

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

export function isTodoBlock(block: BlockView): boolean {
  return block.kind === "tool_use" && block.toolName === todoToolName;
}

/**
 * The plan is whatever the newest `TodoWrite` wrote: every call replaces the
 * whole list, so folding earlier ones in would resurrect deleted steps.
 */
export function readTodos(session: SessionView): TodoItem[] {
  for (let messageIndex = session.messages.length - 1; messageIndex >= 0; messageIndex -= 1) {
    const blocks = session.messages[messageIndex]!.blocks;
    for (let blockIndex = blocks.length - 1; blockIndex >= 0; blockIndex -= 1) {
      const block = blocks[blockIndex]!;
      if (!isTodoBlock(block)) continue;
      const items = parseTodos(block);
      if (items.length > 0) return items;
    }
  }
  return [];
}

export function parseTodos(block: BlockView): TodoItem[] {
  const input = blockToolInput(block);
  const raw = (input as { todos?: unknown })?.todos;
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
