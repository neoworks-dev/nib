const escape = '\u001B';
// CSI sequences (colours, cursor moves) plus OSC strings, which tools emit for titles.
const csiPattern = new RegExp(`${escape}\\[[0-?]*[ -/]*[@-~]`, 'g');
const oscPattern = new RegExp(`${escape}\\][^\\u0007${escape}]*(?:\\u0007|${escape}\\\\)`, 'g');

export function stripAnsi(value: string): string {
	return value.replace(csiPattern, '').replace(oscPattern, '');
}
