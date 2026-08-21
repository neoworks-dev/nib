/**
 * Extension and filename lookup for the Material icon set. Only the icons the
 * app actually bundles are listed; everything else falls back to `file`.
 */
const byFileName: Record<string, string> = {
	'package.json': 'nodejs',
	'bun.lock': 'bun',
	'bunfig.toml': 'bun',
	'tsconfig.json': 'tsconfig',
	'.gitignore': 'git',
	dockerfile: 'docker',
	'readme.md': 'readme',
	'license': 'certificate',
};

const byExtension: Record<string, string> = {
	ts: 'typescript',
	mts: 'typescript',
	cts: 'typescript',
	tsx: 'react_ts',
	js: 'javascript',
	mjs: 'javascript',
	cjs: 'javascript',
	jsx: 'react',
	svelte: 'svelte',
	vue: 'vue',
	json: 'json',
	jsonc: 'json',
	css: 'css',
	scss: 'sass',
	html: 'html',
	md: 'markdown',
	mdx: 'markdown',
	py: 'python',
	rs: 'rust',
	go: 'go',
	rb: 'ruby',
	java: 'java',
	c: 'c',
	h: 'c',
	cpp: 'cpp',
	sh: 'console',
	bash: 'console',
	fish: 'console',
	zsh: 'console',
	yml: 'yaml',
	yaml: 'yaml',
	toml: 'toml',
	lock: 'lock',
	sql: 'database',
	svg: 'svg',
	png: 'image',
	jpg: 'image',
	jpeg: 'image',
	gif: 'image',
	webp: 'image',
	pdf: 'pdf',
	txt: 'document',
	env: 'tune',
};

export function fileIconName(path: string): string {
	const name = path.slice(path.lastIndexOf('/') + 1).toLowerCase();
	const exact = byFileName[name];
	if (exact) return exact;

	const dot = name.lastIndexOf('.');
	if (dot <= 0) return 'file';
	return byExtension[name.slice(dot + 1)] ?? 'file';
}
