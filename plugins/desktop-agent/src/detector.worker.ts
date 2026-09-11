/// <reference lib="webworker" />
/**
 * The pixel detector, off the UI thread.
 *
 * The worker fetches and decodes the asset itself, so a 4K screenshot is never an
 * `ImageData` on the main thread on its way here — only the request and the rectangles
 * cross, and the detection of an eight-megapixel image does not drop frames on the board.
 */
import { type DetectorOptions, detectRegions } from "./detector";

interface DetectRequest {
  url: string;
  options?: DetectorOptions;
}

self.onmessage = async (event: MessageEvent<DetectRequest>) => {
  const { url, options } = event.data;
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`the asset could not be read: ${response.status}`);
    const bitmap = await createImageBitmap(await response.blob());

    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("this browser gave the worker no 2d context");
    context.drawImage(bitmap, 0, 0);
    const pixels = context.getImageData(0, 0, bitmap.width, bitmap.height);
    bitmap.close();

    self.postMessage({
      regions: detectRegions(
        { width: pixels.width, height: pixels.height, data: pixels.data },
        options,
      ),
    });
  } catch (cause) {
    self.postMessage({ error: cause instanceof Error ? cause.message : String(cause) });
  }
};
