import { describe, expect, test } from "bun:test";
import { exchangeId, toExchanges } from "../src/exchanges";
import { sessionOf, textItem, toolItem, userItem } from "./fixtures";

describe("toExchanges", () => {
  test("opens an exchange per prompt and folds the answer into it", () => {
    const exchanges = toExchanges(
      sessionOf("s1", [
        userItem("u1", "add a button"),
        textItem("a1", "done"),
        userItem("u2", "now style it"),
        textItem("a2", "styled"),
      ]),
    );

    expect(exchanges.map((exchange) => exchange.id)).toEqual([
      exchangeId("s1", "u1"),
      exchangeId("s1", "u2"),
    ]);
    expect(exchanges[0]!.prompt).toBe("add a button");
    expect(exchanges[0]!.reply).toBe("done");
    expect(exchanges[1]!.reply).toBe("styled");
  });

  test("tool calls and prose in one turn stay inside the open exchange", () => {
    const exchanges = toExchanges(
      sessionOf("s1", [
        userItem("u1", "look around"),
        toolItem("t1", "Read", { file_path: "/a/b.ts" }),
        textItem("a1", "read it"),
      ]),
    );

    expect(exchanges).toHaveLength(1);
    expect(exchanges[0]!.reply).toBe("read it");
    expect(exchanges[0]!.steps.map((step) => step.verb)).toEqual(["Read"]);
  });

  test("a step carries the turn and tool call it came from, so a canvas row can jump to it", () => {
    const exchanges = toExchanges(
      sessionOf("s1", [userItem("u1", "look around"), toolItem("t1", "Read", { path: "/a/b.ts" })]),
    );

    expect(exchanges[0]!.steps[0]).toMatchObject({ turnId: "t1", toolCallId: "t1" });
  });

  test("edits become changes and everything else becomes a step", () => {
    const edit = (id: string, oldText: string, newText: string) =>
      toolItem(id, "Edit", {}, { content: [{ type: "diff", path: "/a/b.ts", oldText, newText }] });
    const exchanges = toExchanges(
      sessionOf("s1", [
        userItem("u1", "fix it"),
        toolItem("t1", "Grep", { pattern: "todo" }),
        edit("t2", "one\ntwo", "one\nthree"),
        edit("t3", "four", "five"),
      ]),
    );

    expect(exchanges[0]!.steps.map((step) => step.label)).toEqual(["Explore"]);
    expect(exchanges[0]!.changes).toEqual([{ path: "/a/b.ts", added: 2, removed: 2 }]);
  });

  test("a running session marks only its newest exchange", () => {
    const exchanges = toExchanges(
      sessionOf("s1", [userItem("u1", "one"), textItem("a1", "done"), userItem("u2", "two")], {
        status: "working",
      }),
    );

    expect(exchanges.map((exchange) => exchange.working)).toEqual([false, true]);
  });

  test("a transcript opening with harness output still gets an exchange", () => {
    const exchanges = toExchanges(sessionOf("s1", [textItem("a1", "resumed")]));

    expect(exchanges).toHaveLength(1);
    expect(exchanges[0]!.prompt).toBe("");
    expect(exchanges[0]!.reply).toBe("resumed");
  });

  test("messageIds collects the prompt and every turn folded into the exchange", () => {
    const exchanges = toExchanges(
      sessionOf("s1", [
        userItem("u1", "add a button"),
        toolItem("t1", "Read", { file_path: "/a/b.ts" }),
        textItem("a1", "done"),
        userItem("u2", "now style it"),
      ]),
    );

    expect(exchanges[0]!.messageIds).toEqual(["u1", "t1"]);
    expect(exchanges[1]!.messageIds).toEqual(["u2"]);
  });
});
