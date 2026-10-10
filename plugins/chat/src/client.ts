import type { MessageAttachment } from "@nib-ui/protocol";

/**
 * Stores a file the user picked in the asset store and answers the reference a
 * prompt carries for it. Own route, own client — the same shape `plugins/git-panel`
 * uses; the bytes stay on the server and only the id travels with the message.
 */
export async function uploadAttachment(file: File): Promise<MessageAttachment> {
  const response = await fetch("/api/assets", {
    method: "POST",
    headers: { "content-type": file.type || "application/octet-stream" },
    body: file,
  });
  if (!response.ok) throw new Error(await response.text());
  const stored = (await response.json()) as { assetId: string; contentType: string };
  return { assetId: stored.assetId, mime: stored.contentType, name: file.name };
}
