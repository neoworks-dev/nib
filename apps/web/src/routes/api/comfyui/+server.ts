import { error, json, type RequestHandler } from "@sveltejs/kit";
import { z } from "zod";
import { comfyui } from "$lib/server/context";
import { failComfy } from "./http";

const configureBodySchema = z.object({ baseUrl: z.string().min(1) });

export const GET: RequestHandler = async () => json(await comfyui().status());

export const PATCH: RequestHandler = async ({ request }) => {
  const body = configureBodySchema.safeParse(await request.json().catch(() => null));
  if (!body.success) error(400, "baseUrl is required");
  try {
    return json(await comfyui().configure(body.data.baseUrl));
  } catch (cause) {
    failComfy(cause);
  }
};
