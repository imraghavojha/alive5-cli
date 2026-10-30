import { readFile, mkdir, writeFile, rename, rm, chmod } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { CliError, EXIT } from './errors.js';
import { validateKey } from './validate.js';

export const configDir = () =>
  process.env.ALIVE5_CONFIG_DIR ||
  join(process.env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'alive5');

const path = (name) => join(configDir(), name);

async function readJson(name, fallback) {
  try {
    return JSON.parse(await readFile(path(name), 'utf8'));
  } catch (e) {
    if (e.code === 'ENOENT' || e instanceof SyntaxError) return fallback;
    throw e;
  }
}

async function writeJson(name, value) {
  const dir = configDir();
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const temp = join(dir, `.${name}-${randomUUID()}`);
  try {
    await writeFile(temp, JSON.stringify(value) + '\n', { mode: 0o600, flag: 'wx' });
    await rename(temp, path(name));
    await chmod(path(name), 0o600);
  } finally {
    await rm(temp, { force: true });
  }
}

const CREDENTIALS = 'credentials.json';

export async function config() {
  try {
    return await readJson(CREDENTIALS, {});
  } catch {
    throw new CliError(
      'CONFIG_ERROR',
      'Cannot read credentials. Check the config file or run alive5 auth login.',
    );
  }
}

export const saveConfig = (value) => writeJson(CREDENTIALS, value);

export const logout = () => rm(path(CREDENTIALS), { force: true });

export async function key() {
  const k = process.env.ALIVE5_API_KEY || (await config()).apiKey;
  if (!k)
    throw new CliError('AUTH_REQUIRED', 'Run alive5 auth login, or set ALIVE5_API_KEY.', EXIT.auth);
  return validateKey(k);
}

// Appearance is a local preference file with no credentials in it, so the
// commands that read and write it never require authentication.
export const appearanceChoices = {
  logo: ['type', 'slash', 'outline', 'pixel', 'stipple', 'wire', 'lean', 'frame'],
  mascot: ['isometric-desktop', 'pocket-macintosh'],
  motion: ['full', 'subtle', 'off'],
  effect: ['signal', 'breathe', 'orbit', 'cosmos'],
  theme: ['dark', 'light', 'terminal', 'high-contrast'],
};

export const appearanceDefaults = {
  logo: 'frame',
  mascot: 'isometric-desktop',
  motion: 'full',
  effect: 'cosmos',
  theme: 'terminal',
};

const APPEARANCE = 'appearance.json';

export async function appearance() {
  const value = await readJson(APPEARANCE, null);
  return Object.fromEntries(
    Object.entries(appearanceChoices).map(([k, choices]) => [
      k,
      choices.includes(value?.[k]) ? value[k] : appearanceDefaults[k],
    ]),
  );
}

export async function saveAppearance(settings) {
  for (const [k, choices] of Object.entries(appearanceChoices))
    if (!choices.includes(settings[k]))
      throw new CliError(
        'INVALID_ARGUMENT',
        `Invalid ${k}. Choose ${choices.join(', ')}.`,
        EXIT.usage,
        {
          field: k,
        },
      );
  await writeJson(
    APPEARANCE,
    Object.fromEntries(Object.keys(appearanceDefaults).map((k) => [k, settings[k]])),
  );
}

// The channel and teammate of the last accepted send, so the next compose
// starts from them. IDs only; no message content is stored.
const RECENT = 'recent.json';

export const recentSender = () => readJson(RECENT, {}).catch(() => ({}));

export const saveRecentSender = ({ channel, user }) => writeJson(RECENT, { channel, user });
