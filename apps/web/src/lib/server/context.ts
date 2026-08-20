import { join } from 'node:path';
import { createContext, type Context } from '@nib-ui/kernel';
import { claudeCodePlugin } from './plugins/claude-code';
import { harnessRegistryPlugin } from './plugins/harness-registry';
import { sessionHostPlugin } from './plugins/session-host';
import type { HarnessRegistry, SessionHost } from './services';

const logDirectory = join(process.cwd(), '.nib-ui', 'sessions');

let context: Context | undefined;

/** The server kernel instance. Plugins are loaded statically from this manifest. */
export function serverContext(): Context {
	if (context) return context;
	context = createContext();
	context.use(harnessRegistryPlugin);
	context.use(sessionHostPlugin, { logDirectory });
	context.use(claudeCodePlugin);
	return context;
}

export function harnesses(): HarnessRegistry {
	return serverContext().require('harnesses');
}

export function sessionHost(): SessionHost {
	return serverContext().require('sessionHost');
}
