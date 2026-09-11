import { error, type RequestHandler } from "@sveltejs/kit";
import { assets } from "$lib/server/context";

export const GET: RequestHandler = async ({ params }) => {
  const stored = await assets().read(params.id ?? "");
  if (!stored) error(404, "no such asset");

  return new Response(new Uint8Array(stored.bytes), {
    headers: {
      "content-type": stored.contentType,
      "content-length": String(stored.bytes.byteLength),
      // The name is the hash of the bytes, so the answer can never change.
      "cache-control": "public, max-age=31536000, immutable",
      // Served bytes are user-supplied: never sniffed into something executable,
      // and never allowed to pull anything of its own if a viewer renders it.
      "x-content-type-options": "nosniff",
      "content-security-policy": "default-src 'none'; sandbox",
    },
  });
};
