import { describe, expect, test } from "bun:test";
import {
  type BlockView,
  createSessionView,
  type MessageView,
  type SessionView,
} from "@nib-ui/protocol";
import { parseTodos, readTodos, todoProgress } from "../src/todos";

function todoBlock(id: string, todos: unknown): BlockView {
  return {
    id,
    messageId: "m1",
    kind: "tool_use",
    toolName: "TodoWrite",
    toolUseId: id,
    text: "",
    inputJson: "",
    content: { kind: "tool_use", toolName: "TodoWrite", toolUseId: id, input: { todos } },
    completed: true,
  };
}

function session(messages: { id: string; blocks: BlockView[] }[]): SessionView {
  const view = createSessionView("s1");
  return {
    ...view,
    messages: messages.map(({ id, blocks }): MessageView => ({
      id,
      role: "assistant",
      blocks,
      completed: true,
      stopReason: null,
    })),
  };
}

const firstPlan = [
  { content: "Initialize the board", activeForm: "Initializing the board", status: "completed" },
  { content: "Detect wins", activeForm: "Detecting wins", status: "in_progress" },
  { content: "Add restart", activeForm: "Adding restart", status: "pending" },
];

describe("parseTodos", () => {
  test("reads content, active form and status", () => {
    expect(parseTodos(todoBlock("b1", firstPlan))).toEqual([
      {
        content: "Initialize the board",
        activeForm: "Initializing the board",
        status: "completed",
      },
      { content: "Detect wins", activeForm: "Detecting wins", status: "in_progress" },
      { content: "Add restart", activeForm: "Adding restart", status: "pending" },
    ]);
  });

  test("falls back to the content when no active form is given", () => {
    expect(
      parseTodos(todoBlock("b1", [{ content: "Ship it", status: "pending" }]))[0]!.activeForm,
    ).toBe("Ship it");
  });

  test("treats an unknown status as pending", () => {
    expect(
      parseTodos(todoBlock("b1", [{ content: "Ship it", status: "blocked" }]))[0]!.status,
    ).toBe("pending");
  });

  test("skips entries with no content and inputs that are not a list", () => {
    expect(parseTodos(todoBlock("b1", [{ status: "pending" }]))).toEqual([]);
    expect(parseTodos(todoBlock("b1", "nonsense"))).toEqual([]);
  });
});

describe("readTodos", () => {
  test("the newest plan replaces the older one instead of merging", () => {
    const view = session([
      { id: "m1", blocks: [todoBlock("b1", firstPlan)] },
      { id: "m2", blocks: [todoBlock("b2", [{ content: "Only this", status: "completed" }])] },
    ]);
    expect(readTodos(view).map((item) => item.content)).toEqual(["Only this"]);
  });

  test("skips a call whose input has not finished streaming", () => {
    const view = session([
      { id: "m1", blocks: [todoBlock("b1", firstPlan)] },
      { id: "m2", blocks: [todoBlock("b2", [])] },
    ]);
    expect(readTodos(view)).toHaveLength(3);
  });

  test("is empty when no plan was ever written", () => {
    expect(readTodos(createSessionView("s1"))).toEqual([]);
  });
});

describe("todoProgress", () => {
  test("counts completed steps and names the running one", () => {
    const progress = todoProgress(parseTodos(todoBlock("b1", firstPlan)));
    expect(progress.completed).toBe(1);
    expect(progress.total).toBe(3);
    expect(progress.current?.activeForm).toBe("Detecting wins");
  });

  test("has no current step once every step is done", () => {
    const progress = todoProgress(
      parseTodos(todoBlock("b1", [{ content: "Done", status: "completed" }])),
    );
    expect(progress.current).toBeNull();
    expect(progress.completed).toBe(1);
  });
});
