// What each workspace screen actually does: connecting, the navigation actions,
// paging, composing, and sending. Panel mechanics live in ./workspace.js, so a
// change to a task touches this file and a change to the machinery touches that
// one.

import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { config, saveConfig, recentSender, saveRecentSender } from '../storage.js';
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
  `Guide: ${fileURLToPath(new URL('../../docs/agents.md', import.meta.url)).replace(homedir(), '~')}`,
];

const DATE_PRESETS = [
  { label: 'Today', days: 0 },
  { label: 'Yesterday and today', days: 1 },
  { label: 'Last 7 days', days: 7 },
  { label: 'Last 30 days', days: 30 },
  { label: 'Choose dates…', days: null },
];

/** A calendar day on this computer's clock; toISOString would shift it to UTC. */
export function isoDay(offsetDays = 0, now = new Date()) {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - offsetDays);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export async function connect(app) {
  await app.run('Connecting', async (current) => {
    const stored = process.env.ALIVE5_API_KEY ? {} : await config();
    if (!process.env.ALIVE5_API_KEY && !stored.apiKey) {
      if (current()) login(app);
      return;
    }
    try {
      const account = await app.services.account();
      if (!current()) return;
      app.state.account = account;
      loadRecent(app);
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
      loadRecent(app);
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
    send: () => startCompose(app),
    messages: () =>
      dates(app, 'Read recent messages', (range, current) => messages(app, range, current)),
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
              'threads',
              async (page) => {
                const result = await app.services.conversations(type, { ...v, page });
                return { ...result, data: result.data.map(records.fromConversation) };
              },
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
        (kind) => directory(app, kind),
      ),
  };
}

async function messages(app, range, current) {
  const rows = await app.services.messages(range);
  const summary = `${rows.length} messages`;
  if (current()) app.list('Recent messages', 'threads', records.threads(rows), { summary });
}

const directory = (app, kind) =>
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
  );

const lastWeek = () => ({ since: isoDay(7), until: isoDay(-1) });

/**
 * Loads the last week's threads for Home in the background. It never sets the
 * busy state, so Home stays usable while it loads.
 */
export async function loadRecent(app) {
  if (!app.services.messages) return;
  try {
    const rows = await app.services.messages(lastWeek());
    app.state.recent = records.threads(rows);
  } catch {
    app.state.recentError = 'Recent conversations could not be loaded.';
  }
  app.changed();
}

/**
 * Every action by name, fuzzy-searchable from anywhere with Ctrl+K. Entries
 * that need an account are hidden until one is connected.
 */
export function palette(app) {
  const signedIn = Boolean(app.state.account);
  const go = (id) => () => {
    app.state.nav = navigation.findIndex((n) => n.id === id);
    return activate(app);
  };
  const entries = [
    ['Compose a text', '1', go('send'), true],
    [
      'Messages from the last 7 days',
      '',
      () => app.run('Loading', (c) => messages(app, lastWeek(), c)),
      true,
    ],
    ['Recent messages…', '2', go('messages'), true],
    ['Conversations…', '3', go('history'), true],
    ['Contacts', '', () => directory(app, 'contacts'), true],
    ['Channels & teammates', '', () => directory(app, 'channels'), true],
    ['Tags', '', () => directory(app, 'tags'), true],
    ['Agent quick start', '5', go('agents')],
    ['Appearance', 'a', go('appearance')],
    ['Keyboard shortcuts', '?', () => app.help()],
    ['Home', '', () => app.home()],
    ['Quit', 'q', () => app.quit(0)],
  ].filter(([, , , needsAccount]) => signedIn || !needsAccount);
  app.select(
    'Go to…',
    entries.map(([label, key, run]) => ({ label, detail: key, value: run })),
    (run) => {
      app.back();
      return run();
    },
    'Every action, searchable. Esc closes.',
    { search: true },
  );
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

const isPhone = (v) => /^\+\d+$/.test(v || '');

/** Sets a form value and parks its caret at the end. */
function set(panel, key, value) {
  panel.values[key] = value || '';
  panel.carets[key] = [...panel.values[key]].length;
}

/** Focus goes to the first field still empty, or the message when all are filled. */
const firstEmpty = (panel) => {
  const index = panel.fields.findIndex((f) => !panel.values[f.key]?.trim());
  return index < 0 ? panel.fields.length - 1 : index;
};

function setChannel(panel, channel) {
  const previous = panel.picked.channel;
  panel.picked.channel = channel;
  set(panel, 'channel', channel.name || channel.id);
  if (!channel.users.some((u) => u.id === panel.picked.user?.id))
    setUser(panel, channel.users.length === 1 ? channel.users[0] : null);
  // A channel labelled with its number supplies From, unless one was typed.
  const from = panel.values.from;
  if (!from || from === previous?.name)
    set(panel, 'from', isPhone(channel.name) ? channel.name : '');
}

function setUser(panel, user) {
  panel.picked.user = user;
  set(panel, 'user', user ? user.name || user.id : '');
}

/** Opens a searchable list; choosing returns to the form with the value filled. */
function pick(app, panel, title, options, apply, subtitle, query, current) {
  app.select(
    title,
    options,
    (value) => {
      app.back();
      apply(value);
      panel.index = firstEmpty(panel);
    },
    subtitle,
    {
      search: true,
      query,
      index: Math.max(
        0,
        options.findIndex((o) => o.value === current),
      ),
    },
  );
}

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

function pickChannel(app, panel, query) {
  pick(
    app,
    panel,
    'Choose a sending channel',
    panel.picked.channels.map((ch) => ({
      label: ch.name || ch.id,
      detail: plural(ch.users.length, 'teammate'),
      value: ch,
    })),
    (channel) => setChannel(panel, channel),
    'The channel decides which number and inbox the text belongs to.',
    query,
    panel.picked.channel,
  );
}

function pickUser(app, panel, query) {
  const users = panel.picked.channel?.users;
  if (!users) return pickChannel(app, panel, '');
  pick(
    app,
    panel,
    'Send as',
    users.map((u) => ({ label: u.name || u.id, detail: u.role || '', value: u })),
    (user) => setUser(panel, user),
    'This teammate will own the message.',
    query,
    panel.picked.user,
  );
}

function pickContact(app, panel, query) {
  return app.run('Loading contacts', async (current) => {
    const result = await app.services.contacts({ page: 1, limit: 100 });
    const people = (Array.isArray(result) ? result : result.data).filter((c) => c.phone);
    if (!current()) return;
    if (!people.length) throw new Error('No contacts on the first page have a mobile number.');
    pick(
      app,
      panel,
      'Find a contact',
      people.map((c) => ({ label: displayName(c), detail: c.phone, value: c })),
      (contact) => set(panel, 'to', contact.phone),
      `Searching the first ${plural(people.length, 'contact')} with a mobile number.`,
      query,
    );
  });
}

/**
 * Opens the composer with the last sender, or the only choice, already picked.
 * `initial.channel` preselects a thread's channel when replying.
 */
export function startCompose(app, initial = {}) {
  return app.run('Loading channels', async (current) => {
    const [channels, recent] = await Promise.all([app.services.channels(), recentSender()]);
    if (!current()) return;
    const channel =
      channels.find((c) => c.id === (initial.channel || recent.channel)) ||
      (channels.length === 1 ? channels[0] : null);
    const user =
      channel?.users.find((u) => u.id === recent.user) ||
      (channel?.users.length === 1 ? channel.users[0] : null);
    compose(app, { channels, channel, user }, { to: initial.to });
  });
}

/** Channel and teammate are fields like the others, so changing one is one step. */
export function compose(app, { channels = [], channel = null, user = null } = {}, initial = {}) {
  let panel;
  app.form(
    'Compose a text',
    [
      { key: 'channel', label: 'Channel', pick: (q) => pickChannel(app, panel, q) },
      { key: 'user', label: 'Send as', pick: (q) => pickUser(app, panel, q) },
      { key: 'from', label: 'From · your Alive5 number', placeholder: '+15555550100' },
      {
        key: 'to',
        label: 'To · a number, or Enter to find a contact',
        placeholder: '+15555550101',
        pick: (q) => pickContact(app, panel, q),
        editable: true,
      },
      { key: 'message', label: 'Message', multiline: true, placeholder: 'Write your message' },
    ],
    async (values, current) => {
      const form = {
        channel: panel.picked.channel?.id,
        user: panel.picked.user?.id,
        from: values.from,
        to: values.to,
        message: values.message,
      };
      (app.services.sendForm || api.sendForm)(form);
      if (current()) app.show(previewPanel(app, form, panel.picked));
    },
    'Review before sending.',
    initial,
  );
  panel = app.state.panel;
  panel.picked = { channels, channel: null, user: null };
  if (channel) setChannel(panel, channel);
  if (user) setUser(panel, user);
  panel.index = firstEmpty(panel);
}

/** Review shows every consequential choice, not just the message. */
export function previewPanel(app, form, picked) {
  return {
    kind: 'preview',
    form,
    scroll: 0,
    outcome: null,
    context: [
      ['Workspace', app.state.account?.org_name || '—'],
      ['Channel', picked.channel?.name || form.channel || '—'],
      ['Send as', picked.user?.name || form.user || '—'],
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
      // Remembered only after Alive5 accepts, and never at the cost of the result.
      await saveRecentSender(panel.form).catch(() => {});
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
  if (Array.isArray(record.messages)) return app.transcript(record);
  app.reader(
    displayName(record) || 'Record',
    records.detailLines(record),
    'Full detail for the highlighted record',
  );
}

/** Composing to a contact found in a list, so the number is never retyped. */
export function messageRecord(app, record) {
  const phone = record.phone || record.contact?.phone;
  if (!phone) {
    app.state.notice = 'This record has no mobile number to message.';
    app.changed();
    return;
  }
  return startCompose(app, { to: phone, channel: record.channelId });
}
