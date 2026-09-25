import { json, type RequestHandler } from "@sveltejs/kit";
import { pinterest } from "$lib/server/context";
import { failPinterest } from "../http";

export const GET: RequestHandler = async () => {
  try {
    return json({ boards: await pinterest().boards() });
  } catch (cause) {
    failPinterest(cause);
  }
};
