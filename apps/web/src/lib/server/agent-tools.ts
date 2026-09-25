import {
  type AgentControlTool,
  type AgentReport,
  type AnyAgentEvent,
  agentToolNames,
  type CanvasCard,
  formatAgentNotification,
  type HarnessCatalog,
  type HarnessRegistry,
  isKnownEvent,
  type ListAgentsResult,
  type ListHarnessesResult,
  listAgentsInputSchema,
  listHarnessesInputSchema,
  type ModelInfo,
  type PlaceOnCanvasResult,
  placeOnCanvasInputSchema,
  type ReadAgentResult,
  type ReadCanvasResult,
  readAgentInputSchema,
  readCanvasInputSchema,
  sendToAgentInputSchema,
  sessionDigest,
  type SessionStatus,
  spawnAgentInputSchema,
  type SpawnAgentResult,
  stopAgentInputSchema,
} from "@nib-ui/protocol";
import { type Placement, placementsFor, type VaultSnapshotItem } from "@nib-ui/vault";
import type { BoardService, SessionHost, VaultService } from "./services";

/** `read_agent`'s default when waiting, long enough for a real task and short enough to return. */
const defaultWaitSeconds = 600;

/** What the tools reach into: the sessions they drive, and the board they arrange. */
export interface AgentToolServices {
  host: SessionHost;
  harnesses: HarnessRegistry;
  /** Only the two calls the canvas tools make; nothing here writes a whole board. */
  boards: Pick<BoardService, "read" | "place">;
  vault: Pick<VaultService, "open">;
}

/**
 * The tools one agent drives another with and arranges the board with, bound to
 * the session that is calling them. The caller is fixed here rather than passed
 * as an argument: the model must not be able to claim to be another agent, so
 * identity comes from the link the harness was handed (PLAN §14). The catalog
 * shapes the spawn schema, so it is the caller's to fetch and cache.
 */
export function createAgentTools(
  services: AgentToolServices,
  callerId: string,
  catalog: readonly HarnessCatalog[],
): AgentControlTool[] {
  const { host, harnesses, boards, vault } = services;
  const requireFamily = (sessionId: string): void => {
    if (familyOf(host, callerId).includes(sessionId)) return;
    throw new Error(
      `session "${sessionId}" is not in your family of agents; call list_agents to see the ones you may address`,
    );
  };
  /** The project the caller is working in, which is the vault its board draws. */
  const requireCwd = (): string => {
    const cwd = host.view(callerId)?.cwd;
    if (!cwd) throw new Error(`session "${callerId}" has no working directory`);
    return cwd;
  };
  const spawnSchema = spawnAgentInputSchema(catalog);

  return [
    {
      name: agentToolNames.harnesses,
      description:
        "List the harnesses an agent can be spawned in, each with the model ids it accepts right " +
        "now, its default model, and its permission modes and effort levels. spawn_agent takes " +
        "ids from here.",
      inputSchema: listHarnessesInputSchema,
      handler: (input) => {
        listHarnessesInputSchema.parse(input);
        const result: ListHarnessesResult = { harnesses: [...catalog] };
        return Promise.resolve(result);
      },
    },
    {
      name: agentToolNames.spawn,
      description:
        "Start a new agent in the harness you name and give it a task. Returns " +
        "{ sessionId, harness, model, title } as soon as the agent exists and the prompt has been " +
        "delivered: it does NOT wait for the agent to do the work. The agent runs in the " +
        "background and its result arrives as an <agent-notification> message in a later turn of " +
        "yours, so carry on with other work; read_agent looks in on it meanwhile. The new agent " +
        "gets these same tools and can message you back with send_to_agent.",
      inputSchema: spawnSchema,
      handler: async (input) => {
        const spawn = spawnSchema.parse(input);
        const harness = catalog.find((entry) => entry.id === spawn.harness);
        if (!harness || !harnesses.get(spawn.harness)) {
          const known = catalog.map((entry) => entry.id).join(", ");
          throw new Error(`unknown harness "${spawn.harness}"; this build runs: ${known}`);
        }
        const caller = host.view(callerId);
        const cwd = spawn.cwd ?? caller?.cwd;
        if (!cwd) throw new Error(`session "${callerId}" has no working directory to spawn into`);

        // Only the keys the caller named: an explicit undefined would override
        // the harness default with nothing.
        const options: Record<string, unknown> = {};
        if (spawn.model) options.model = resolveModel(harness.models, spawn.model);
        if (spawn.permissionMode) options.permissionMode = spawn.permissionMode;
        if (spawn.effort) options.effort = spawn.effort;

        const sessionId = await host.create({
          harnessId: spawn.harness,
          cwd,
          label: spawn.label,
          options,
          parentSessionId: callerId,
        });
        // The host logs a harness that failed to start as an error on the session
        // rather than throwing; the spawner needs the failure, not a dead tab.
        const started = host.view(sessionId);
        if (started?.status === "error") {
          await host.remove(sessionId);
          throw new Error(
            `the ${spawn.harness} agent failed to start: ${started.statusDetail ?? "unknown error"}`,
          );
        }
        await host.execute(sessionId, {
          type: "session.send",
          text: `${spawnPreamble(callerId, caller?.title ?? null)}\n\n${spawn.prompt}`,
        });

        const view = host.view(sessionId);
        const result: SpawnAgentResult = {
          sessionId,
          harness: spawn.harness,
          model: view?.model ?? null,
          title: view?.title ?? null,
        };
        return result;
      },
    },
    {
      name: agentToolNames.send,
      description:
        "Send a message to an agent in your family — your parent, the agents you spawned, their " +
        "descendants and your siblings. Returns { sessionId, delivered: true } once the message is " +
        "queued; it does not wait for a reply. An agent you spawned notifies you when it answers; " +
        "read_agent is how you look at anyone else's reply.",
      inputSchema: sendToAgentInputSchema,
      handler: async (input) => {
        const { sessionId, text } = sendToAgentInputSchema.parse(input);
        requireFamily(sessionId);
        await host.execute(sessionId, { type: "session.send", text });
        return { sessionId, delivered: true };
      },
    },
    {
      name: agentToolNames.read,
      description:
        "Return one agent's report: { sessionId, harness, model, title, parentSessionId, status, " +
        "statusDetail, prompt, reply, timedOut }. `status` is working while the agent is mid-turn " +
        "and idle once it has answered; `prompt` is what it was asked and `reply` is its latest " +
        "assistant message. With wait: true it blocks until the agent stops working, giving up " +
        `after timeoutSeconds (default ${defaultWaitSeconds}) with timedOut: true and whatever the ` +
        "agent had reached by then; the agent keeps running.",
      inputSchema: readAgentInputSchema,
      handler: async (input) => {
        const { sessionId, wait, timeoutSeconds } = readAgentInputSchema.parse(input);
        requireFamily(sessionId);
        const timeoutMs = (timeoutSeconds ?? defaultWaitSeconds) * 1000;
        const timedOut = wait ? await waitUntilSettled(host, sessionId, timeoutMs) : false;
        const result: ReadAgentResult = { ...agentReport(host, sessionId), timedOut };
        return result;
      },
    },
    {
      name: agentToolNames.list,
      description:
        "List every agent you are related to. Returns { self, parent, agents }: your own session " +
        "id, the report of the agent that spawned you (null when a person started you), and a " +
        "report for every other agent sharing your root session. Those are exactly the agents " +
        "send_to_agent, read_agent and stop_agent will accept.",
      inputSchema: listAgentsInputSchema,
      handler: (input) => {
        listAgentsInputSchema.parse(input);
        const parentSessionId = host.view(callerId)?.parentSessionId ?? null;
        const parentIsHosted = parentSessionId !== null && host.has(parentSessionId);
        const result: ListAgentsResult = {
          self: callerId,
          parent: parentIsHosted ? agentReport(host, parentSessionId) : null,
          agents: familyOf(host, callerId)
            .filter((id) => id !== callerId && id !== parentSessionId)
            .map((id) => agentReport(host, id)),
        };
        return Promise.resolve(result);
      },
    },
    {
      name: agentToolNames.stop,
      description:
        "Interrupt an agent and shut its harness process down, then return its final report. Its " +
        "transcript stays readable to read_agent, but it will do no more work.",
      inputSchema: stopAgentInputSchema,
      handler: async (input) => {
        const { sessionId } = stopAgentInputSchema.parse(input);
        requireFamily(sessionId);
        // Interrupting a detached session would restart its harness purely to
        // stop it again, so only a live turn is interrupted.
        const status = host.view(sessionId)?.status;
        if (status === "working" || status === "awaiting-permission") {
          await host.execute(sessionId, { type: "session.interrupt" });
        }
        await host.execute(sessionId, { type: "session.close" });
        return agentReport(host, sessionId);
      },
    },
    {
      name: agentToolNames.canvas,
      description:
        "The board for one directory of this project's vault, as it is laid out right now. " +
        "Returns { cwd, directory, cards }: one card per item in that directory, each with the " +
        "rectangle it occupies — x/y is its top-left corner in board coordinates, y grows " +
        "downward, and a card is typically 240–340 wide and 130–420 tall. `rect` is null for an " +
        "item nobody has placed yet. Every topic is a board of its own, so pass `directory` to " +
        "read inside one; a card only ever sits on the board of the directory its file is in.",
      inputSchema: readCanvasInputSchema,
      handler: async (input) => {
        const { directory } = readCanvasInputSchema.parse(input);
        const board = directory ?? "";
        const cwd = requireCwd();
        const [doc, stored] = await Promise.all([vault.open(cwd), boards.read(cwd)]);
        const placements = placementsFor(stored.placements, board);
        const result: ReadCanvasResult = {
          cwd,
          directory: board,
          cards: doc.items
            .filter((item) => item.dir === board)
            .map((item) => canvasCard(item, placements[item.path])),
        };
        return result;
      },
    },
    {
      name: agentToolNames.place,
      description:
        "Put cards where you want them on the board. Takes { items: [{ path, x, y, w?, h? }] } in " +
        "the coordinates read_canvas reports and writes them as one revision, so every open " +
        "window redraws the whole arrangement at once. Read the board first, then place what " +
        "belongs together side by side — leave about 32 units of gap between cards so they do " +
        "not touch. Size defaults to the card's current size; pass w/h only to resize. This is " +
        "the only way you have of saying where something sits: writing the file puts a card on " +
        "the board, and this decides where. It never moves the file — a card sits on the board " +
        "of the directory its file is in, and changing that is a `mv`. A card you place leaves " +
        "any pile it was folded into.",
      inputSchema: placeOnCanvasInputSchema,
      handler: async (input) => {
        const { items } = placeOnCanvasInputSchema.parse(input);
        const cwd = requireCwd();
        const doc = await vault.open(cwd);
        const known = new Map(doc.items.map((item) => [item.path, item]));

        const missing = items.map((item) => item.path).filter((path) => !known.has(path));
        if (missing.length > 0) {
          throw new Error(
            `the vault has nothing at ${missing.join(", ")}; call read_canvas for the paths it does have`,
          );
        }

        const stored = await boards.place(cwd, items);
        const moved = new Set(items.map((item) => item.path));
        const result: PlaceOnCanvasResult = {
          cards: doc.items
            .filter((item) => moved.has(item.path))
            .map((item) => canvasCard(item, placementsFor(stored.placements, item.dir)[item.path])),
        };
        return result;
      },
    },
  ];
}

/** One vault item as a board reports it. An item with no placement is on no board yet. */
function canvasCard(item: VaultSnapshotItem, placement: Placement | undefined): CanvasCard {
  return {
    path: item.path,
    name: item.name,
    kind: item.kind,
    title: item.title,
    rect: placement ? { x: placement.x, y: placement.y, w: placement.w, h: placement.h } : null,
    stack: placement?.stack ?? null,
  };
}

/**
 * Every harness with the models it takes right now. An adapter that can ask its
 * runtime answers live; otherwise its static list stands, widened by whatever a
 * session of that harness has reported — Claude Code only names its models from
 * inside a running process, and the spawner usually is one.
 */
export async function harnessCatalog(
  host: SessionHost,
  harnesses: HarnessRegistry,
): Promise<HarnessCatalog[]> {
  const reported = new Map<string, ModelInfo[]>();
  for (const summary of host.list()) {
    const models = host.view(summary.id)?.models ?? [];
    if (models.length === 0) continue;
    reported.set(summary.harnessId, [...(reported.get(summary.harnessId) ?? []), ...models]);
  }

  return Promise.all(
    harnesses.list().map(async (descriptor) => {
      const adapter = harnesses.get(descriptor.id);
      let listed = descriptor.models;
      if (adapter?.listModels) {
        try {
          listed = await adapter.listModels();
        } catch {
          // The static list stands in for a runtime that cannot answer.
        }
      }
      const models = new Map<string, ModelInfo>();
      for (const model of [...listed, ...(reported.get(descriptor.id) ?? [])]) {
        if (!models.has(model.id)) models.set(model.id, model);
      }
      return {
        id: descriptor.id,
        displayName: descriptor.displayName,
        defaultModel: descriptor.defaultModel ?? null,
        models: [...models.values()],
        permissionModes: descriptor.capabilities.permissionModes,
        effortLevels: descriptor.capabilities.effortLevels ?? [],
      };
    }),
  );
}

/**
 * An exact id passes as is. Otherwise the request is read as words, and a
 * single model whose id or display name carries all of them wins: "deepseek
 * v4.1 flash" finds `deepseek/deepseek-v4.1-flash` without the caller knowing
 * pi's provider syntax. Several matches are the caller's to pick between; none
 * passes through, because the catalog is not complete for every harness and the
 * harness itself is the judge of what it runs.
 */
export function resolveModel(models: readonly ModelInfo[], requested: string): string {
  if (models.some((model) => model.id === requested)) return requested;
  const words = requested
    .toLowerCase()
    .split(/[^a-z0-9.]+/)
    .filter((word) => word.length > 0);
  const matches = models.filter((model) => {
    const haystack = `${model.id} ${model.displayName ?? ""}`.toLowerCase();
    return words.every((word) => haystack.includes(word));
  });
  const [only] = matches;
  if (matches.length === 1 && only) return only.id;
  if (matches.length > 1) {
    const ids = matches.map((model) => model.id).join(", ");
    throw new Error(`"${requested}" matches several models: ${ids}; pass one of those ids`);
  }
  return requested;
}

/**
 * What the spawned agent is told before its task. It is talking to another agent
 * rather than to a person, and nothing else in its context would say so.
 */
function spawnPreamble(callerId: string, callerTitle: string | null): string {
  const caller = callerTitle ? `"${callerTitle}" (session ${callerId})` : `session ${callerId}`;
  return [
    `You were spawned by another agent, ${caller}. You are answering it, not a person.`,
    `You have the same agent tools it has: send_to_agent on sessionId "${callerId}" to ask it something mid-task, and list_harnesses, spawn_agent, list_agents and read_agent to delegate further or check on others.`,
    "When you finish a turn, your latest assistant message is delivered to it as a notification. So end your turn by stating the result in full, rather than only writing it to a file or announcing that you are done.",
    "Here is the task:",
  ].join("\n\n");
}

/**
 * Watches every session's status and, when one that an agent spawned finishes a
 * turn, delivers its report to that agent as a new message. Only a turn's end
 * counts — a session closing, or coming back idle after a restart, is not an
 * answer — and only a spawner whose harness is running can take delivery.
 */
export function createAgentNotifier(
  host: SessionHost,
): (sessionId: string, event: AnyAgentEvent) => void {
  const previous = new Map<string, SessionStatus>();
  return (sessionId, event) => {
    if (!isKnownEvent(event) || event.type !== "session.status") return;
    const before = previous.get(sessionId) ?? "idle";
    const status = event.data.status;
    if (status === "closed") previous.delete(sessionId);
    else previous.set(sessionId, status);
    if (isSettled(before) || (status !== "idle" && status !== "error")) return;

    const parentSessionId = host.view(sessionId)?.parentSessionId;
    if (!parentSessionId) return;
    const parent = host.list().find((summary) => summary.id === parentSessionId);
    if (!parent?.live || parent.status === "closed") return;
    const text = formatAgentNotification(agentReport(host, sessionId));
    // A spawner whose process dies between the check and the send has nowhere
    // for the report to go; the child's transcript still holds it.
    void host.execute(parentSessionId, { type: "session.send", text }).catch(() => undefined);
  };
}

export function agentReport(host: SessionHost, sessionId: string): AgentReport {
  const view = host.view(sessionId);
  if (!view?.harnessId) throw new Error(`no agent session "${sessionId}"`);
  const digest = sessionDigest(view);
  return {
    sessionId,
    harness: view.harnessId,
    model: view.model,
    title: view.title,
    parentSessionId: view.parentSessionId,
    status: view.status,
    statusDetail: view.statusDetail,
    prompt: digest.prompt,
    reply: digest.reply,
  };
}

/** Every session descending from the same root as `sessionId`, including itself. */
export function familyOf(host: SessionHost, sessionId: string): string[] {
  const root = rootOf(host, sessionId);
  return host
    .list()
    .filter((summary) => rootOf(host, summary.id) === root)
    .map((summary) => summary.id);
}

/** Walks lineage up to the session a person started. A parent the host no longer has ends the walk. */
function rootOf(host: SessionHost, sessionId: string): string {
  const seen = new Set<string>();
  let current = sessionId;
  while (!seen.has(current)) {
    seen.add(current);
    const parent = host.view(current)?.parentSessionId;
    if (!parent || !host.has(parent)) return current;
    current = parent;
  }
  return current;
}

/** Anything but these two means the agent is between turns and has something to report. */
function isSettled(status: SessionStatus): boolean {
  return status !== "working" && status !== "awaiting-permission";
}

/** Resolves true when the timeout won the race. */
function waitUntilSettled(
  host: SessionHost,
  sessionId: string,
  timeoutMs: number,
): Promise<boolean> {
  const view = host.view(sessionId);
  if (!view) throw new Error(`no agent session "${sessionId}"`);
  if (isSettled(view.status)) return Promise.resolve(false);

  return new Promise<boolean>((resolve) => {
    let done = false;
    const finish = (timedOut: boolean): void => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      unsubscribe();
      resolve(timedOut);
    };
    const unsubscribe = host.subscribe(sessionId, (event) => {
      if (!isKnownEvent(event) || event.type !== "session.status") return;
      if (isSettled(event.data.status)) finish(false);
    });
    const timer = setTimeout(() => finish(true), timeoutMs);
  });
}
