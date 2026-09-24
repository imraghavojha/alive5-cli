// Input validation shared by commands, the API layer, and the workspace.
// Each function returns the value in the shape the API expects, or throws.

import { CliError, EXIT, usage } from './errors.js';

export function validateKey(k) {
  if (typeof k !== 'string' || !k.trim() || /[\r\n\x00-\x1f]/.test(k.trim()))
    throw new CliError('INVALID_KEY', 'Paste one API key without control characters.', EXIT.usage, {
      field: 'apiKey',
    });
  return k.trim();
}

export function integer(v, name = 'value', max = 10000) {
  if (!/^\d+$/.test(String(v)) || +v < 1 || +v > max)
    throw new CliError(
      'INVALID_ARGUMENT',
      `${name} must be an integer from 1 to ${max}.`,
      EXIT.usage,
      { field: name },
    );
  return +v;
}

/** Accepts an ISO calendar date and returns the MM-DD-YYYY form the API documents. */
export function date(v, field = 'date') {
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(v) ||
    Number.isNaN(Date.parse(v)) ||
    new Date(v).toISOString().slice(0, 10) !== v
  )
    throw new CliError('INVALID_DATE', 'Use a real date in YYYY-MM-DD format.', EXIT.usage, {
      field,
    });
  return `${v.slice(5, 7)}-${v.slice(8, 10)}-${v.slice(0, 4)}`;
}

export function dateRange(start, end) {
  const a = date(start, 'since');
  const b = date(end, 'until');
  if (start > end)
    throw new CliError('INVALID_DATE_RANGE', '--since must be on or before --until.', EXIT.usage, {
      field: 'since',
    });
  return [a, b];
}

export function phone(v, field = 'phone') {
  const s = String(v)
    .trim()
    .replace(/[ ()-]/g, '');
  if (!/^\+[1-9]\d{7,14}$/.test(s))
    throw new CliError(
      'INVALID_PHONE',
      'Use an international phone number, such as +15555550100.',
      EXIT.usage,
      { field },
    );
  return s;
}

/** Live chat offsets look like -5:00 or +0:00. */
export function timezoneOffset(v) {
  if (!/^[+-](?:0?\d|1[0-4]):[0-5]\d$/.test(v))
    throw usage('--timezone must look like -5:00 or +0:00.');
  return v;
}

export function timestamp(v) {
  if (v == null || v === '') return null;
  const n = Number(v);
  const d = new Date(Number.isFinite(n) ? n : v);
  return Number.isNaN(d.valueOf()) ? null : d.toISOString();
}

export const MESSAGE_LIMIT = 1600;

export function messageText(v) {
  if (typeof v !== 'string' || !v.trim())
    throw new CliError(
      'INVALID_MESSAGE',
      'Provide a nonempty --message or --message-file.',
      EXIT.usage,
      { field: 'message' },
    );
  if (v.length > MESSAGE_LIMIT)
    throw new CliError(
      'INVALID_MESSAGE',
      `Keep each message at or below ${MESSAGE_LIMIT} characters.`,
      EXIT.usage,
      { field: 'message', details: { length: v.length, limit: MESSAGE_LIMIT } },
    );
  return v;
}
