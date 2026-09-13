import { readFile, writeFile, mkdir, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { configDir, CliError } from './core.js';

export const appearanceChoices = {
  logo: ['type', 'slash', 'outline', 'pixel', 'stipple', 'wire', 'lean', 'frame'],
  motion: ['full', 'subtle', 'off'],
  effect: ['signal', 'breathe', 'orbit', 'cosmos'],
};
export const defaults = { logo: 'frame', motion: 'full', effect: 'cosmos' };
export async function appearance() {
  try {
    const value = JSON.parse(await readFile(join(configDir(), 'appearance.json'), 'utf8'));
    return Object.fromEntries(
      Object.entries(appearanceChoices).map(([key, choices]) => [
        key,
        choices.includes(value?.[key]) ? value[key] : defaults[key],
      ]),
    );
  } catch (error) {
    if (error.code === 'ENOENT' || error instanceof SyntaxError) return { ...defaults };
    throw error;
  }
}
export async function saveAppearance(settings) {
  for (const [key, choices] of Object.entries(appearanceChoices)) {
    if (!choices.includes(settings[key]))
      throw new CliError('INVALID_ARGUMENT', `Invalid ${key}. Choose ${choices.join(', ')}.`, 2);
  }
  const dir = configDir();
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const temp = join(dir, `.appearance-${randomUUID()}`);
  try {
    await writeFile(
      temp,
      JSON.stringify(Object.fromEntries(Object.keys(defaults).map((key) => [key, settings[key]]))) +
        '\n',
      { mode: 0o600, flag: 'wx' },
    );
    await rename(temp, join(dir, 'appearance.json'));
  } finally {
    await rm(temp, { force: true });
  }
}
