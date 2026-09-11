import type { BoardDoc } from "@nib-ui/ui-contracts";
import { error, type RequestHandler } from "@sveltejs/kit";
import { boards } from "$lib/server/context";

const keepAliveMs = 25_000;

/**
 * Board writes pushed to every window on the same directory. `rev` is the event
 * id, so a browser reconnect resumes with `Last-Event-ID` and the client can
 * drop anything it has already applied — including the echo of its own write.
 */
export const GET: RequestHandler = ({ url, request }) => {
  const cwd = url.searchParams.get("cwd");
  if (!cwd) error(400, "cwd is required");

  const lastEventId = request.headers.get("last-event-id");
  let sentRev = Number(lastEventId ?? url.searchParams.get("fromRev") ?? 0) || 0;

  let unsubscribe = () => {};
  let keepAlive: ReturnType<typeof setInterval> | undefined;

  const stream = new ReadableStream<string>({
    start(controller) {
      const send = (board: BoardDoc) => {
        if (board.rev <= sentRev) return;
        sentRev = board.rev;
        controller.enqueue(`id: ${board.rev}\nevent: board\ndata: ${JSON.stringify(board)}\n\n`);
      };

      unsubscribe = boards().subscribe(cwd, send);
      // A window that reconnects after a write it missed needs the current board,
      // not just the next one somebody happens to make.
      void boards().read(cwd).then(send);

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
