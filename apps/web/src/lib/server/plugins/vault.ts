import type { Plugin } from "@nib-ui/kernel";
import { openVault, readVaultFile, statVaultFile, vaultFileStream } from "../vault";
import { listTrash, purgeTrash, restoreTrashEntry, trashVaultEntry } from "../vault-trash";
import {
  deleteVaultEntry,
  moveVaultEntry,
  renameVaultEntry,
  writeVaultFile,
  writeVaultText,
} from "../vault-write";

export const vaultPlugin: Plugin = {
  name: "vault",
  apply(ctx) {
    ctx.provide("vault", {
      open: openVault,
      readFile: readVaultFile,
      statFile: statVaultFile,
      fileStream: vaultFileStream,
      move: moveVaultEntry,
      rename: renameVaultEntry,
      write: writeVaultFile,
      writeText: writeVaultText,
      delete: deleteVaultEntry,
      trash: trashVaultEntry,
      restoreTrash: restoreTrashEntry,
      listTrash,
      purgeTrash,
    });
  },
};
