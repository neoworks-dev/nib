import type { RequestHandler } from "@sveltejs/kit";
import { pinterest } from "$lib/server/context";

const CONNECTED_MESSAGE = "nib-ui:pinterest-connected";

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * The window Pinterest redirects back to is not the app's: it tells the opener
 * what happened and closes itself, and the pane reloads on that message.
 */
function resultPage(message: string, connected: boolean, origin: string): string {
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Pinterest</title></head>
<body style="font: 14px system-ui; padding: 2rem">
<p>${escapeHtml(message)}</p>
<script>
  if (${String(connected)} && window.opener) {
    window.opener.postMessage(${JSON.stringify(CONNECTED_MESSAGE)}, ${JSON.stringify(origin)});
    window.close();
  }
</script>
</body>
</html>
`;
}

export const GET: RequestHandler = async ({ url }) => {
  const html = (message: string, connected: boolean, status: number): Response =>
    new Response(resultPage(message, connected, url.origin), {
      status,
      headers: { "content-type": "text/html; charset=utf-8" },
    });

  const denied = url.searchParams.get("error");
  if (denied) return html(`Pinterest refused the authorization: ${denied}`, false, 400);

  const code = url.searchParams.get("code") ?? "";
  const state = url.searchParams.get("state") ?? "";
  if (code.length === 0 || state.length === 0) {
    return html("Pinterest sent this window back without an authorization.", false, 400);
  }

  try {
    await pinterest().completeAuth(code, state);
  } catch (cause) {
    return html(cause instanceof Error ? cause.message : "the authorization failed", false, 400);
  }
  return html("Pinterest is connected. You can close this window.", true, 200);
};
