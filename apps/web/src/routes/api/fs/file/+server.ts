import { resolve } from "node:path";
import { error, type RequestHandler } from "@sveltejs/kit";

const maxBytes = 1_000_000;

/**
 * One file out of a project directory, as text. The viewer reads a project file
 * here rather than through `/api/sessions/:id/file`, which can only name a file
 * that some open conversation happens to sit in.
 */
export const GET: RequestHandler = async ({ url }) => {
  const cwd = url.searchParams.get("cwd");
  if (!cwd) error(400, "cwd is required");

  const requested = url.searchParams.get("path");
  if (!requested) error(400, "path is required");

  const root = resolve(cwd);
  const absolute = resolve(root, requested);
  if (absolute !== root && !absolute.startsWith(`${root}/`))
    error(403, "path is outside the project");

  const file = Bun.file(absolute);
  if (!(await file.exists())) error(404, `no such file "${requested}"`);
  if (file.size > maxBytes) error(413, `file is larger than ${maxBytes} bytes`);

  return new Response(await file.text(), {
    headers: {
      // The bytes are the user's own, but this origin serves the app: nothing it
      // hands back is allowed to run, and no type may be guessed at from them.
      "Content-Type": "text/plain; charset=utf-8",
      "Content-Security-Policy": "default-src 'none'; sandbox",
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "no-cache",
    },
  });
};
