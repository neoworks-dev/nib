import { describe, expect, test } from "bun:test";
import type { PaneNode } from "@nib-ui/ui-contracts";
import { MIN_DOCK_HEIGHT, MIN_DOCK_WIDTH } from "../src/lib/client/layout/docks";
import {
  dropEdge,
  insertAtEdge,
  insertBeside,
  layoutTree,
  leafNode,
  leafPath,
  listLeaves,
  minimumFraction,
  normalizeNode,
  normalizeSizes,
  removeLeaf,
  resizeSiblings,
  retainLeaves,
  setSizes,
} from "../src/lib/client/layout/tree";

function row(children: PaneNode[], sizes: number[]): PaneNode {
  return { kind: "split", axis: "row", children, sizes };
}

function column(children: PaneNode[], sizes: number[]): PaneNode {
  return { kind: "split", axis: "column", children, sizes };
}

const total = (sizes: number[]) => sizes.reduce((sum, size) => sum + size, 0);

describe("insertAtEdge", () => {
  test("a horizontal edge makes a row and a vertical one a column", () => {
    expect(insertAtEdge(leafNode("a"), "b", "right")).toMatchObject({ kind: "split", axis: "row" });
    expect(insertAtEdge(leafNode("a"), "b", "left")).toMatchObject({ kind: "split", axis: "row" });
    expect(insertAtEdge(leafNode("a"), "b", "top")).toMatchObject({
      kind: "split",
      axis: "column",
    });
    expect(insertAtEdge(leafNode("a"), "b", "bottom")).toMatchObject({
      kind: "split",
      axis: "column",
    });
  });

  test("the edge decides the order and the pair shares the space", () => {
    expect(listLeaves(insertAtEdge(leafNode("a"), "b", "right"))).toEqual(["a", "b"]);
    expect(listLeaves(insertAtEdge(leafNode("a"), "b", "left"))).toEqual(["b", "a"]);
    expect(listLeaves(insertAtEdge(leafNode("a"), "b", "bottom"))).toEqual(["a", "b"]);
    expect(listLeaves(insertAtEdge(leafNode("a"), "b", "top"))).toEqual(["b", "a"]);

    const split = insertAtEdge(leafNode("a"), "b", "right");
    expect(split.kind === "split" && split.sizes).toEqual([0.5, 0.5]);
  });

  test("a split of the same axis takes another child rather than another level", () => {
    const node = insertAtEdge(row([leafNode("a"), leafNode("b")], [0.5, 0.5]), "c", "right");

    expect(node.kind).toBe("split");
    expect(listLeaves(node)).toEqual(["a", "b", "c"]);
    expect(node.kind === "split" && node.children).toHaveLength(3);
    expect(node.kind === "split" && total(node.sizes)).toBeCloseTo(1);
  });

  test("a split of the other axis is wrapped, keeping what it held", () => {
    const node = insertAtEdge(row([leafNode("a"), leafNode("b")], [0.5, 0.5]), "c", "bottom");

    expect(node).toMatchObject({ kind: "split", axis: "column" });
    expect(listLeaves(node)).toEqual(["a", "b", "c"]);
  });
});

describe("insertBeside", () => {
  test("the new leaf takes half of the target, leaving the others alone", () => {
    const node = insertBeside(row([leafNode("a"), leafNode("b")], [0.6, 0.4]), "c", "a", "right");

    expect(listLeaves(node)).toEqual(["a", "c", "b"]);
    expect(node.kind === "split" && node.sizes).toEqual([0.3, 0.3, 0.4]);
  });

  test("a perpendicular edge nests a split inside the target place", () => {
    const node = insertBeside(row([leafNode("a"), leafNode("b")], [0.5, 0.5]), "c", "b", "bottom");

    expect(listLeaves(node)).toEqual(["a", "b", "c"]);
    expect(node.kind === "split" && node.children[1]).toMatchObject({
      kind: "split",
      axis: "column",
    });
    expect(node.kind === "split" && node.sizes).toEqual([0.5, 0.5]);
  });

  test("a target deep in the tree is found", () => {
    const node = insertBeside(
      row([leafNode("a"), column([leafNode("b"), leafNode("c")], [0.5, 0.5])], [0.5, 0.5]),
      "d",
      "c",
      "bottom",
    );

    expect(listLeaves(node)).toEqual(["a", "b", "c", "d"]);
  });

  test("a target that is not in the tree leaves it as it was", () => {
    const tree = row([leafNode("a"), leafNode("b")], [0.5, 0.5]);

    expect(insertBeside(tree, "c", "zzz", "right")).toBe(tree);
  });
});

describe("removeLeaf", () => {
  test("the last leaf leaves nothing behind", () => {
    expect(removeLeaf(leafNode("a"), "a")).toBeNull();
    expect(removeLeaf(leafNode("a"), "b")).toMatchObject({ kind: "leaf", instanceId: "a" });
  });

  test("a split down to one child collapses into that child", () => {
    expect(removeLeaf(row([leafNode("a"), leafNode("b")], [0.5, 0.5]), "b")).toEqual(leafNode("a"));
  });

  test("a nested split collapses through every level it empties", () => {
    const tree = row(
      [leafNode("a"), column([leafNode("b"), leafNode("c")], [0.5, 0.5])],
      [0.5, 0.5],
    );

    expect(removeLeaf(tree, "c")).toEqual(row([leafNode("a"), leafNode("b")], [0.5, 0.5]));
  });

  test("what is left shares the space in the proportions it had", () => {
    const node = removeLeaf(
      row([leafNode("a"), leafNode("b"), leafNode("c")], [0.5, 0.25, 0.25]),
      "a",
    );

    expect(node?.kind === "split" && node.sizes).toEqual([0.5, 0.5]);
  });
});

describe("normalizeSizes", () => {
  test("fractions always sum to one", () => {
    expect(total(normalizeSizes([2, 2], 2))).toBeCloseTo(1);
    expect(normalizeSizes([2, 2], 2)).toEqual([0.5, 0.5]);
  });

  test("a missing or nonsensical size falls back to an equal share", () => {
    expect(normalizeSizes([], 4)).toEqual([0.25, 0.25, 0.25, 0.25]);
    expect(total(normalizeSizes([Number.NaN, -1, 0.5], 3))).toBeCloseTo(1);
  });

  test("a size list longer than the split is cut to it", () => {
    expect(normalizeSizes([0.5, 0.25, 0.25], 2)).toEqual([2 / 3, 1 / 3]);
  });

  test("a tree from storage is normalized level by level", () => {
    const node = normalizeNode(
      row([leafNode("a"), column([leafNode("b"), leafNode("c")], [4, 4])], [1, 3]),
    );

    expect(node.kind === "split" && node.sizes).toEqual([0.25, 0.75]);
    expect(node.kind === "split" && node.children[1]).toMatchObject({ sizes: [0.5, 0.5] });
  });
});

describe("resizeSiblings", () => {
  test("a drag moves the boundary and leaves the other children alone", () => {
    const sizes = resizeSiblings([0.25, 0.25, 0.5], 0, 0.1);

    expect(sizes[0]).toBeCloseTo(0.35);
    expect(sizes[1]).toBeCloseTo(0.15);
    expect(sizes[2]).toBe(0.5);
  });

  test("neither neighbour is dragged below the minimum", () => {
    expect(resizeSiblings([0.5, 0.5], 0, -0.9, 0.2)).toEqual([0.2, 0.8]);
    expect(resizeSiblings([0.5, 0.5], 0, 0.9, 0.2)[1]).toBeCloseTo(0.2);
  });

  test("a minimum the pair cannot afford is shared instead of enforced", () => {
    expect(resizeSiblings([0.5, 0.5], 0, -5, 0.9)).toEqual([0.5, 0.5]);
  });

  test("a splitter that is not there changes nothing", () => {
    expect(resizeSiblings([0.5, 0.5], 1, 0.2)).toEqual([0.5, 0.5]);
  });
});

describe("minimumFraction", () => {
  test("the minimum pane size, expressed as a share of the dock", () => {
    expect(minimumFraction("row", MIN_DOCK_WIDTH * 4, 2)).toBeCloseTo(0.25);
    expect(minimumFraction("column", MIN_DOCK_HEIGHT * 5, 2)).toBeCloseTo(0.2);
  });

  test("a dock too small for the minimum gives every leaf an equal share instead", () => {
    expect(minimumFraction("row", MIN_DOCK_WIDTH, 2)).toBe(0.5);
    expect(minimumFraction("row", 0, 2)).toBe(0);
  });
});

describe("dropEdge", () => {
  const box = { x: 0, y: 0, width: 400, height: 200 };

  test("the region the pointer is in picks exactly one edge", () => {
    expect(dropEdge(box, 10, 100)).toBe("left");
    expect(dropEdge(box, 390, 100)).toBe("right");
    expect(dropEdge(box, 200, 5)).toBe("top");
    expect(dropEdge(box, 200, 195)).toBe("bottom");
  });

  test("a pointer near a corner resolves rather than lighting up two edges", () => {
    expect(dropEdge(box, 0, 0)).toBe("left");
    expect(dropEdge(box, 400, 200)).toBe("right");
  });
});

describe("addressing", () => {
  const tree = row([leafNode("a"), column([leafNode("b"), leafNode("c")], [0.5, 0.5])], [0.5, 0.5]);

  test("a leaf is found by the child indexes that lead to it", () => {
    expect(leafPath(tree, "a")).toEqual([0]);
    expect(leafPath(tree, "c")).toEqual([1, 1]);
    expect(leafPath(tree, "zzz")).toBeNull();
    expect(leafPath(leafNode("a"), "a")).toEqual([]);
  });

  test("sizes are set on the split a path names", () => {
    const node = setSizes(tree, [1], [0.8, 0.2]);

    expect(node.kind === "split" && node.children[1]).toMatchObject({ sizes: [0.8, 0.2] });
    expect(node.kind === "split" && node.sizes).toEqual([0.5, 0.5]);
  });

  test("retaining leaves drops the rest and collapses what is left", () => {
    expect(retainLeaves(tree, (leaf) => leaf !== "b")).toEqual(
      row([leafNode("a"), leafNode("c")], [0.5, 0.5]),
    );
    expect(retainLeaves(tree, () => false)).toBeNull();
  });
});

describe("layoutTree", () => {
  test("a lone leaf fills the dock with no splitter and no gutter", () => {
    const layout = layoutTree(leafNode("a"));

    expect(layout.leaves).toEqual([
      {
        instanceId: "a",
        box: { x: 0, y: 0, width: 1, height: 1 },
        gutters: { left: false, right: false, top: false, bottom: false },
      },
    ]);
    expect(layout.splitters).toEqual([]);
  });

  test("nested splits place every leaf in fractions of the dock", () => {
    const tree = row(
      [leafNode("a"), column([leafNode("b"), leafNode("c")], [0.25, 0.75])],
      [0.4, 0.6],
    );
    const layout = layoutTree(tree);

    expect(layout.leaves.map((leaf) => leaf.instanceId)).toEqual(["a", "b", "c"]);
    expect(layout.leaves[0]?.box).toEqual({ x: 0, y: 0, width: 0.4, height: 1 });
    expect(layout.leaves[1]?.box).toEqual({ x: 0.4, y: 0, width: 0.6, height: 0.25 });
    expect(layout.leaves[2]?.box).toEqual({ x: 0.4, y: 0.25, width: 0.6, height: 0.75 });
  });

  test("a leaf gives up a gutter only on the sides a splitter runs along", () => {
    const tree = row(
      [leafNode("a"), column([leafNode("b"), leafNode("c")], [0.5, 0.5])],
      [0.5, 0.5],
    );
    const gutters = Object.fromEntries(
      layoutTree(tree).leaves.map((leaf) => [leaf.instanceId, leaf.gutters]),
    );

    expect(gutters["a"]).toEqual({ left: false, right: true, top: false, bottom: false });
    expect(gutters["b"]).toEqual({ left: true, right: false, top: false, bottom: true });
    expect(gutters["c"]).toEqual({ left: true, right: false, top: true, bottom: false });
  });

  test("a splitter lies on the boundary and names the split it resizes", () => {
    const tree = row(
      [leafNode("a"), column([leafNode("b"), leafNode("c")], [0.25, 0.75])],
      [0.4, 0.6],
    );
    const { splitters } = layoutTree(tree);

    expect(splitters).toHaveLength(2);
    expect(splitters[0]).toMatchObject({
      path: [],
      index: 0,
      axis: "row",
      extent: 1,
      box: { x: 0.4, y: 0, width: 0, height: 1 },
    });
    expect(splitters[1]).toMatchObject({
      path: [1],
      index: 0,
      axis: "column",
      extent: 1,
      box: { x: 0.4, y: 0.25, width: 0.6, height: 0 },
    });
    expect(new Set(splitters.map((splitter) => splitter.key)).size).toBe(2);
  });

  test("a leaf keeps its identity when a sibling arrives or it moves", () => {
    const joined = insertAtEdge(leafNode("a"), "b", "bottom");
    const beside = layoutTree(insertBeside(joined, "c", "a", "right"));

    expect(layoutTree(leafNode("a")).leaves.map((leaf) => leaf.instanceId)).toEqual(["a"]);
    expect(layoutTree(joined).leaves.map((leaf) => leaf.instanceId)).toEqual(["a", "b"]);
    expect(beside.leaves.map((leaf) => leaf.instanceId)).toEqual(["a", "c", "b"]);
    expect(beside.leaves[0]?.box).toEqual({ x: 0, y: 0, width: 0.5, height: 0.5 });
  });
});
