import { describe, expect, test } from "bun:test";
import { listOnce } from "../src/model-listing";

describe("listOnce", () => {
  test("asks the runtime once and keeps the answer", async () => {
    let calls = 0;
    const list = listOnce(() => {
      calls += 1;
      return Promise.resolve(["opus"]);
    });

    expect(await Promise.all([list(), list()])).toEqual([["opus"], ["opus"]]);
    expect(await list()).toEqual(["opus"]);
    expect(calls).toBe(1);
  });

  test("forgets a failure, so the next caller asks again", async () => {
    let calls = 0;
    const list = listOnce(() => {
      calls += 1;
      if (calls === 1) return Promise.reject(new Error("not logged in"));
      return Promise.resolve(["opus"]);
    });

    await expect(list()).rejects.toThrow("not logged in");
    expect(await list()).toEqual(["opus"]);
    expect(calls).toBe(2);
  });
});
