import { describe, expect, it } from "bun:test";
import { planTrajectory } from "../src/attach";

describe("planTrajectory", () => {
  it("attaches beside the chat the button was pressed in", () => {
    expect(
      planTrajectory({ focused: { instanceId: "chat-1", kind: "chat" }, attached: undefined }),
    ).toEqual({ action: "attach", chatInstanceId: "chat-1" });
  });

  it("closes the inspector already beside that chat", () => {
    expect(
      planTrajectory({
        focused: { instanceId: "chat-1", kind: "chat" },
        attached: { instanceId: "inspector-1" },
      }),
    ).toEqual({ action: "close", instanceId: "inspector-1" });
  });

  it("opens on its own when nothing to sit beside is focused", () => {
    expect(planTrajectory({ focused: null, attached: undefined })).toEqual({ action: "open" });
    expect(
      planTrajectory({ focused: { instanceId: "editor-1", kind: "editor" }, attached: undefined }),
    ).toEqual({ action: "open" });
  });
});
