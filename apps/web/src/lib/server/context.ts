import { join } from 'node:path';
import { createContext, type Context } from '@nib-ui/kernel';
import { claudeCodePlugin } from './plugins/claude-code';
import { harnessRegistryPlugin } from './plugins/harness-registry';
import { sessionHostPlugin } from './plugins/session-host';
import { workspacePlugin } from './plugins/workspace';
import type { HarnessRegistry, SessionHost, WorkspaceService } from './services';

const logDirectory = join(process.cwd(), '.nib-ui', 'sessions');

let context: Context | undefined;

/** The server kernel instance. Plugins are loaded statically from this manifest. */
export function serverContext(): Context {
	if (context) return context;
	context = createContext();
	context.use(harnessRegistryPlugin);
	context.use(sessionHostPlugin, { logDirectory });
	context.use(claudeCodePlugin);
	context.use(workspacePlugin);
	return context;
}

export function harnesses(): HarnessRegistry {
	return serverContext().require('harnesses');
}

export function sessionHost(): SessionHost {
	return serverContext().require('sessionHost');
}

export function workspace(): WorkspaceService {
	return serverContext().require('workspace');
}
