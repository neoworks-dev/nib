import { agentFamily } from "@nib-ui/plugin-chat";
import type { SessionSummary } from "@nib-ui/ui-contracts";

/** One row of the chat overview. */
export interface ChatListEntry {
  sessionId: string;
  title: string;
  updatedAt: number;
  /** True while the chat, or any agent it spawned, is working or waiting on the user. */
  running: boolean;
  /** True when the chat itself or one of its agents is waiting for an answer. */
  needsInput: boolean;
  /** The newest thing the agent said, for the row's second line; null before it has replied. */
  preview: string | null;
}

/** A labelled run of rows in the overview. */
export interface ChatListGroup {
  label: string;
  entries: ChatListEntry[];
}

const DAY = 24 * 60 * 60 * 1000;

/** What a chat is called in the list: its title, else what it was first asked. */
export function chatTitle(summary: SessionSummary): string {
  if (summary.title) return summary.title;
  const prompt = summary.digest.prompt?.trim();
  if (prompt) return prompt;
  return "Untitled chat";
}

/**
 * The chats a project has, newest first. Only the sessions a user started are
 * listed: an agent another agent spawned is read through its parent's tabs, so
 * its work shows as the parent running instead of as a row of its own.
 */
export function chatList(summaries: SessionSummary[], cwd: string): ChatListEntry[] {
  return summaries
    .filter((summary) => summary.cwd === cwd && !summary.archived && !summary.parentSessionId)
    .filter(hasContent)
    .map((summary) => entryFor(summaries, summary))
    .sort((left, right) => right.updatedAt - left.updatedAt);
}

/**
 * Whether a chat has been asked or has answered anything. One that was opened and
 * never used is not worth a row, unless it is working on something right now.
 */
function hasContent(summary: SessionSummary): boolean {
  if (summary.status === "working") return true;
  return Boolean(summary.digest.prompt?.trim()) || Boolean(summary.digest.reply?.trim());
}

/** One chat's row, with its family's activity folded into it. */
function entryFor(summaries: SessionSummary[], summary: SessionSummary): ChatListEntry {
  const family = agentFamily(summaries, summary.id);
  const needsInput = family.some((member) => member.status === "awaiting-permission");
  const working = family.some((member) => member.status === "working");
  return {
    sessionId: summary.id,
    title: chatTitle(summary),
    updatedAt: Math.max(...family.map((member) => member.updatedAt)),
    running: working || needsInput,
    needsInput,
    preview: previewOf(summary.digest.reply),
  };
}

/** A reply cut to its first line, which is all a row has room for. */
function previewOf(reply: string | null): string | null {
  if (!reply) return null;
  const line = reply.trim().split("\n")[0]?.trim();
  if (!line) return null;
  return line;
}

/**
 * The overview's sections. Running chats come first whatever their age, because
 * several can be at work at once and those are the ones to keep an eye on; the
 * rest are grouped by how long ago they last moved, the way chat apps do.
 */
export function groupChats(entries: ChatListEntry[], now: number): ChatListGroup[] {
  const startOfToday = new Date(now).setHours(0, 0, 0, 0);
  const groups: ChatListGroup[] = [
    { label: "Running", entries: [] },
    { label: "Today", entries: [] },
    { label: "Yesterday", entries: [] },
    { label: "Previous 7 days", entries: [] },
    { label: "Older", entries: [] },
  ];
  for (const entry of entries) {
    const group = groups[groupIndex(entry, startOfToday)];
    if (group) group.entries.push(entry);
  }
  return groups.filter((group) => group.entries.length > 0);
}

/** Which of the overview's sections one chat belongs in, by position. */
function groupIndex(entry: ChatListEntry, startOfToday: number): number {
  if (entry.running) return 0;
  if (entry.updatedAt >= startOfToday) return 1;
  if (entry.updatedAt >= startOfToday - DAY) return 2;
  if (entry.updatedAt >= startOfToday - 7 * DAY) return 3;
  return 4;
}

/** The chats whose title or last reply contains the query, ignoring case; all of them for a blank query. */
export function filterChats(entries: ChatListEntry[], query: string): ChatListEntry[] {
  const needle = query.trim().toLowerCase();
  if (needle.length === 0) return entries;
  return entries.filter((entry) => {
    if (entry.title.toLowerCase().includes(needle)) return true;
    if (entry.preview === null) return false;
    return entry.preview.toLowerCase().includes(needle);
  });
}
