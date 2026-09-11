export type DiffLine = { kind: "context" | "added" | "removed"; text: string };

/**
 * Line diff over the longest common subsequence. Edits are small enough that
 * the quadratic table costs nothing, and it keeps the plugin dependency-free.
 */
export function diffLines(before: string, after: string): DiffLine[] {
  const left = before.length > 0 ? before.split("\n") : [];
  const right = after.length > 0 ? after.split("\n") : [];
  const table = buildLcsTable(left, right);

  const lines: DiffLine[] = [];
  let leftIndex = 0;
  let rightIndex = 0;
  while (leftIndex < left.length && rightIndex < right.length) {
    if (left[leftIndex] === right[rightIndex]) {
      lines.push({ kind: "context", text: left[leftIndex]! });
      leftIndex += 1;
      rightIndex += 1;
    } else if (table[leftIndex + 1]![rightIndex]! >= table[leftIndex]![rightIndex + 1]!) {
      lines.push({ kind: "removed", text: left[leftIndex]! });
      leftIndex += 1;
    } else {
      lines.push({ kind: "added", text: right[rightIndex]! });
      rightIndex += 1;
    }
  }
  for (; leftIndex < left.length; leftIndex += 1)
    lines.push({ kind: "removed", text: left[leftIndex]! });
  for (; rightIndex < right.length; rightIndex += 1)
    lines.push({ kind: "added", text: right[rightIndex]! });
  return lines;
}

function buildLcsTable(left: string[], right: string[]): number[][] {
  const table = Array.from({ length: left.length + 1 }, () =>
    new Array<number>(right.length + 1).fill(0),
  );
  for (let leftIndex = left.length - 1; leftIndex >= 0; leftIndex -= 1) {
    for (let rightIndex = right.length - 1; rightIndex >= 0; rightIndex -= 1) {
      table[leftIndex]![rightIndex] =
        left[leftIndex] === right[rightIndex]
          ? table[leftIndex + 1]![rightIndex + 1]! + 1
          : Math.max(table[leftIndex + 1]![rightIndex]!, table[leftIndex]![rightIndex + 1]!);
    }
  }
  return table;
}
