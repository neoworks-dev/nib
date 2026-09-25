import { beforeEach, describe, expect, test } from "bun:test";
import type { PaneProps } from "@nib-ui/ui-contracts";
import type { Component } from "svelte";
// The module, not the package: the plugin's entry point pulls in Svelte components.
import { chatPaneId, paramsForWorkstream } from "../../../plugins/canvas/src/chat-pane";
import { ReactivePaneRegistry } from "../src/lib/client/registries/panes.svelte";

const component = {} as Component<PaneProps>;

let panes: ReactivePaneRegistry;

/** What the canvas does when a card is opened: reach its pane, or open one. */
function openChat(workstream: { id: string; sessionId?: string }): string {
  return panes.open(chatPaneId, paramsForWorkstream(workstream));
}

/** What the canvas does when the session behind a card changes under it. */
function reparamChat(workstream: { id: string; sessionId?: string }): void {
  for (const instance of panes.instances(chatPaneId)) {
    const params = instance.params as { workstreamId?: string } | undefined;
    if (params?.workstreamId === workstream.id)
      panes.reparam(instance.instanceId, paramsForWorkstream(workstream));
  }
}

beforeEach(() => {
  panes = new ReactivePaneRegistry();
  panes.setBounds({ width: 1200, height: 800 });
  panes.register({ id: chatPaneId, kind: "chat", title: "Chat", component });
});

describe("chat pane params", () => {
  test("a launched workstream is keyed by its card and carries the session it is on", () => {
    expect(paramsForWorkstream({ id: "w1", sessionId: "s1" })).toEqual({
      workstreamId: "w1",
      sessionId: "s1",
    });
  });

  test("a workstream with no session yet is keyed by the card alone", () => {
    expect(paramsForWorkstream({ id: "w1" })).toEqual({ workstreamId: "w1" });
  });
});

describe("opening a card", () => {
  test("two workstreams are two chat panes, one above the other in the same dock", () => {
    const first = openChat({ id: "w1", sessionId: "s1" });
    const second = openChat({ id: "w2", sessionId: "s2" });

    expect(second).not.toBe(first);
    expect(panes.instances(chatPaneId)).toHaveLength(2);
    expect(panes.docks).toHaveLength(1);
    expect(panes.dock("right")?.root).toMatchObject({ kind: "split", axis: "column" });
  });

  test("opening the same card again reaches the pane it already has", () => {
    const first = openChat({ id: "w1", sessionId: "s1" });
    openChat({ id: "w2", sessionId: "s2" });

    expect(openChat({ id: "w1", sessionId: "s1" })).toBe(first);
    expect(panes.instances(chatPaneId)).toHaveLength(2);
  });

  test("a workstream launched since its pane opened keeps that pane, on the new session", () => {
    const pane = openChat({ id: "w1" });
    reparamChat({ id: "w1", sessionId: "s1" });

    expect(panes.instance(pane)?.params).toEqual({ workstreamId: "w1", sessionId: "s1" });
    expect(openChat({ id: "w1", sessionId: "s1" })).toBe(pane);
    expect(panes.instances(chatPaneId)).toHaveLength(1);
  });

  test("a workstream moved to another harness keeps that pane, on the new session", () => {
    const pane = openChat({ id: "w1", sessionId: "s1" });
    reparamChat({ id: "w1", sessionId: "s2" });

    expect(panes.instance(pane)?.params).toEqual({ workstreamId: "w1", sessionId: "s2" });
    expect(openChat({ id: "w1", sessionId: "s2" })).toBe(pane);
    expect(panes.instances(chatPaneId)).toHaveLength(1);
  });

  test("asking for the chat without naming a conversation reaches the newest one open", () => {
    const card = openChat({ id: "w1", sessionId: "s1" });

    expect(panes.open(chatPaneId)).toBe(card);
  });

  test("with nothing open, the chat opens on no conversation in particular", () => {
    const loose = panes.open(chatPaneId);

    expect(panes.instance(loose)?.params).toBeUndefined();
  });
});
