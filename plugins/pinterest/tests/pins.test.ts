import { describe, expect, test } from "bun:test";
import { parsePinTransfer, pinFileName, type PinterestPin } from "../src/pins";

const pin: PinterestPin = {
  id: "12345",
  url: "https://www.pinterest.com/pin/12345/",
  title: "Brutalist stair detail",
  description: "concrete",
  link: "https://example.com/stair",
  imageUrl: "https://i.pinimg.com/1200x/ab/cd.jpg",
  width: 1200,
  height: 1600,
};

describe("parsePinTransfer", () => {
  test("round-trips what the pane puts on the drag", () => {
    expect(parsePinTransfer(JSON.stringify([pin]))).toEqual([pin]);
  });

  test("keeps the optional fields off when they are absent", () => {
    const { id, url, title, imageUrl, width, height } = pin;
    const bare = { id, url, title, imageUrl, width, height };
    expect(parsePinTransfer(JSON.stringify([bare]))).toEqual([bare]);
  });

  test("drops entries without an id, a page or a picture", () => {
    const broken = [
      { ...pin, id: "" },
      { ...pin, imageUrl: "" },
      { ...pin, url: undefined },
      "not a pin",
    ];
    expect(parsePinTransfer(JSON.stringify(broken))).toEqual([]);
  });

  test("is empty for anything that is not a json array", () => {
    expect(parsePinTransfer("")).toEqual([]);
    expect(parsePinTransfer("{}")).toEqual([]);
    expect(parsePinTransfer("nonsense")).toEqual([]);
  });
});

describe("pinFileName", () => {
  test("turns a pin title into something file-like", () => {
    expect(pinFileName(pin)).toBe("Brutalist-stair-detail");
    expect(pinFileName({ ...pin, title: "50% off! (really)" })).toBe("50-off-really");
    expect(pinFileName({ ...pin, title: "  spaced  out  " })).toBe("spaced-out");
  });

  test("falls back to the pin id when the title leaves nothing", () => {
    expect(pinFileName({ ...pin, title: "※ ※ ※" })).toBe("pin-12345");
    expect(pinFileName({ ...pin, title: "" })).toBe("pin-12345");
  });

  test("caps the length so a caption never becomes the name", () => {
    expect(pinFileName({ ...pin, title: "a".repeat(200) }).length).toBe(60);
  });
});
