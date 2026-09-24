// One-off terminal prompts for the command path. The full-screen workspace lives
// in ./tui/ and is loaded on demand so plain commands never pay for it.

import * as p from '@clack/prompts';
import * as api from './api.js';
import { CliError, EXIT } from './errors.js';
import { saveConfig } from './storage.js';
import { validateKey } from './validate.js';
import { safe } from './output.js';

export const interactive = () =>
  Boolean(
    process.stdin.isTTY && process.stdout.isTTY && !process.env.CI && process.env.TERM !== 'dumb',
  );

/** Draws a static wordmark above a prompt, using the same renderer as the workspace. */
export async function banner() {
  const [{ Screen }, { drawLogo, LOGO_HEIGHT }] = await Promise.all([
    import('./tui/screen.js'),
    import('./tui/logo.js'),
  ]);
  const width = process.stdout.columns >= 70 ? 48 : 28;
  const screen = new Screen(width + 4, LOGO_HEIGHT + 2);
  drawLogo(screen, { x: 2, y: 1, width, motion: 'off' });
  const depth = 'NO_COLOR' in process.env ? 0 : process.env.COLORTERM === 'truecolor' ? 24 : 8;
  process.stdout.write(screen.rows(depth).join('\n') + '\n\n');
}

export function unwrapPrompt(value) {
  if (p.isCancel(value)) {
    p.cancel('Cancelled.');
    throw new CliError('CANCELLED', 'Cancelled.', EXIT.cancelled);
  }
  return value;
}

export async function login(options = {}) {
  if (!interactive())
    throw new CliError(
      'AUTH_REQUIRED',
      'Use alive5 auth login --key-stdin, or set ALIVE5_API_KEY.',
      EXIT.auth,
    );
  const apiKey = validateKey(
    unwrapPrompt(
      await p.password({
        message: 'Paste your Alive5 API key',
        mask: '•',
        validate: (v) => (!v?.trim() ? 'An API key is required.' : undefined),
      }),
    ),
  );
  const spinner = p.spinner();
  spinner.start('Checking your account');
  try {
    const data = await api.account({ ...options, apiKey });
    await saveConfig({ apiKey });
    spinner.stop(`Connected to ${safe(data.org_name)}`);
    return data;
  } catch (e) {
    spinner.stop('Could not connect');
    throw e;
  }
}

export async function dashboard() {
  const { launchTui } = await import('./tui/runtime.js');
  await launchTui();
}
