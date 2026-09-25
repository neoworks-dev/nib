import { error, json, type RequestHandler } from "@sveltejs/kit";
import { pinterest } from "$lib/server/context";
import { failPinterest } from "../../../http";

export const GET: RequestHandler = async ({ params }) => {
  const boardId = params.id ?? "";
  if (boardId.length === 0) error(400, "a board id is required");

  try {
    return json({ pins: await pinterest().pins(boardId) });
  } catch (cause) {
    failPinterest(cause);
  }
};
