import { error, json, type RequestHandler } from "@sveltejs/kit";
import { readUserConfig, updateUserConfig } from "$lib/server/user-config";

export const GET: RequestHandler = async () => json(await readUserConfig());

export const PATCH: RequestHandler = async ({ request }) => {
  const body = (await request.json()) as {
    defaultModels?: Record<string, string>;
    lastProject?: string;
  };
  if (!body.defaultModels && typeof body.lastProject !== "string") {
    error(400, "defaultModels or lastProject is required");
  }

  return json(
    await updateUserConfig({
      ...(body.defaultModels && { defaultModels: body.defaultModels }),
      ...(typeof body.lastProject === "string" && { lastProject: body.lastProject }),
    }),
  );
};
