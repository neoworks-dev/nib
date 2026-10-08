import { describe, expect, test } from "bun:test";
import {
  createSessionView,
  type PlanEntry,
  type SessionView,
  type ToolItem,
} from "@nib-ui/protocol";
import { sessionOf, toolItem } from "../../../packages/protocol/tests/builders";
import { parseTodos, readTodos, todoProgress } from "../src/todos";

function todoBlock(id: string, todos: unknown): ToolItem {
  return toolItem(id, "TodoWrite", { todos });
}

function session(calls: ToolItem[]): SessionView {
  return sessionOf("s1", calls);
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
      todoBlock("b1", firstPlan),
      todoBlock("b2", [{ content: "Only this", status: "completed" }]),
    ]);
    expect(readTodos(view).map((item) => item.content)).toEqual(["Only this"]);
  });

  test("skips a call whose input has not finished streaming", () => {
    const view = session([todoBlock("b1", firstPlan), todoBlock("b2", [])]);
    expect(readTodos(view)).toHaveLength(3);
  });

  test("reads the ACP plan the harness reported, over any TodoWrite call", () => {
    const plan: PlanEntry[] = [
      { content: "Write the fold", status: "completed", priority: "high" },
      { content: "Move the renderers", status: "in_progress", priority: "medium" },
    ];
    const view = { ...session([todoBlock("b1", firstPlan)]), plan };
    expect(readTodos(view)).toEqual([
      { content: "Write the fold", activeForm: "Write the fold", status: "completed" },
      { content: "Move the renderers", activeForm: "Move the renderers", status: "in_progress" },
    ]);
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
