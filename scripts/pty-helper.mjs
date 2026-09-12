import { chmod } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
// node-pty 1.1.0 ships its macOS helper without the executable bit.
// This only touches the development dependency, never the installed CLI.
export async function preparePty() {
  if (process.platform === 'darwin') {
    const require = createRequire(import.meta.url);
    await chmod(
      join(
        dirname(require.resolve('node-pty/package.json')),
        'prebuilds',
        `darwin-${process.arch}`,
        'spawn-helper',
      ),
      0o755,
    );
  }
}
