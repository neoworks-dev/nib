import { describe, expect, test } from "bun:test";
import { formatRelativeTime, statusLabel, statusTone, workspaceName } from "../src/display";

describe("workspaceName", () => {
  test("uses the last path segment", () => {
    expect(workspaceName("/home/dev/projects/nib-ui")).toBe("nib-ui");
    expect(workspaceName("/home/dev/projects/nib-ui/")).toBe("nib-ui");
    expect(workspaceName("/")).toBe("/");
  });
});

describe("formatRelativeTime", () => {
  const now = 10_000_000_000;

  test("scales from seconds to weeks", () => {
    expect(formatRelativeTime(now - 5_000, now)).toBe("now");
    expect(formatRelativeTime(now - 4 * 60_000, now)).toBe("4m");
    expect(formatRelativeTime(now - 2 * 3_600_000, now)).toBe("2h");
    expect(formatRelativeTime(now - 3 * 86_400_000, now)).toBe("3d");
    expect(formatRelativeTime(now - 21 * 86_400_000, now)).toBe("3w");
  });

  test("clamps a clock that runs behind the event", () => {
    expect(formatRelativeTime(now + 5_000, now)).toBe("now");
  });
});

describe("status presentation", () => {
  test("labels only the statuses that need attention", () => {
    expect(statusLabel("working")).toBe("Working");
    expect(statusLabel("awaiting-permission")).toBe("Needs input");
    expect(statusLabel("error")).toBe("Error");
    expect(statusLabel("closed")).toBe("Completed");
    expect(statusLabel("idle")).toBeNull();
  });

  test("pairs each status with a tone", () => {
    expect(statusTone("working")).toBe("blue");
    expect(statusTone("awaiting-permission")).toBe("amber");
    expect(statusTone("error")).toBe("red");
    expect(statusTone("closed")).toBe("green");
    expect(statusTone("idle")).toBe("neutral");
  });
});
