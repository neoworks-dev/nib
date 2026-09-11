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

export async function fetchTree(sessionId: string, path: string): Promise<TreeListing> {
  const params = new URLSearchParams({ path });
  const response = await fetch(`/api/sessions/${sessionId}/tree?${params}`);
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
      return "text-dim";
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
