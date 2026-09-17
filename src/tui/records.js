// Presentation for API records inside the workspace: compact rows for lists and
// a labelled detail view for one record. Column choices live here only.

import { displayName } from '../normalize.js';

const pad = (n) => String(n).padStart(2, '0');

/** Timestamps in this computer's timezone, as the date presets are. */
export function shortTime(v) {
  const d = new Date(v);
  if (Number.isNaN(d.valueOf())) return plain(v);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Lists say how long ago something happened; the detail view keeps the exact time. */
export function ago(v, now = Date.now()) {
  const seconds = (now - Date.parse(v)) / 1000;
  if (Number.isNaN(seconds)) return plain(v);
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  if (seconds < 7 * 86400) return `${Math.floor(seconds / 86400)}d ago`;
  return shortTime(v).slice(0, 10);
}

const TIME_KEYS = new Set(['at', 'updatedAt', 'startedAt', 'endedAt']);

const value = (v, key) => {
  if (key && TIME_KEYS.has(key) && typeof v === 'string') return shortTime(v);
  return plain(v);
};

const cell = (v, key) => (TIME_KEYS.has(key) && typeof v === 'string' ? ago(v) : plain(v));

const LINKS = { email: (v) => `mailto:${v}`, phone: (v) => `tel:${v}` };

const plain = (v) => {
  if (v == null || v === '') return '—';
  if (Array.isArray(v)) return v.length ? v.join(', ') : '—';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
};

const LABELS = {
  id: 'ID',
  firstName: 'First name',
  lastName: 'Last name',
  phone: 'Phone',
  email: 'Email',
  company: 'Company',
  tags: 'Tags',
  updatedAt: 'Updated',
  channelIds: 'Channels',
  role: 'Role',
  name: 'Name',
  threadId: 'Thread',
  channelId: 'Channel',
  at: 'Time',
  sender: 'Sender',
  text: 'Message',
  type: 'Type',
  assignedTo: 'Assigned to',
  startedAt: 'Started',
  endedAt: 'Ended',
};

export const label = (key) => LABELS[key] || key;

/**
 * Describes a record collection as a table: the columns worth showing, and one
 * row of cells per record. Full field detail stays available on demand.
 */
export function describe(kind, records) {
  const spec = TABLES[kind] || TABLES.generic(records);
  return {
    columns: spec.columns,
    rows: records.map((record) => ({
      record,
      cells: spec.columns.map(({ key, from }) => cell(from ? from(record) : record[key], key)),
      title: spec.title(record),
    })),
  };
}

const column = (key, header, width, from) => ({ key, header, width, from });

const TABLES = {
  contacts: {
    title: displayName,
    columns: [
      column('name', 'NAME', 22, displayName),
      column('phone', 'PHONE', 16),
      column('email', 'EMAIL', 26),
      column('company', 'COMPANY', 18),
    ],
  },
  channels: {
    title: (c) => c.name || c.id,
    columns: [
      column('name', 'CHANNEL', 24),
      column('users', 'TEAMMATES', 10, (c) => (c.users || []).length),
      column('id', 'ID', 30),
    ],
  },
  tags: {
    title: (t) => t.name || t.id,
    columns: [column('name', 'TAG', 30), column('id', 'ID', 30)],
  },
  messages: {
    title: (m) => `${m.sender || 'Unknown'} · ${m.at ? shortTime(m.at) : ''}`,
    columns: [
      column('at', 'WHEN', 10),
      column('sender', 'SENDER', 18),
      column('text', 'MESSAGE', 44),
    ],
  },
  conversations: {
    title: (c) => displayName(c.contact) || c.id,
    columns: [
      column('contact', 'CONTACT', 22, (c) => displayName(c.contact)),
      column('type', 'TYPE', 8),
      column('messages', 'MESSAGES', 9, (c) => (c.messages || []).length),
      column('startedAt', 'STARTED', 10),
    ],
  },
  generic: (records) => ({
    title: displayName,
    columns: Object.keys(records[0] || {})
      .filter((k) => !['tags', 'users', 'messages'].includes(k))
      .slice(0, 4)
      .map((k) => column(k, label(k).toUpperCase(), 24)),
  }),
};

/** The searchable text for a row, used by list filtering. */
export const searchText = (row) => row.cells.join(' ').toLowerCase();

/** One detail row: a label, its value, and a link where the value has one. */
const pair = (key, v) => [label(key), value(v, key), LINKS[key]?.(v)];

/**
 * Detail for one record. Plain strings are headings or prose; arrays are
 * [label, value, link] rows that the panels draw as aligned columns.
 */
export function detailLines(record) {
  const lines = [];
  for (const [key, v] of Object.entries(record)) {
    if (key === 'messages' || v == null || v === '') continue;
    if (key === 'contact' || key === 'channel') {
      lines.push(`› ${label(key)}`);
      for (const [k, nested] of Object.entries(v || {}))
        if (nested != null && nested !== '') lines.push(pair(k, nested));
      lines.push('');
      continue;
    }
    lines.push(pair(key, v));
  }
  if (Array.isArray(record.messages)) {
    lines.push('', `› Transcript · ${record.messages.length} messages`);
    for (const m of record.messages)
      lines.push(
        `${m.sender || 'Unknown'}  ·  ${m.at ? shortTime(m.at) : ''}`,
        String(m.text ?? ''),
        '',
      );
  }
  return lines;
}

/** Labelled rows for a single non-list result, such as a send outcome. */
export const resultLines = (data) =>
  Object.entries(data || {})
    .filter(([, v]) => v != null && v !== '')
    .map(([k, v]) => pair(k, v));

/** A detail row as one line of text, for the linear workspace. */
export const lineText = (line) => (Array.isArray(line) ? `${line[0]}: ${line[1]}` : line);
