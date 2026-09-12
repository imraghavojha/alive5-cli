import * as p from '@clack/prompts';
import pc from 'picocolors';
import { setTimeout as sleep } from 'node:timers/promises';
import { CliError, config, saveConfig, validateKey, VERSION, DOCS } from './core.js';
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
export async function banner(animate = true) {
  const color = c();
  const logo = [
    ' ▄▄▄  ▄     ▄ ▄   ▄ ▄▄▄▄▄ ▄▄▄▄▄',
    '█   █ █     █ █   █ █     █    ',
    '█▄▄▄█ █     █ █   █ █▄▄▄  ▀▀▀▀▄',
    '█   █ █     █  █ █  █         █',
    '█   █ █▄▄▄▄ █   █   █▄▄▄▄ ▀▄▄▄▀',
  ];
  process.stdout.write('\n');
  for (let i = 0; i < logo.length; i++) {
    console.log('  ' + (i < 2 ? color.cyan(logo[i]) : color.green(logo[i])));
    if (animate && !process.env.ALIVE5_NO_ANIMATION && !('NO_COLOR' in process.env))
      await sleep(55);
  }
  console.log(
    `\n  ${color.bold('Conversations, from your terminal.')}  ${color.dim('v' + VERSION)}\n`,
  );
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
const ask = async (message, initialValue) =>
  unwrapPrompt(
    await p.text({
      message,
      initialValue,
      validate: (v) => (!v?.trim() ? 'This field is required.' : undefined),
    }),
  );
export async function dashboard() {
  await banner();
  const stored = process.env.ALIVE5_API_KEY ? {} : await config();
  if (!process.env.ALIVE5_API_KEY && !stored.apiKey) {
    p.note(
      `Find your key in Alive5 → Integrations → API Key.\nIt stays on this computer in a file readable only by your user.`,
      'Connect your workspace',
    );
    await login();
  }
  let info;
  try {
    info = await api.account();
  } catch (e) {
    if (process.env.ALIVE5_API_KEY || !['AUTH_FAILED', 'AUTH_REQUIRED'].includes(e.code)) throw e;
    p.log.error(safe(e.message));
    await login();
    info = await api.account();
  }
  p.intro(`${c().green('●')} ${safe(info.org_name)}  ${c().dim('PUBLIC API')}`);
  for (;;) {
    const action = unwrapPrompt(
      await p.select({
        message: 'What would you like to do?',
        options: [
          { value: 'send', label: 'Send a text', hint: 'compose → preview → send' },
          { value: 'messages', label: 'Read recent texts', hint: 'messages across all threads' },
          { value: 'history', label: 'Read conversations', hint: 'SMS, live chat, Facebook' },
          {
            value: 'directory',
            label: 'Browse your workspace',
            hint: 'channels, people, contacts, tags',
          },
          { value: 'summary', label: 'Conversation summary', hint: 'experimental API endpoint' },
          { value: 'agents', label: 'Use with an AI agent', hint: 'commands and JSON output' },
          { value: 'exit', label: 'Exit' },
        ],
      }),
    );
    if (action === 'exit') {
      p.outro('See you in the next conversation.');
      return;
    }
    try {
      if (action === 'agents') {
        p.note(
          'alive5 schema\nalive5 channels list --json\nalive5 contacts list --limit 10 --json\nalive5 sms send --help\n\nPiped commands return JSON and never prompt.\nUse --dry-run to preview a text, then --yes to send.\nFull guide: docs/agents.md\nAPI: ' +
            DOCS,
          'Agent quick start',
        );
        continue;
      }
      if (action === 'directory') {
        const type = unwrapPrompt(
          await p.select({
            message: 'Browse',
            options: [
              { value: 'channels', label: 'Channels and users' },
              { value: 'contacts', label: 'Contacts' },
              { value: 'tags', label: 'Tags' },
            ],
          }),
        );
        const result = await api[type]({});
        render(type === 'contacts' ? result.data : result, result.meta);
        continue;
      }
      if (action === 'send') {
        const channels = await api.channels();
        const channelId = unwrapPrompt(
          await p.select({
            message: 'Send from which channel?',
            options: channels.map((ch) => ({ value: ch.id, label: safe(ch.name) })),
          }),
        );
        const ch = channels.find((x) => x.id === channelId);
        const user = unwrapPrompt(
          await p.select({
            message: 'Attribute this message to',
            options: ch.users.map((u) => ({ value: u.id, label: safe(u.name || u.id) })),
          }),
        );
        const from = await ask(
          'Your Alive5 sending number',
          /^\+\d+$/.test(ch.name) ? ch.name : undefined,
        );
        const to = await ask('Recipient · include country code');
        const message = await ask('Message');
        const options = { from, to, message, channel: channelId, user };
        render(await api.send({ ...options, dryRun: true }));
        const yes = unwrapPrompt(
          await p.confirm({ message: `Send this text to ${safe(to)}?`, initialValue: false }),
        );
        if (yes) render(await api.send(options));
        else p.log.info('Nothing sent.');
        continue;
      }
      const today = new Date().toISOString().slice(0, 10);
      const since = await ask('Start date · YYYY-MM-DD', today);
      const until = await ask(
        'Until · YYYY-MM-DD, next day to include today',
        new Date(Date.now() + 86400000).toISOString().slice(0, 10),
      );
      if (action === 'messages') render(await api.messages({ since, until }));
      else if (action === 'summary') render(await api.summary({ since, until }));
      else {
        const type = unwrapPrompt(
          await p.select({
            message: 'Conversation type',
            options: [
              { value: 'sms', label: 'SMS' },
              { value: 'livechat', label: 'Live chat' },
              { value: 'fbm', label: 'Facebook Messenger' },
            ],
          }),
        );
        const r = await api.conversations(type, { since, until });
        render(r.data, r.meta);
      }
    } catch (e) {
      if (e.exitCode === 130) throw e;
      p.log.error(safe(e.message));
    }
  }
}
