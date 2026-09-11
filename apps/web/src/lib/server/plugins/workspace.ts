import type { Plugin } from "@nib-ui/kernel";
import type { WorkspaceService } from "../services";
import { findWorkspaceIcon } from "../workspace-icon";
import { isDirectory, listDirectories, searchFiles } from "../workspace-probe";

const workspace: WorkspaceService = {
  listDirectories: (path) => listDirectories(path),
  searchFiles: (cwd, query, limit) => searchFiles(cwd, query, limit),
  isDirectory,
  findIcon: findWorkspaceIcon,
};

export const workspacePlugin: Plugin = {
  name: "workspace",
  apply(ctx) {
    ctx.provide("workspace", workspace);
  },
};
