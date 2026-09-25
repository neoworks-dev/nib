import type { RequestHandler } from "@sveltejs/kit";
import type { ComfyRun } from "@nib-ui/ui-contracts";
import { comfyui } from "$lib/server/context";

const keepAliveMs = 25_000;

/** One run as a server-sent event. */
function runEvent(run: ComfyRun): string {
  return `event: run\ndata: ${JSON.stringify(run)}\n\n`;
}

/**
 * Every run the server holds, oldest first so a client applying them in order
 * ends on the newest, then each change to one. A reconnect replays the lot, which
 * is how a window that slept catches up.
 */
export const GET: RequestHandler = () => {
  let unsubscribe = (): void => {};
  let keepAlive: ReturnType<typeof setInterval> | undefined;

  const stream = new ReadableStream<string>({
    start(controller) {
      const service = comfyui();
      for (const run of service.runs().reverse()) controller.enqueue(runEvent(run));
      unsubscribe = service.subscribe((run) => controller.enqueue(runEvent(run)));
      keepAlive = setInterval(() => controller.enqueue(": keep-alive\n\n"), keepAliveMs);
    },
    cancel() {
      unsubscribe();
      clearInterval(keepAlive);
    },
  });

  return new Response(stream.pipeThrough(new TextEncoderStream()), {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-store",
      connection: "keep-alive",
    },
  });
};
