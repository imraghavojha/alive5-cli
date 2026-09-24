// Install the distributable tarball in isolation and exercise its entry point.
// No credentials or network request to Alive5 are used.
import { mkdtemp, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';

const dir = await mkdtemp(join(tmpdir(), 'alive5-package-smoke-'));
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const run = (command, args, extra = {}) => {
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    encoding: 'utf8',
    shell: process.platform === 'win32' && command === npm,
    env: { ...process.env, ...extra },
  });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout || `${command} failed`);
  return result.stdout;
};

try {
  run(npm, ['pack', '--pack-destination', dir, '--silent']);
  const tarball = (await readdir(dir)).find((file) => file.endsWith('.tgz'));
  assert.ok(tarball, 'npm pack did not produce a tarball');
  run(npm, ['install', '--prefix', dir, '--ignore-scripts', join(dir, tarball)]);
  const binary = join(dir, 'node_modules', '@alive5', 'cli', 'bin', 'alive5.js');
  const data = JSON.parse(
    run(process.execPath, [binary, 'appearance', 'get', '--json'], {
      ALIVE5_CONFIG_DIR: join(dir, 'new-config'),
      ALIVE5_API_KEY: '',
    }),
  );
  assert.equal(data.ok, true);
  assert.equal(data.data.motion, 'subtle');
  assert.equal(data.data.theme, 'dark');
  console.log('Packaged CLI installed and launched successfully.');
} finally {
  await rm(dir, { recursive: true, force: true });
}
