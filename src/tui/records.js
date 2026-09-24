// Presentation for API records inside the workspace: compact rows for lists and
// a labelled detail view for one record. Column choices live here only.

import { displayName } from '../normalize.js';

/** ISO timestamps are shown without the T and Z, which cost width and read badly. */
const shortTime = (v) =>
  String(v)
    .replace('T', ' ')
    .replace(/(:\d{2})?(\.\d+)?Z?$/, '');

const TIME_KEYS = new Set(['at', 'updatedAt', 'startedAt', 'endedAt']);

const value = (v, key) => {
  if (key && TIME_KEYS.has(key) && typeof v === 'string') return shortTime(v);
  return plain(v);
};

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
      cells: spec.columns.map(({ key, from }) => value(from ? from(record) : record[key], key)),
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
    title: (m) => `${m.sender || 'Unknown'} · ${m.at || ''}`,
    columns: [
      column('at', 'TIME', 17),
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
      column('startedAt', 'STARTED', 17),
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

/** Labelled lines for one record, including nested contacts and transcripts. */
export function detailLines(record) {
  const lines = [];
  for (const [key, v] of Object.entries(record)) {
    if (key === 'messages' || v == null || v === '') continue;
    if (key === 'contact' || key === 'channel') {
      lines.push(`› ${label(key)}`);
      for (const [k, nested] of Object.entries(v || {}))
        if (nested != null && nested !== '') lines.push(`${label(k)}: ${value(nested, k)}`);
      lines.push('');
      continue;
    }
    lines.push(`${label(key)}: ${value(v, key)}`);
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

/** Labelled lines for a single non-list result, such as a send outcome. */
export const resultLines = (data) =>
  Object.entries(data || {})
    .filter(([, v]) => v != null && v !== '')
    .map(([k, v]) => `${label(k)}: ${value(v, k)}`);
