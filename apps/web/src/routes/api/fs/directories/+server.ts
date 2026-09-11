import { json, type RequestHandler } from "@sveltejs/kit";
import { workspace } from "$lib/server/context";

export const GET: RequestHandler = async ({ url }) => {
  const listing = await workspace().listDirectories(url.searchParams.get("path") ?? "");
  return json(listing);
};
