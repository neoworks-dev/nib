import { describe, expect, test } from "bun:test";
import { exchangeId, toExchanges } from "../src/exchanges";
import { message, session, text, toolResult, toolUse } from "./fixtures";

describe("toExchanges", () => {
  test("opens an exchange per prompt and folds the answer into it", () => {
    const exchanges = toExchanges(
      session("s1", [
        message("m1", "user", [text("b1", "add a button")]),
        message("m2", "assistant", [text("b2", "done")]),
        message("m3", "user", [text("b3", "now style it")]),
        message("m4", "assistant", [text("b4", "styled")]),
      ]),
    );

    expect(exchanges.map((exchange) => exchange.id)).toEqual([
      exchangeId("s1", "m1"),
      exchangeId("s1", "m3"),
    ]);
    expect(exchanges[0]!.prompt).toBe("add a button");
    expect(exchanges[0]!.reply).toBe("done");
    expect(exchanges[1]!.reply).toBe("styled");
  });

  test("a user turn carrying only tool results stays inside the open exchange", () => {
    const exchanges = toExchanges(
      session("s1", [
        message("m1", "user", [text("b1", "look around")]),
        message("m2", "assistant", [toolUse("t1", "Read", { file_path: "/a/b.ts" })]),
        message("m3", "user", [toolResult("t1")]),
        message("m4", "assistant", [text("b2", "read it")]),
      ]),
    );

    expect(exchanges).toHaveLength(1);
    expect(exchanges[0]!.reply).toBe("read it");
    expect(exchanges[0]!.steps.map((step) => step.verb)).toEqual(["Read"]);
  });

  test("a step carries the message and block it came from, so a canvas row can jump to it", () => {
    const exchanges = toExchanges(
      session("s1", [
        message("m1", "user", [text("b1", "look around")]),
        message("m2", "assistant", [toolUse("t1", "Read", { file_path: "/a/b.ts" })]),
      ]),
    );

    expect(exchanges[0]!.steps[0]).toMatchObject({ messageId: "m2", blockId: "t1" });
  });

  test("edits become changes and everything else becomes a step", () => {
    const exchanges = toExchanges(
      session("s1", [
        message("m1", "user", [text("b1", "fix it")]),
        message("m2", "assistant", [
          toolUse("t1", "Grep", { pattern: "todo" }),
          toolUse("t2", "Edit", {
            file_path: "/a/b.ts",
            old_string: "one\ntwo",
            new_string: "one\nthree",
          }),
          toolUse("t3", "Edit", { file_path: "/a/b.ts", old_string: "four", new_string: "five" }),
        ]),
      ]),
    );

    expect(exchanges[0]!.steps.map((step) => step.label)).toEqual(["Explore"]);
    expect(exchanges[0]!.changes).toEqual([{ path: "/a/b.ts", added: 2, removed: 2 }]);
  });

  test("a running session marks only its newest exchange", () => {
    const exchanges = toExchanges(
      session(
        "s1",
        [
          message("m1", "user", [text("b1", "one")]),
          message("m2", "assistant", [text("b2", "done")]),
          message("m3", "user", [text("b3", "two")]),
        ],
        { status: "working" },
      ),
    );

    expect(exchanges.map((exchange) => exchange.working)).toEqual([false, true]);
  });

  test("a transcript opening with harness output still gets an exchange", () => {
    const exchanges = toExchanges(
      session("s1", [message("m1", "assistant", [text("b1", "resumed")])]),
    );

    expect(exchanges).toHaveLength(1);
    expect(exchanges[0]!.prompt).toBe("");
    expect(exchanges[0]!.reply).toBe("resumed");
  });

  test("messageIds collects every message folded into the exchange, prompt through reply", () => {
    const exchanges = toExchanges(
      session("s1", [
        message("m1", "user", [text("b1", "add a button")]),
        message("m2", "assistant", [toolUse("t1", "Read", { file_path: "/a/b.ts" })]),
        message("m3", "user", [toolResult("t1")]),
        message("m4", "assistant", [text("b2", "done")]),
        message("m5", "user", [text("b3", "now style it")]),
      ]),
    );

    expect(exchanges[0]!.messageIds).toEqual(["m1", "m2", "m4"]);
    expect(exchanges[1]!.messageIds).toEqual(["m5"]);
  });
});
