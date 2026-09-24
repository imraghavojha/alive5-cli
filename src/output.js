// Human-readable text output for the command path. The JSON envelope is built in
// ./errors.js; nothing here ever runs when --json or a pipe selects JSON.

import pc from 'picocolors';
import { displayName } from './normalize.js';

/** Strips control characters so API or transcript text cannot move the cursor. */
export const safe = (v) => String(v ?? '—').replace(/[\x00-\x1f\x7f-\x9f]/g, ' ');

export const colors = () =>
  pc.createColors(
    Boolean(process.stdout.isTTY && !('NO_COLOR' in process.env) && process.env.TERM !== 'dumb'),
  );

const width = () => process.stdout.columns || 100;

const out = (line = '') => console.log(line);

const ellipsis = (text, max) => (text.length > max ? text.slice(0, max - 1) + '…' : text);

// Columns chosen per record type, so lists show what identifies a record instead
// of every normalized field. Anything not listed falls back to the record's keys.
const COLUMNS = {
  contact: ['name', 'phone', 'email', 'company'],
  channel: ['name', 'id', 'users'],
  tag: ['name', 'id'],
  user: ['name', 'email', 'role', 'id'],
};

function classify(row) {
  if ('firstName' in row || 'company' in row) return 'contact';
  if ('channelIds' in row) return 'user';
  if ('users' in row) return 'channel';
  if ('tags' in row && 'name' in row && Object.keys(row).length <= 3) return 'tag';
  return null;
}

const cellValue = (row, column) => {
  if (column === 'name') return displayName(row);
  const v = row[column];
  if (Array.isArray(v)) return column === 'users' ? `${v.length}` : v.join(', ');
  return safe(v);
};

function table(rows, columns, color) {
  const widths = columns.map((c) =>
    Math.min(36, Math.max(c.length, ...rows.map((r) => safe(cellValue(r, c)).length))),
  );
  const fits = widths.reduce((a, b) => a + b + 3, 2) <= width();
  if (!fits) {
    // Narrow terminals get one labelled block per record instead of a clipped grid.
    for (const row of rows) {
      out();
      out(`  ${color.cyan(ellipsis(displayName(row), width() - 4))}`);
      for (const c of columns.filter((c) => c !== 'name'))
        out(`  ${color.dim(c.padEnd(10))} ${safe(cellValue(row, c))}`);
    }
    return;
  }
  const line = (values) =>
    values.map((v, i) => ellipsis(safe(v), widths[i]).padEnd(widths[i])).join('   ');
  out('\n  ' + color.dim(line(columns.map((c) => c.toUpperCase()))));
  for (const row of rows) {
    out('  ' + line(columns.map((c) => cellValue(row, c))));
    for (const u of row.users || [])
      out(`    ${color.dim('↳')} ${safe(displayName(u))}  ${color.dim(safe(u.id))}`);
  }
}

function messageList(rows, color) {
  for (const m of rows)
    out(
      `\n  ${color.cyan(safe(m.sender))}  ${color.dim(safe(m.at))}\n  ${safe(m.text)}\n  ${color.dim('Thread ' + safe(m.threadId))}`,
    );
}

function transcripts(rows, color) {
  for (const r of rows) {
    out(`\n  ${color.cyan(safe(displayName(r.contact) || r.id))}  ${color.dim(safe(r.id))}`);
    for (const m of r.messages)
      out(`  ${color.dim(safe(m.at))}  ${safe(m.sender)}\n    ${safe(m.text)}`);
  }
}

function footer(count, meta, color) {
  const page = meta.page
    ? ` · page ${meta.page}${meta.totalPages ? ` of ${meta.totalPages}` : ''}`
    : '';
  out(`\n  ${color.dim(`${count} results${page}`)}`);
  if (meta.nextPage) out(`  ${color.cyan(`Next: add --page ${meta.nextPage}`)}`);
  out();
}

function keyValues(data, color, labels = {}) {
  out(
    '\n' +
      Object.entries(data)
        .map(([k, v]) => {
          const label = labels[k] || k;
          const value = v && typeof v === 'object' ? JSON.stringify(v) : v;
          return `  ${color.dim(label.padEnd(16))} ${safe(value)}`;
        })
        .join('\n') +
      '\n',
  );
}

function block(title, rows, color) {
  const pad = Math.max(...rows.map(([k]) => k.length));
  out(`\n  ${color.dim('┌')} ${color.bold(title)}`);
  for (const [k, v] of rows) out(`  ${color.dim('│')} ${color.dim(k.padEnd(pad))}  ${safe(v)}`);
  out(`  ${color.dim('└')}\n`);
}

export function render(data, meta = {}) {
  const color = colors();
  if (Array.isArray(data)) {
    if (!data.length) return out(`\n  ${color.dim('No results in this view.')}\n`);
    const records = data.every((r) => r && typeof r === 'object' && !Array.isArray(r));
    if (records) {
      const keys = Object.keys(data[0]);
      if (keys.includes('messages')) transcripts(data, color);
      else if (keys.includes('text') && keys.includes('threadId')) messageList(data, color);
      else table(data, COLUMNS[classify(data[0])] || keys.filter((k) => k !== 'tags'), color);
      return footer(data.length, meta, color);
    }
    return out(data.map((v) => '  ' + safe(v)).join('\n'));
  }
  if (data?.preview) {
    block(
      'Message preview · validated locally, nothing sent',
      [
        ['From', data.form.phone_number_from],
        ['To', data.form.phone_number_to],
        ['Channel', data.form.channel_id],
        ['Send as', data.form.user_id],
        ['Message', data.form.message],
      ],
      color,
    );
    return out(`  ${color.dim('Add --yes to send this message.')}\n`);
  }
  if (data?.deliveryConfirmed === false) {
    block(
      'Accepted by Alive5 · handset delivery not yet confirmed',
      [
        ['To', data.to],
        ['From', data.from],
        ['Status', data.status],
        ['ID', data.id],
        ['Message', data.text],
      ],
      color,
    );
    return;
  }
  if (data && typeof data === 'object') return keyValues(data, color);
  out(safe(data));
}

/**
 * Builds the single `write` used by every command: field projection, then either
 * one JSON document or the text renderer.
 */
export function writer({ json, fields, envelope, invalidFields }) {
  return (data, meta = {}) => {
    const selected = fields();
    if (selected) {
      const names = selected.split(',');
      const project = (row) => {
        if (!row || typeof row !== 'object' || names.some((n) => !Object.hasOwn(row, n)))
          throw invalidFields();
        return Object.fromEntries(names.map((n) => [n, row[n]]));
      };
      data = Array.isArray(data) ? data.map(project) : project(data);
    }
    if (json()) console.log(JSON.stringify(envelope(data, meta)));
    else render(data, meta);
  };
}
