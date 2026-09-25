import { redirect, type RequestHandler } from "@sveltejs/kit";
import { pinterest } from "$lib/server/context";
import { failPinterest } from "../http";

/** Opened in a window of its own: the user signs in on Pinterest, not in the app. */
export const GET: RequestHandler = async () => {
  let target: string;
  try {
    target = await pinterest().beginAuth();
  } catch (cause) {
    failPinterest(cause);
  }
  redirect(302, target);
};
