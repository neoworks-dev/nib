/**
 * A composer with no session behind it yet: a workstream that was written down
 * and not launched. It carries the same four picks a running session exposes, so
 * the composer renders one set of controls either way — here they are held until
 * the first prompt starts the session, rather than sent as commands.
 */
export interface PendingComposer {
  /** Draft key while there is no session id to key by. */
  id: string;
  harnessId: string | null;
  model: string | null;
  permissionMode: string | null;
  effort: string | null;
  /** True while the session is being created, so the send button stops. */
  busy?: boolean;
  setHarness(harnessId: string): void;
  setModel(model: string): void;
  setPermissionMode(mode: string): void;
  setEffort(effort: string): void;
  /** Sends the first prompt, which is what creates the session. */
  start(text: string): Promise<void>;
}
