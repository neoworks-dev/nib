import type { Plugin } from "@nib-ui/kernel";
import { openVault, readVaultFile } from "../vault";
import { deleteVaultEntry, moveVaultEntry, writeVaultFile, writeVaultText } from "../vault-write";

export const vaultPlugin: Plugin = {
  name: "vault",
  apply(ctx) {
    ctx.provide("vault", {
      open: openVault,
      readFile: readVaultFile,
      move: moveVaultEntry,
      write: writeVaultFile,
      writeText: writeVaultText,
      delete: deleteVaultEntry,
    });
  },
};
