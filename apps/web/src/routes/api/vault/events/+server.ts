import { error, type RequestHandler } from "@sveltejs/kit";
import { watchVault } from "$lib/server/vault-watch";

const keepAliveMs = 25_000;

/**
 * "The vault changed" and nothing else. A scan is a directory walk, and pushing
 * one down every open stream would make a model's write cost a walk per window;
 * the client re-reads through `GET /api/vault`, which is the same path the manual
 * refresh takes.
 */
export const GET: RequestHandler = ({ url }) => {
  const cwd = url.searchParams.get("cwd");
  if (!cwd) error(400, "cwd is required");

  let unsubscribe = (): void => {};
  let keepAlive: ReturnType<typeof setInterval> | undefined;

  const stream = new ReadableStream<string>({
    start(controller) {
      unsubscribe = watchVault(cwd, () => controller.enqueue(`event: vault\ndata: {}\n\n`));
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
