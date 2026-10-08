import type { MessageItem, ToolItem } from "@nib-ui/protocol";
import type {
  MessageRendererRegistration,
  PermissionRendererRegistration,
  RendererRegistration,
  ToolRendererRegistration,
} from "@nib-ui/ui-contracts";

/** The registrations that draw tool calls, out of everything registered. */
export function toolRegistrations(
  registrations: RendererRegistration[],
): ToolRendererRegistration[] {
  return registrations.filter((entry): entry is ToolRendererRegistration => entry.type === "tool");
}

/** The registrations that draw messages and thoughts. */
export function messageRegistrations(
  registrations: RendererRegistration[],
): MessageRendererRegistration[] {
  return registrations.filter(
    (entry): entry is MessageRendererRegistration => entry.type !== "tool",
  );
}

/**
 * The renderer for a tool call. A registration only matches the calls it names:
 * naming the tool is worth more than naming its ACP kind, which is worth more
 * than naming neither; ties go to the higher priority.
 */
export function matchToolRenderer(
  registrations: ToolRendererRegistration[],
  tool: ToolItem,
): ToolRendererRegistration | undefined {
  let best: ToolRendererRegistration | undefined;
  let bestSpecificity = -1;
  for (const entry of registrations) {
    if (entry.toolName !== undefined && entry.toolName !== tool.name) continue;
    if (entry.toolKind !== undefined && entry.toolKind !== tool.kind) continue;
    const specificity = specificityOf(entry);
    if (specificity < bestSpecificity) continue;
    if (specificity === bestSpecificity && !outranks(entry, best)) continue;
    best = entry;
    bestSpecificity = specificity;
  }
  return best;
}

/** The renderer for a message or thought: the highest priority of its type. */
export function matchMessageRenderer(
  registrations: MessageRendererRegistration[],
  message: MessageItem,
): MessageRendererRegistration | undefined {
  return highestPriority(registrations.filter((entry) => entry.type === message.type));
}

export function matchPermissionRenderer(
  registrations: PermissionRendererRegistration[],
  toolName: string,
): PermissionRendererRegistration | undefined {
  return highestPriority(registrations.filter((entry) => entry.toolName === toolName));
}

/** Naming the tool is worth more than naming its kind. */
function specificityOf(entry: ToolRendererRegistration): number {
  let specificity = 0;
  if (entry.toolName !== undefined) specificity += 2;
  if (entry.toolKind !== undefined) specificity += 1;
  return specificity;
}

function outranks(
  entry: ToolRendererRegistration,
  best: ToolRendererRegistration | undefined,
): boolean {
  if (best === undefined) return true;
  return (entry.priority ?? 0) > (best.priority ?? 0);
}

function highestPriority<T extends { priority?: number }>(entries: T[]): T | undefined {
  return entries.reduce<T | undefined>(
    (best, entry) => ((entry.priority ?? 0) > (best?.priority ?? -Infinity) ? entry : best),
    undefined,
  );
}
