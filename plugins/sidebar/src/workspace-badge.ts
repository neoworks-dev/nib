export function workspaceInitials(name: string): string {
  const [first, second] = name.split(/[^\p{L}\p{N}]+/u).filter((word) => word.length > 0);
  if (!first) return "?";
  if (!second) return first.slice(0, 2).toUpperCase();
  return `${first[0]}${second[0]}`.toUpperCase();
}

export function workspaceIconUrl(path: string): string {
  return `/api/fs/workspace-icon?path=${encodeURIComponent(path)}`;
}
