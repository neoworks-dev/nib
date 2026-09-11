import { describe, expect, test } from "bun:test";
import {
  anyCapability,
  describeCapabilities,
  disabledCapabilities,
  type SidecarCapabilities,
} from "../src/desktop-agent";

const wayland: SidecarCapabilities = {
  capture: "portal",
  focus: "compositor-ipc",
  pointer: "compositor-ipc",
  compositor: "Hyprland",
  sessionType: "wayland",
  layerShell: true,
};

describe("a machine with everything", () => {
  test("reports layer-shell and nothing to explain", () => {
    const report = describeCapabilities({ bridge: true, sidecarResolved: true, sidecar: wayland });
    expect(report).toEqual({
      overlay: "layer-shell",
      capture: "portal",
      focus: "compositor-ipc",
      pointer: "compositor-ipc",
      compositor: "Hyprland",
      sessionType: "wayland",
      notes: [],
    });
  });

  test("the compositor is carried but never decides anything", () => {
    const renamed = describeCapabilities({
      bridge: true,
      sidecarResolved: true,
      sidecar: { ...wayland, compositor: "something-else" },
    });
    expect(renamed.overlay).toBe("layer-shell");
    expect(renamed.compositor).toBe("something-else");
  });
});

describe("degradations", () => {
  test("a browser has no bridge and everything is off", () => {
    const report = describeCapabilities({ bridge: false, sidecarResolved: false });
    expect(report).toEqual(disabledCapabilities(report.notes[0]!));
    expect(report.notes[0]).toContain("desktop app");
  });

  test("a desktop build with no sidecar binary says how to build it", () => {
    const report = describeCapabilities({ bridge: true, sidecarResolved: false });
    expect(report.overlay).toBe("unavailable");
    expect(report.notes[0]).toContain("task build:overlay");
  });

  test("a resolved binary that has not answered yet is not an error", () => {
    const report = describeCapabilities({ bridge: true, sidecarResolved: true });
    expect(report.notes).toEqual(["The nib-overlay sidecar has not reported yet."]);
  });

  test("no layer-shell on Wayland leaves the overlay unavailable, not a floating window", () => {
    const report = describeCapabilities({
      bridge: true,
      sidecarResolved: true,
      sidecar: { ...wayland, compositor: "GNOME Shell", layerShell: false },
    });
    expect(report.overlay).toBe("unavailable");
    expect(report.notes.some((note) => note.includes("cannot be positioned on Wayland"))).toBe(
      true,
    );
  });

  test("X11 says the window fallback is not built rather than claiming it", () => {
    const report = describeCapabilities({
      bridge: true,
      sidecarResolved: true,
      sidecar: { ...wayland, sessionType: "x11", layerShell: false },
    });
    // `always-on-top-window` is the right answer for X11 and has no implementation, so
    // reporting it would be a capability that silently does nothing.
    expect(report.overlay).toBe("unavailable");
    expect(report.notes.some((note) => note.includes("not built yet"))).toBe(true);
  });

  test("X11 with no sidecar reports the missing binary, which is the nearer problem", () => {
    const report = describeCapabilities({
      bridge: true,
      sidecarResolved: false,
      sidecar: { ...wayland, sessionType: "x11", layerShell: false },
    });
    expect(report.overlay).toBe("unavailable");
    expect(report.notes.some((note) => note.includes("No nib-overlay binary"))).toBe(true);
  });

  test("layer-shell needs the binary, not just the compositor advertising it", () => {
    const report = describeCapabilities({ bridge: true, sidecarResolved: false, sidecar: wayland });
    expect(report.overlay).toBe("unavailable");
  });

  test("no capture strategy is explained", () => {
    const report = describeCapabilities({
      bridge: true,
      sidecarResolved: true,
      sidecar: { ...wayland, capture: "unavailable" },
    });
    expect(report.notes.some((note) => note.includes("neither the desktop portal nor grim"))).toBe(
      true,
    );
  });

  test("no focus source explains that routing falls back", () => {
    const report = describeCapabilities({
      bridge: true,
      sidecarResolved: true,
      sidecar: { ...wayland, focus: "unavailable" },
    });
    expect(report.notes.some((note) => note.includes("per-application routing"))).toBe(true);
  });

  test("no pointer source explains that the overlay cannot follow", () => {
    const report = describeCapabilities({
      bridge: true,
      sidecarResolved: true,
      sidecar: { ...wayland, pointer: "unavailable" },
    });
    expect(report.notes.some((note) => note.includes("cursor position"))).toBe(true);
  });

  test("the sidecar’s own notes come first, then the host’s", () => {
    const report = describeCapabilities({
      bridge: true,
      sidecarResolved: true,
      sidecar: {
        ...wayland,
        notes: ["grim was not found"],
        capture: "unavailable",
        pointer: "unavailable",
      },
    });
    expect(report.notes[0]).toBe("grim was not found");
    expect(report.notes).toHaveLength(3);
  });

  test("every capability off at once still produces a report rather than a throw", () => {
    const report = describeCapabilities({
      bridge: true,
      sidecarResolved: true,
      sidecar: {
        capture: "unavailable",
        focus: "unavailable",
        pointer: "unavailable",
        compositor: null,
        sessionType: "unknown",
        layerShell: false,
      },
    });
    expect(report.overlay).toBe("unavailable");
    expect(report.notes).toHaveLength(4);
  });
});

describe("anyCapability", () => {
  test("capture alone is enough to be worth offering", () => {
    expect(
      anyCapability(
        describeCapabilities({ bridge: true, sidecarResolved: false, sidecar: wayland }),
      ),
    ).toBe(true);
  });

  test("a browser is not", () => {
    expect(anyCapability(describeCapabilities({ bridge: false, sidecarResolved: false }))).toBe(
      false,
    );
  });

  test("an overlay with no capture still counts", () => {
    const report = describeCapabilities({
      bridge: true,
      sidecarResolved: true,
      sidecar: { ...wayland, capture: "unavailable" },
    });
    expect(anyCapability(report)).toBe(true);
  });
});
