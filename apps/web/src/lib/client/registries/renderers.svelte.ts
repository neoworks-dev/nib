import type { MessageItem, ToolItem } from "@nib-ui/protocol";
import type {
  PermissionRendererProps,
  PermissionRendererRegistration,
  RendererProps,
  RendererRegistration,
  RendererRegistry,
} from "@nib-ui/ui-contracts";
import type { Component } from "svelte";
import {
  matchMessageRenderer,
  matchPermissionRenderer,
  matchToolRenderer,
  messageRegistrations,
  toolRegistrations,
} from "../renderer-matching";

export class ReactiveRendererRegistry implements RendererRegistry {
  private registrations = $state<RendererRegistration[]>([]);
  private permissionRegistrations = $state<PermissionRendererRegistration[]>([]);
  private fallback = $state<Component<RendererProps<ToolItem>> | null>(null);

  register(registration: RendererRegistration) {
    this.registrations = [...this.registrations, registration];
    return () => {
      this.registrations = this.registrations.filter((entry) => entry !== registration);
    };
  }

  setFallback(component: Component<RendererProps<ToolItem>>) {
    this.fallback = component;
    return () => {
      if (this.fallback === component) this.fallback = null;
    };
  }

  resolveTool(item: ToolItem): Component<RendererProps<ToolItem>> | null {
    const matched = matchToolRenderer(toolRegistrations(this.registrations), item);
    return matched?.component ?? this.fallback;
  }

  resolveMessage(item: MessageItem): Component<RendererProps<MessageItem>> | null {
    const matched = matchMessageRenderer(messageRegistrations(this.registrations), item);
    return matched?.component ?? null;
  }

  registerPermission(registration: PermissionRendererRegistration) {
    this.permissionRegistrations = [...this.permissionRegistrations, registration];
    return () => {
      this.permissionRegistrations = this.permissionRegistrations.filter(
        (entry) => entry !== registration,
      );
    };
  }

  resolvePermission(toolName: string): Component<PermissionRendererProps> | null {
    return matchPermissionRenderer(this.permissionRegistrations, toolName)?.component ?? null;
  }
}
