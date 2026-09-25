export interface TreeEntry {
  name: string;
  path: string;
  directory: boolean;
  /** Git porcelain code, `child` when a descendant changed, or null when clean. */
  status: string | null;
}

export interface TreeListing {
  path: string;
  entries: TreeEntry[];
}

/** One directory level of the project on screen, addressed by the directory itself. */
export async function fetchTree(cwd: string, path: string): Promise<TreeListing> {
  const params = new URLSearchParams({ cwd, path });
  const response = await fetch(`/api/fs/tree?${params.toString()}`);
  if (!response.ok) throw new Error(await response.text());
  return (await response.json()) as TreeListing;
}

/** Green for new, amber for modified, red for deleted, dim for a changed subtree. */
export function statusTone(status: string | null): string {
  switch (status) {
    case "A":
    case "?":
      return "text-green";
    case "M":
    case "R":
      return "text-amber";
    case "D":
      return "text-red";
    case "child":
      return "text-muted";
    default:
      return "text-default";
  }
}

export function statusMark(status: string | null): string {
  switch (status) {
    case "?":
      return "U";
    case "child":
      return "";
    default:
      return status ?? "";
  }
}
