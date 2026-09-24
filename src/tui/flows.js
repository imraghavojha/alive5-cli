// What each workspace screen actually does: connecting, the navigation actions,
// paging, composing, and sending. Panel mechanics live in ./workspace.js, so a
// change to a task touches this file and a change to the machinery touches that
// one.

import { config, saveConfig } from '../storage.js';
import { validateKey, dateRange } from '../validate.js';
import { displayName } from '../normalize.js';
import { navigation } from './layout.js';
import * as records from './records.js';
import * as api from '../api.js';

const AGENT_GUIDE = [
  '› Discover the command interface',
  'alive5 schema',
  'alive5 schema sms send',
  '',
  '› Find channel and user IDs',
  'alive5 channels list --json',
  '',
  '› Preview before sending',
  'alive5 sms send --help',
  'Add --dry-run to validate locally without sending.',
  'Use --yes only when the recipient and text are authorized.',
  '',
  '› Check the local install',
  'alive5 doctor',
  'alive5 completion zsh',
  '',
  'Piped commands return one JSON envelope and never prompt.',
  'Use --message-file for multiline text.',
  'Docs: docs/agents.md',
];

const DATE_PRESETS = [
  { label: 'Today', days: 0 },
  { label: 'Yesterday and today', days: 1 },
  { label: 'Last 7 days', days: 7 },
  { label: 'Last 30 days', days: 30 },
  { label: 'Choose dates…', days: null },
];

const isoDay = (offsetDays = 0) =>
  new Date(Date.now() - offsetDays * 86400000).toISOString().slice(0, 10);

export async function connect(app) {
  await app.run('Connecting', async (current) => {
    const stored = process.env.ALIVE5_API_KEY ? {} : await config();
    if (!process.env.ALIVE5_API_KEY && !stored.apiKey) {
      if (current()) login(app);
      return;
    }
    try {
      const account = await app.services.account();
      if (current()) app.state.account = account;
    } catch (e) {
      if (!process.env.ALIVE5_API_KEY && e.exitCode === 3) {
        if (current()) login(app);
      } else throw e;
    }
  });
}

export function login(app) {
  app.form(
    'Connect to Alive5',
    [{ key: 'apiKey', label: 'API key', secret: true, placeholder: 'Paste your existing key' }],
    async (values, current) => {
      const apiKey = validateKey(values.apiKey);
      const account = await app.services.account({ apiKey });
      await saveConfig({ apiKey });
      if (!current()) return;
      app.state.account = account;
      app.home();
      app.state.notice = 'Connected. Your key is saved only on this computer.';
    },
    'Alive5 → Integrations → API Key',
  );
}

/** Offers common ranges first; "Choose dates…" opens the explicit form. */
export function dates(app, title, callback) {
  app.select(
    title,
    DATE_PRESETS.map((p) => ({ label: p.label, value: p })),
    (preset) => {
      if (preset.days == null) return dateForm(app, title, callback);
      const range = { since: isoDay(preset.days), until: isoDay(-1) };
      return app.run('Loading', (current) => callback(range, current));
    },
    "Dates use this computer's calendar, not the workspace timezone.",
  );
}

export function dateForm(app, title, callback) {
  app.form(
    title,
    [
      { key: 'since', label: 'From · YYYY-MM-DD', value: isoDay(0) },
      { key: 'until', label: 'Until · the next day includes a full day', value: isoDay(-1) },
    ],
    async (v, current) => {
      dateRange(v.since, v.until);
      await callback(v, current);
    },
    "Dates use this computer's calendar.",
  );
}

export async function activate(app) {
  const { id } = navigation[app.state.nav];
  app.state.notice = '';
  const action = actions(app)[id];
  if (!action) return;
  if (id !== 'appearance' && id !== 'agents' && !app.state.account) return login(app);
  return action();
}

/** One entry per navigation item, so adding a section is one entry here. */
function actions(app) {
  return {
    appearance: () => app.show({ kind: 'appearance', index: 0 }, { remember: false }),
    agents: () =>
      app.reader('Built for your agent', AGENT_GUIDE, 'Quiet commands. Predictable JSON.'),
    send: () => chooseSender(app, (context) => compose(app, context)),
    messages: () =>
      dates(app, 'Read recent messages', async (v, current) => {
        const rows = await app.services.messages(v);
        if (current()) app.list('Recent messages', 'messages', rows);
      }),
    history: () =>
      app.select(
        'Conversation type',
        [
          { label: 'SMS', value: 'sms' },
          { label: 'Live chat', value: 'livechat' },
          { label: 'Facebook Messenger', value: 'fbm' },
        ],
        (type) =>
          dates(app, `Read ${type} conversations`, (v, current) =>
            paged(
              app,
              'Conversations',
              'conversations',
              (page) => app.services.conversations(type, { ...v, page }),
              current,
            ),
          ),
        'This filters conversation start dates.',
      ),
    directory: () =>
      app.select(
        'Explore your workspace',
        [
          { label: 'Contacts', value: 'contacts' },
          { label: 'Channels & teammates', value: 'channels' },
          { label: 'Tags', value: 'tags' },
        ],
        (kind) =>
          app.run(`Loading ${kind}`, (current) =>
            paged(
              app,
              kind[0].toUpperCase() + kind.slice(1),
              kind,
              async (page) => {
                const result = await app.services[kind]({ page, limit: 25 });
                return Array.isArray(result) ? { data: result, meta: {} } : result;
              },
              current,
            ),
          ),
      ),
  };
}

/** Loads one page and wires `n` to the next, reusing the same list panel shape. */
export async function paged(app, title, kind, fetchPage, current, page = 1) {
  const result = await fetchPage(page);
  const data = Array.isArray(result) ? result : result.data;
  const meta = (Array.isArray(result) ? null : result.meta) || {};
  if (!current()) return;
  app.list(
    title,
    kind,
    data,
    meta,
    meta.nextPage
      ? () =>
          app.run('Loading next page', (still) =>
            paged(app, title, kind, fetchPage, still, meta.nextPage),
          )
      : null,
  );
}

/** Channel then teammate: both are consequential, so both are shown in review. */
export function chooseSender(app, then) {
  return app.run('Loading channels', async (current) => {
    const channels = await app.services.channels();
    if (!current()) return;
    app.select(
      'Choose a sending channel',
      channels.map((ch) => ({ label: ch.name, value: ch })),
      (channel) =>
        app.select(
          'Send as',
          channel.users.map((u) => ({ label: u.name || u.id, value: u })),
          (user) =>
            then({
              channel: channel.id,
              channelName: channel.name,
              user: user.id,
              userName: user.name || user.id,
              from: /^\+\d+$/.test(channel.name) ? channel.name : '',
            }),
          'This teammate will own the message.',
        ),
    );
  });
}

export function compose(app, context, initial = {}) {
  app.form(
    'Compose a text',
    [
      { key: 'from', label: 'From · your Alive5 number', placeholder: '+15555550100' },
      { key: 'to', label: 'To · include country code', placeholder: '+15555550101' },
      { key: 'message', label: 'Message', multiline: true, placeholder: 'Write your message' },
    ],
    async (values, current) => {
      const form = { ...context, ...values };
      (app.services.sendForm || api.sendForm)(form);
      if (current()) app.show(previewPanel(app, form, context));
    },
    'Review before sending.',
    { ...context, ...initial },
  );
}

/** Review shows every consequential choice, not just the message. */
export function previewPanel(app, form, context) {
  return {
    kind: 'preview',
    form,
    scroll: 0,
    outcome: null,
    context: [
      ['Workspace', app.state.account?.org_name || '—'],
      ['Channel', context.channelName || form.channel || '—'],
      ['Send as', context.userName || form.user || '—'],
      ['From', form.from],
      ['To', form.to],
    ],
  };
}

/**
 * Sending has four outcomes, and they are reported separately: in flight,
 * accepted, rejected, and unknown. An unknown result keeps the draft and
 * refuses to send again on the next Enter.
 */
export async function sendPreview(app) {
  const panel = app.state.panel;
  await app.run('Sending your text', async (current) => {
    try {
      const result = await app.services.send(panel.form);
      if (!current()) return;
      panel.outcome = 'accepted';
      panel.result = result;
      app.result(
        'Message accepted',
        {
          status: result.status,
          to: result.to,
          id: result.id,
          text: result.text,
        },
        'Accepted by Alive5. Handset delivery is not yet confirmed.',
      );
    } catch (e) {
      if (!current()) return;
      if (!e.deliveryUnknown) throw e;
      // Deliberate recovery only: the draft stays and Enter no longer sends.
      panel.outcome = 'unknown';
      app.state.error = `${e.message} Press Esc to keep editing this draft.`;
      app.changed();
    }
  });
}

export function openRecord(app, record) {
  app.reader(
    displayName(record) || 'Record',
    records.detailLines(record),
    'Full detail for the highlighted record',
  );
}

/** Composing to a contact found in a list, so the number is never retyped. */
export function messageRecord(app, record) {
  if (!record.phone) {
    app.state.notice = 'This record has no mobile number to message.';
    app.changed();
    return;
  }
  return chooseSender(app, (context) => compose(app, context, { to: record.phone }));
}
