import { existsSync, statSync } from "node:fs";
import { join, normalize, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { app, BrowserWindow, dialog, ipcMain, net, protocol, shell } from "electron";
import { registerDesktopAgent } from "./desktop-agent";
import { type AppRequest, appRequestFor } from "./desktop-agent/assets";

const appScheme = "app";
const appOrigin = `${appScheme}://nib`;

// Set by scripts/dev.ts so development still gets Vite hot reload. Production
// never talks to a socket: the SvelteKit build is served in-process below.
const developmentUrl = process.env.NIB_APP_URL;

const webBuildDir = join(import.meta.dirname, "../../../web/build");
const clientDir = join(webBuildDir, "client");
const prerenderedDir = join(webBuildDir, "prerendered");

protocol.registerSchemesAsPrivileged([
  {
    scheme: appScheme,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
      corsEnabled: true,
    },
  },
]);

function resolveStaticAsset(pathname: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  for (const root of [clientDir, prerenderedDir]) {
    const candidate = normalize(join(root, decoded));
    if (candidate !== root && !candidate.startsWith(root + sep)) continue;
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
}

/** Returns the SvelteKit handler, so the desktop agent can post an asset without a socket. */
async function serveAppProtocol(): Promise<AppRequest> {
  const entryUrl = pathToFileURL(join(webBuildDir, "entry.js")).href;
  const { respond } = (await import(/* @vite-ignore */ entryUrl)) as {
    respond: (request: Request) => Promise<Response>;
  };

  protocol.handle(appScheme, async (request) => {
    const { pathname } = new URL(request.url);
    const asset = request.method === "GET" ? resolveStaticAsset(pathname) : null;
    if (asset) return net.fetch(pathToFileURL(asset).href);
    return respond(request);
  });
  return respond;
}

ipcMain.handle("dialog:pickDirectory", async (event, startIn?: string): Promise<string | null> => {
  const parent = BrowserWindow.fromWebContents(event.sender);
  const options: Electron.OpenDialogOptions = {
    title: "Choose a project",
    properties: ["openDirectory", "createDirectory"],
    ...(startIn ? { defaultPath: startIn } : {}),
  };
  const result = parent
    ? await dialog.showOpenDialog(parent, options)
    : await dialog.showOpenDialog(options);
  return result.canceled ? null : (result.filePaths[0] ?? null);
});

function createWindow(): void {
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    show: false,
    autoHideMenuBar: true,
    // Matches --bg so the frame does not flash white before the app paints.
    backgroundColor: "#141416",
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    webPreferences: {
      preload: join(import.meta.dirname, "../preload/index.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  window.once("ready-to-show", () => window.show());

  window.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });

  void window.loadURL(developmentUrl ?? `${appOrigin}/`);
}

void app.whenReady().then(async () => {
  const respond = developmentUrl ? null : await serveAppProtocol();

  // A sidecar that outlives the app would hold a layer surface above every window with
  // nothing left to ask it to leave, so its teardown is bound to the quit itself rather
  // than to a window closing.
  const disposeDesktopAgent = registerDesktopAgent(appRequestFor(developmentUrl, respond));
  app.on("will-quit", disposeDesktopAgent);

  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
