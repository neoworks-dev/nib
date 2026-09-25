import { error, json, type RequestHandler } from "@sveltejs/kit";
import { pinterest } from "$lib/server/context";
import { failPinterest, requiredField } from "./http";

export const GET: RequestHandler = async () => {
  try {
    return json(await pinterest().status());
  } catch (cause) {
    failPinterest(cause);
  }
};

export const PATCH: RequestHandler = async ({ request }) => {
  const body = (await request.json().catch(() => null)) as Partial<{
    appId: unknown;
    appSecret: unknown;
    redirectUri: unknown;
  }> | null;

  const appId = requiredField(body?.appId);
  const appSecret = requiredField(body?.appSecret);
  const redirectUri = requiredField(body?.redirectUri);
  if (!appId || !appSecret || !redirectUri) {
    error(400, "appId, appSecret and redirectUri are required");
  }

  try {
    return json(await pinterest().configure({ appId, appSecret, redirectUri }));
  } catch (cause) {
    failPinterest(cause);
  }
};

export const DELETE: RequestHandler = async () => {
  try {
    await pinterest().disconnect();
    return json(await pinterest().status());
  } catch (cause) {
    failPinterest(cause);
  }
};
