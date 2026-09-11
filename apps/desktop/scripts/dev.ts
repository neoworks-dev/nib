import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const desktopDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const webDir = join(desktopDir, "..", "web");

/** Binding port 0 makes the OS hand out a free ephemeral port; we release it before Vite claims it. */
function pickFreePort(): number {
  const probe = Bun.listen({ hostname: "127.0.0.1", port: 0, socket: { data() {} } });
  const { port } = probe;
  probe.stop(true);
  return port;
}

let web: Bun.Subprocess | null = null;
let electron: Bun.Subprocess | null = null;

function shutdown(code: number): never {
  electron?.kill();
  web?.kill();
  process.exit(code);
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

async function waitForServer(url: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (web?.exitCode != null)
      throw new Error(`The SvelteKit dev server exited with code ${web.exitCode}.`);
    try {
      await fetch(url, { signal: AbortSignal.timeout(1000) });
      return;
    } catch {
      await Bun.sleep(200);
    }
  }
  throw new Error(`The SvelteKit dev server did not answer on ${url} within ${timeoutMs}ms.`);
}

const requestedPort = process.env.NIB_DEV_PORT ? Number(process.env.NIB_DEV_PORT) : null;
const attempts = requestedPort === null ? 5 : 1;
let appUrl = "";

for (let attempt = 1; attempt <= attempts; attempt += 1) {
  const port = requestedPort ?? pickFreePort();
  appUrl = `http://localhost:${port}`;
  console.log(`[dev] SvelteKit dev server on ${appUrl}`);

  // --strictPort keeps the URL we hand to Electron authoritative; a lost race to the
  // ephemeral port fails fast here instead of silently serving somewhere else.
  web = Bun.spawn(["bun", "--bun", "vite", "dev", "--port", String(port), "--strictPort"], {
    cwd: webDir,
    stdio: ["ignore", "inherit", "inherit"],
  });

  try {
    await waitForServer(appUrl, 60_000);
    break;
  } catch (cause) {
    web.kill();
    if (attempt === attempts) {
      console.error(cause instanceof Error ? cause.message : cause);
      shutdown(1);
    }
    console.error(`[dev] Port ${port} unusable, retrying with another port.`);
  }
}

electron = Bun.spawn([join(desktopDir, "node_modules", ".bin", "electron-vite"), "dev"], {
  cwd: desktopDir,
  stdio: ["inherit", "inherit", "inherit"],
  env: { ...process.env, NIB_APP_URL: appUrl },
});

shutdown(await electron.exited);
