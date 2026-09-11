import { describe, expect, test } from "bun:test";
import { isAnswerComplete, parseAskUserQuestion, withQuestionAnswers } from "../src/ask-question";

const input = {
  questions: [
    {
      question: "Which database?",
      header: "Database",
      options: [
        { label: "Postgres", description: "Relational" },
        { label: "SQLite", description: "Embedded" },
      ],
      multiSelect: false,
    },
  ],
};

describe("parseAskUserQuestion", () => {
  test("accepts the tool payload", () => {
    const parsed = parseAskUserQuestion(input);
    expect(parsed?.questions[0]?.header).toBe("Database");
    expect(parsed?.questions[0]?.options).toHaveLength(2);
  });

  test("keeps unknown fields so an allow can echo the input back", () => {
    const parsed = parseAskUserQuestion({ ...input, correlationId: "abc" });
    expect((parsed as Record<string, unknown> | null)?.correlationId).toBe("abc");
  });

  test("rejects payloads that are not questions", () => {
    expect(parseAskUserQuestion({ command: "ls" })).toBeNull();
    expect(parseAskUserQuestion({ questions: [] })).toBeNull();
  });
});

describe("withQuestionAnswers", () => {
  test("keys answers by question text", () => {
    const parsed = parseAskUserQuestion(input)!;
    expect(withQuestionAnswers(parsed, { "Which database?": ["Postgres"] }).answers).toEqual({
      "Which database?": "Postgres",
    });
  });

  test("joins multi-select answers with commas", () => {
    const parsed = parseAskUserQuestion(input)!;
    expect(
      withQuestionAnswers(parsed, { "Which database?": ["Postgres", "SQLite"] }).answers,
    ).toEqual({
      "Which database?": "Postgres,SQLite",
    });
  });

  test("drops empty answers and preserves the original questions", () => {
    const parsed = parseAskUserQuestion(input)!;
    const updated = withQuestionAnswers(parsed, { "Which database?": ["  "] });
    expect(updated.answers).toEqual({});
    expect(updated.questions).toEqual(parsed.questions);
  });
});

describe("isAnswerComplete", () => {
  test("requires every question to be answered", () => {
    const parsed = parseAskUserQuestion({
      questions: [input.questions[0], { ...input.questions[0], question: "Which runtime?" }],
    })!;
    expect(isAnswerComplete(parsed, { "Which database?": ["SQLite"] })).toBe(false);
    expect(
      isAnswerComplete(parsed, { "Which database?": ["SQLite"], "Which runtime?": ["Bun"] }),
    ).toBe(true);
  });
});
