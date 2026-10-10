import { expect, test } from "bun:test";
import { themeReadInDerived } from "./derived-theme.svelte";

test("the first read happens inside a derived without writing state there", async () => {
  const documentStub = { documentElement: { dataset: { theme: "dark" }, nodeType: 1 } };
  Object.assign(globalThis, {
    document: documentStub,
    MutationObserver: class {
      observe(): void {}
    },
  });

  expect(themeReadInDerived()).toBe("dark");
  await Promise.resolve();
  expect(themeReadInDerived()).toBe("dark");
});
