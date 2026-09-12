import * as p from '@clack/prompts';
import pc from 'picocolors';
import { CliError, saveConfig, validateKey } from './core.js';
import * as api from './api.js';
export const interactive = () =>
  Boolean(
    process.stdin.isTTY && process.stdout.isTTY && !process.env.CI && process.env.TERM !== 'dumb',
  );
export const safe = (v) => String(v ?? '—').replace(/[\x00-\x1f\x7f-\x9f]/g, ' ');
const c = () =>
  pc.createColors(
    Boolean(process.stdout.isTTY && !('NO_COLOR' in process.env) && process.env.TERM !== 'dumb'),
  );
export async function banner() {
  const { Screen } = await import('./tui/screen.js');
  const { drawLogo, logoHeight } = await import('./tui/logo.js');
  const width = process.stdout.columns >= 70 ? 48 : 28;
  const screen = new Screen(width + 4, logoHeight(width) + 2);
  drawLogo(screen, { x: 2, y: 1, width, motion: 'off' });
  const depth = 'NO_COLOR' in process.env ? 0 : process.env.COLORTERM === 'truecolor' ? 24 : 8;
  process.stdout.write(screen.rows(depth).join('\n') + '\n\n');
}
export function render(data, meta = {}) {
  const color = c();
  if (Array.isArray(data) && !data.length) {
    console.log(`\n  ${color.dim('No results in this view.')}\n`);
    return;
  }
  if (Array.isArray(data) && data.every((r) => r && typeof r === 'object' && !Array.isArray(r))) {
    const keys = Object.keys(data[0]);
    if (keys.includes('text') && keys.includes('threadId')) {
      for (const m of data)
        console.log(
          `\n  ${color.cyan(safe(m.sender))}  ${color.dim(safe(m.at))}\n  ${safe(m.text)}\n  ${color.dim('Thread ' + safe(m.threadId))}`,
        );
    } else if (keys.includes('messages')) {
      for (const r of data) {
        console.log(
          `\n  ${color.cyan(safe(r.contact?.firstName || r.contact?.phone || r.id))}  ${color.dim(safe(r.id))}`,
        );
        for (const m of r.messages)
          console.log(`  ${color.dim(safe(m.at))}  ${safe(m.sender)}\n    ${safe(m.text)}`);
      }
    } else {
      const columns = keys.filter((k) => !['users', 'tags'].includes(k));
      const widths = columns.map((k) =>
        Math.min(k === 'id' ? 36 : 34, Math.max(k.length, ...data.map((r) => safe(r[k]).length))),
      );
      const compact = widths.reduce((a, b) => a + b + 3, 2) > (process.stdout.columns || 100);
      if (compact)
        for (const r of data) {
          console.log('');
          for (const k of columns) console.log(`  ${color.dim(k.padEnd(12))} ${safe(r[k])}`);
          if (r.users)
            for (const u of r.users)
              console.log(`    ${color.dim('user')} ${safe(u.id)}  ${safe(u.name)}`);
        }
      else {
        const row = (r) =>
          columns
            .map((k, i) => {
              const s = safe(r[k]);
              return (s.length > widths[i] ? s.slice(0, widths[i] - 1) + '…' : s).padEnd(widths[i]);
            })
            .join('   ');
        console.log(
          '\n  ' + color.dim(row(Object.fromEntries(columns.map((k) => [k, k.toUpperCase()])))),
        );
        for (const r of data) {
          console.log('  ' + row(r));
          if (r.users)
            for (const u of r.users)
              console.log(`    ${color.dim('↳')} ${safe(u.name)}  ${color.dim(safe(u.id))}`);
        }
      }
    }
    console.log(
      `\n  ${color.dim(`${data.length} results${meta.page ? ` · page ${meta.page}${meta.totalPages ? ` of ${meta.totalPages}` : ''}` : ''}`)}`,
    );
    if (meta.nextPage) console.log(`  ${color.cyan(`Next: add --page ${meta.nextPage}`)}`);
    console.log('');
    return;
  }
  if (data?.preview) {
    p.note(
      Object.entries(data.form)
        .map(([k, v]) => `${k}: ${safe(v)}`)
        .join('\n'),
      'Message preview · nothing sent',
    );
    return;
  }
  if (data?.deliveryConfirmed === false) {
    p.note(
      `To       ${safe(data.to)}\nFrom     ${safe(data.from)}\nMessage  ${safe(data.text)}\nStatus   ${safe(data.status)}\nID       ${safe(data.id)}\n\nAccepted by Alive5. Delivery is not yet confirmed.`,
      'Message submitted',
    );
    return;
  }
  if (data && typeof data === 'object')
    console.log(
      '\n' +
        Object.entries(data)
          .map(
            ([k, v]) =>
              `  ${color.dim(k.padEnd(16))} ${safe(typeof v === 'object' ? JSON.stringify(v) : v)}`,
          )
          .join('\n') +
        '\n',
    );
  else console.log(safe(data));
}
export function unwrapPrompt(value) {
  if (p.isCancel(value)) {
    p.cancel('Cancelled.');
    throw new CliError('CANCELLED', 'Cancelled.', 130);
  }
  return value;
}
export async function login(options = {}) {
  if (!interactive())
    throw new CliError(
      'AUTH_REQUIRED',
      'Use alive5 auth login --key-stdin, or set ALIVE5_API_KEY.',
      3,
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
  let data;
  try {
    data = await api.account({ ...options, apiKey });
    await saveConfig({ apiKey });
    spinner.stop(`Connected to ${safe(data.org_name)}`);
  } catch (e) {
    spinner.stop('Could not connect');
    throw e;
  }
  return data;
}
export async function dashboard() {
  const { launchTui } = await import('./tui/app.js');
  await launchTui();
}
