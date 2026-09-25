import { describe, expect, it } from "bun:test";
import { vaultInstructions, VAULT_GUIDE, VAULT_GUIDE_FILE } from "../src/instructions";

describe("vaultInstructions", () => {
  const prompt = vaultInstructions("/work/project/.nib");

  it("says where the vault is, which the file itself cannot", () => {
    expect(prompt).toContain("/work/project/.nib is this project's vault");
    expect(prompt).toContain(`/work/project/.nib/${VAULT_GUIDE_FILE}`);
    expect(VAULT_GUIDE).not.toContain("/work/project");
  });

  it("carries the guide verbatim, so the two layers cannot disagree", () => {
    expect(prompt.endsWith(VAULT_GUIDE)).toBe(true);
  });

  it("states every rule the vault depends on", () => {
    expect(VAULT_GUIDE).toContain("[[name]]");
    expect(VAULT_GUIDE).toContain("Never link by path");
    expect(VAULT_GUIDE).toContain("Search before you create");
    expect(VAULT_GUIDE).toContain("referenced by path");
    expect(VAULT_GUIDE).toContain("Write back as you work");
    expect(VAULT_GUIDE).toContain("What is committed");
  });
});
