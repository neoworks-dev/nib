import type { AnyAgentEvent } from "@nib-ui/protocol";
import { error, type RequestHandler } from "@sveltejs/kit";
import { sessionHost } from "$lib/server/context";

const keepAliveMs = 25_000;

/**
 * Replay-then-live event stream. `fromSeq` (or `Last-Event-ID` on a browser
 * reconnect) decides where replay starts; the subscription is opened before the
 * replay so nothing emitted mid-replay is lost.
 */
export const GET: RequestHandler = ({ params, url, request }) => {
  const sessionId = params.id!;
  const host = sessionHost();
  if (!host.has(sessionId)) error(404, `unknown session "${sessionId}"`);

  const lastEventId = request.headers.get("last-event-id");
  const fromSeq = Number(lastEventId ?? url.searchParams.get("fromSeq") ?? 0) || 0;

  let unsubscribe = () => {};
  let keepAlive: ReturnType<typeof setInterval> | undefined;

  const stream = new ReadableStream<string>({
    start(controller) {
      let sentSeq = fromSeq;
      let live = false;
      const buffered: AnyAgentEvent[] = [];
      const send = (event: AnyAgentEvent) => {
        if (event.seq <= sentSeq) return;
        sentSeq = event.seq;
        controller.enqueue(`id: ${event.seq}\nevent: agent\ndata: ${JSON.stringify(event)}\n\n`);
      };

      unsubscribe = host.subscribe(sessionId, (event) =>
        live ? send(event) : buffered.push(event),
      );
      for (const event of host.eventsSince(sessionId, fromSeq)) send(event);
      for (const event of buffered) send(event);
      live = true;

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
