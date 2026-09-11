import type { DetectedRegion } from "@nib-ui/ui-contracts";
import { type DetectorOptions, detectRegions } from "./detector";

/**
 * Runs the pixel detector over a stored capture, in a worker where there is one.
 *
 * The fallback is not a second implementation: it is the same pure `detectRegions` called
 * on this thread. A browser that refuses the worker gets a board that stutters for a moment
 * rather than a feature that is missing.
 */
export async function detectInAsset(
  url: string,
  options?: DetectorOptions,
): Promise<DetectedRegion[]> {
  try {
    return await inWorker(url, options);
  } catch {
    return inline(url, options);
  }
}

function inWorker(url: string, options?: DetectorOptions): Promise<DetectedRegion[]> {
  const worker = new Worker(new URL("./detector.worker.ts", import.meta.url), { type: "module" });
  return new Promise<DetectedRegion[]>((resolve, reject) => {
    worker.onmessage = (event: MessageEvent<{ regions?: DetectedRegion[]; error?: string }>) => {
      worker.terminate();
      if (event.data.error) reject(new Error(event.data.error));
      else resolve(event.data.regions ?? []);
    };
    worker.onerror = (event) => {
      worker.terminate();
      reject(new Error(event.message || "the detector worker failed"));
    };
    worker.postMessage({ url, options });
  });
}

async function inline(url: string, options?: DetectorOptions): Promise<DetectedRegion[]> {
  const response = await fetch(url);
  if (!response.ok) return [];
  const bitmap = await createImageBitmap(await response.blob());

  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) {
    bitmap.close();
    return [];
  }
  context.drawImage(bitmap, 0, 0);
  const pixels = context.getImageData(0, 0, bitmap.width, bitmap.height);
  bitmap.close();

  return detectRegions({ width: pixels.width, height: pixels.height, data: pixels.data }, options);
}
