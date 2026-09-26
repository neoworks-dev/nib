/**
 * Wraps a model listing so the runtime is asked once. Asking costs a process
 * start, so a successful answer is kept for the life of the server; a failed one
 * is forgotten, so the next caller — after a login, say — gets a second chance.
 */
export function listOnce<T>(load: () => Promise<T>): () => Promise<T> {
  let pending: Promise<T> | null = null;
  return () => {
    if (pending === null) {
      pending = load().catch((error: unknown) => {
        pending = null;
        throw error;
      });
    }
    return pending;
  };
}
