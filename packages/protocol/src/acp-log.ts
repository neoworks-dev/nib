import type { HarnessEvent, SessionUpdate, Usage } from "@neoworks/harness";
import type { EmittedEvent } from "./events";

/**
 * Turns what the shared harness reports into what a session's log stores.
 *
 * ACP updates are logged as the harness reported them. Three kinds are left out
 * because the log has a better place for what they say: running totals (the
 * `usage` event), the prompts echoed back on a resumed session (`user.message`
 * records them as sent), and mode or option changes (nib sets those itself and
 * logs them as `session.meta`).
 *
 * One instance follows one session, since a repeat is only a repeat of the event
 * before it.
 */
export class HarnessEventLog {
  private lastUsage = "";
  private lastCommands = "";

  /** The log events one harness event becomes; none when it adds nothing. */
  events(event: HarnessEvent): EmittedEvent[] {
    switch (event.type) {
      case "update":
        return this.updateEvents(event.update);
      case "usage":
        return this.usageEvents(event.total, event.context);
      case "session_changed":
        return this.changedEvents(event.sessionId);
      case "done":
        return this.doneEvents(event.stopReason, event.usage);
      case "permission":
        // Answered through `onPermission`, which logs the request it holds.
        return [];
    }
  }

  /** The conversation moved to a new id, so the totals and the transcript start over. */
  private changedEvents(sessionId: string): EmittedEvent[] {
    this.lastUsage = "";
    return [
      { type: "session.cleared", data: { reason: "the harness started a new conversation", nativeSessionId: sessionId } },
    ];
  }

  /** The turn's end, and the session going idle with it. */
  private doneEvents(stopReason: string, usage: Usage | undefined): EmittedEvent[] {
    const events: EmittedEvent[] = [{ type: "turn.done", data: { stopReason, usage } }];
    const notice = stopNotice(stopReason);
    if (notice !== null) {
      events.push({ type: "log", data: { level: "warn", message: notice } });
    }
    events.push({ type: "session.status", data: { status: "idle" } });
    return events;
  }

  /** The update itself, unless it is one the log keeps elsewhere or has just been told. */
  private updateEvents(update: SessionUpdate): EmittedEvent[] {
    switch (update.sessionUpdate) {
      case "usage_update":
      case "user_message_chunk":
      case "current_mode_update":
      case "config_option_update":
        return [];
      case "available_commands_update":
        return this.commandsEvents(update);
      default:
        return [{ type: "update", data: { update } }];
    }
  }

  /** The command list is repeated whole whenever it is announced; only a change is news. */
  private commandsEvents(update: SessionUpdate): EmittedEvent[] {
    const serialized = JSON.stringify(update);
    if (serialized === this.lastCommands) return [];
    this.lastCommands = serialized;
    return [{ type: "update", data: { update } }];
  }

  /** The session's running totals, when they differ from the last report. */
  private usageEvents(total: Usage, context: { used: number; size: number } | undefined): EmittedEvent[] {
    if (Object.keys(total).length === 0) return [];
    const serialized = JSON.stringify([total, context]);
    if (serialized === this.lastUsage) return [];
    this.lastUsage = serialized;
    return [{ type: "usage", data: { total, context } }];
  }
}


/** What to tell the person about a turn that stopped short of finishing. */
function stopNotice(stopReason: string): string | null {
  if (stopReason === "max_tokens") return "The reply hit the output token limit.";
  if (stopReason === "max_turn_requests") return "The turn hit its request or budget limit.";
  if (stopReason === "refusal") return "The model declined to continue.";
  return null;
}
