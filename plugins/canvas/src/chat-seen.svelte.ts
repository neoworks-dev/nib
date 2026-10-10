import type { ChatListEntry } from "./chat-list";

const STORAGE_KEY = "nib.chat-seen";

/**
 * When each chat was last looked at, so the overview can mark the ones that
 * moved since. Kept in the browser: it is a per-person reading position, not
 * something the project's vault should carry.
 */
class ChatSeen {
  private seenAt = $state<Record<string, number>>(readStored());

  /**
   * Records the current state of every chat nobody has looked at yet, so a
   * first run does not mark the whole history as unread; only what moves after
   * this is news.
   */
  seed(entries: ChatListEntry[]): void {
    const additions: Record<string, number> = {};
    for (const entry of entries) {
      if (this.seenAt[entry.sessionId] === undefined) additions[entry.sessionId] = entry.updatedAt;
    }
    if (Object.keys(additions).length === 0) return;
    this.write({ ...this.seenAt, ...additions });
  }

  /** Marks a chat as read up to the moment it last moved. */
  markSeen(entry: ChatListEntry): void {
    if (this.seenAt[entry.sessionId] === entry.updatedAt) return;
    this.write({ ...this.seenAt, [entry.sessionId]: entry.updatedAt });
  }

  /** The chats that stopped moving after the user last looked at them. */
  unreadIds(entries: ChatListEntry[]): Set<string> {
    const unread = new Set<string>();
    for (const entry of entries) {
      const seen = this.seenAt[entry.sessionId];
      if (seen === undefined || entry.running) continue;
      if (entry.updatedAt > seen) unread.add(entry.sessionId);
    }
    return unread;
  }

  private write(next: Record<string, number>): void {
    this.seenAt = next;
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  }
}

/** The stored positions, or none when storage is missing or holds something else. */
function readStored(): Record<string, number> {
  if (typeof localStorage === "undefined") return {};
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw === null) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return {};
    return parsed as Record<string, number>;
  } catch {
    return {};
  }
}

export const chatSeen = new ChatSeen();
