import { readFile, mkdir, writeFile, rename, rm, chmod } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

export const VERSION = '0.2.0';
export const DOCS = 'https://documenter.getpostman.com/view/12135254/UVsQr3zh';
export class CliError extends Error {
  constructor(code, message, exitCode = 1, extra = {}) {
    super(message);
    Object.assign(this, { code, exitCode, ...extra });
  }
}
export const configDir = () =>
  process.env.ALIVE5_CONFIG_DIR ||
  join(process.env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'alive5');
export async function config() {
  try {
    return JSON.parse(await readFile(join(configDir(), 'credentials.json'), 'utf8'));
  } catch (e) {
    if (e.code === 'ENOENT') return {};
    throw new CliError(
      'CONFIG_ERROR',
      'Cannot read credentials. Check the config file or run alive5 auth login.',
    );
  }
}
export async function saveConfig(value) {
  const dir = configDir();
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const tmp = join(dir, `.credentials-${randomUUID()}`);
  try {
    await writeFile(tmp, JSON.stringify(value) + '\n', { mode: 0o600, flag: 'wx' });
    await rename(tmp, join(dir, 'credentials.json'));
    await chmod(join(dir, 'credentials.json'), 0o600);
  } finally {
    await rm(tmp, { force: true });
  }
}
export async function logout() {
  await rm(join(configDir(), 'credentials.json'), { force: true });
}
export async function key() {
  const k = process.env.ALIVE5_API_KEY || (await config()).apiKey;
  if (!k) throw new CliError('AUTH_REQUIRED', 'Run alive5 auth login, or set ALIVE5_API_KEY.', 3);
  return validateKey(k);
}
export function validateKey(k) {
  if (typeof k !== 'string' || !k.trim() || /[\r\n\x00-\x1f]/.test(k.trim()))
    throw new CliError('INVALID_KEY', 'Paste one API key without control characters.', 2);
  return k.trim();
}
export function clean(value, secret) {
  if (Array.isArray(value)) return value.map((v) => clean(v, secret));
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .filter(
          ([k]) => !/(api.?key|token|password|secret|alivesecure_key|aliveOpentokSession)/i.test(k),
        )
        .map(([k, v]) => [k, clean(v, secret)]),
    );
  if (typeof value === 'string') return secret ? value.split(secret).join('[redacted]') : value;
  return value;
}
export function unwrap(body) {
  let data = body;
  for (let i = 0; i < 8 && data && typeof data === 'object' && !Array.isArray(data); i++) {
    if (data.error || (data.code != null && Number(data.code) >= 400) || data.success === false) {
      const status = Number(data.code) || 400;
      const detail =
        typeof data.error === 'string'
          ? data.error
          : data.error?.message || data.message || 'Alive5 rejected the request.';
      throw new CliError(
        status === 401 || status === 403
          ? 'AUTH_FAILED'
          : status === 429
            ? 'RATE_LIMITED'
            : 'API_ERROR',
        detail,
        status === 401 || status === 403 ? 3 : status === 429 ? 5 : 4,
        { status },
      );
    }
    if (
      !Object.hasOwn(data, 'data') ||
      !(Object.hasOwn(data, 'code') || Object.hasOwn(data, 'error'))
    )
      break;
    data = data.data;
  }
  return data;
}
export async function request(
  url,
  { apiKey, method = 'GET', form, timeout = 30000, fetchFn = fetch } = {},
) {
  if (!['https://api.alive5.com', 'https://api-v2.alive5.com'].includes(new URL(url).origin))
    throw new CliError('INVALID_HOST', 'Requests must use an official Alive5 API host.', 2);
  const secret = apiKey || (await key());
  let response;
  try {
    const body = form ? new FormData() : undefined;
    if (form)
      for (const [k, v] of Object.entries(form)) if (v !== undefined) body.set(k, String(v));
    response = await fetchFn(url, {
      method,
      body,
      headers: {
        'X-A5-APIKEY': secret,
        Accept: 'application/json',
        'User-Agent': `alive5-cli/${VERSION}`,
      },
      redirect: 'error',
      signal: AbortSignal.timeout(timeout),
    });
    const text = await response.text();
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      if (response.ok)
        throw new CliError(
          'INVALID_RESPONSE',
          `Alive5 returned a non-JSON response (HTTP ${response.status}).`,
          4,
          { status: response.status },
        );
      parsed = {};
    }
    if (!response.ok) {
      try {
        unwrap(parsed);
      } catch (e) {
        throw e;
      }
      throw new CliError(
        response.status === 401 || response.status === 403
          ? 'AUTH_FAILED'
          : response.status === 429
            ? 'RATE_LIMITED'
            : 'API_ERROR',
        `Alive5 returned HTTP ${response.status}.`,
        response.status === 401 || response.status === 403 ? 3 : response.status === 429 ? 5 : 4,
        { status: response.status },
      );
    }
    if (
      !parsed ||
      typeof parsed !== 'object' ||
      !Object.hasOwn(parsed, 'data') ||
      !Object.hasOwn(parsed, 'code')
    )
      throw new CliError('INVALID_RESPONSE', 'Alive5 returned an unfamiliar response envelope.', 4);
    return clean(unwrap(parsed), secret);
  } catch (error) {
    if (!(error instanceof CliError))
      error = new CliError(
        'NETWORK_ERROR',
        method === 'GET'
          ? 'Could not reach Alive5. Check your connection and try again.'
          : 'The send result is unknown. Check Alive5 or the recipient before sending again.',
        4,
      );
    error.message = clean(error.message, secret);
    error.retryable =
      method === 'GET' &&
      (error.status === 429 || error.status >= 500 || error.code === 'NETWORK_ERROR');
    if (method !== 'GET' && (!error.status || error.status >= 500)) error.deliveryUnknown = true;
    if (response?.headers.get('retry-after'))
      error.retryAfter = response.headers.get('retry-after');
    throw error;
  }
}
export function integer(v, name = 'value', max = 10000) {
  if (!/^\d+$/.test(String(v)) || +v < 1 || +v > max)
    throw new CliError('INVALID_ARGUMENT', `${name} must be an integer from 1 to ${max}.`, 2);
  return +v;
}
export function date(v) {
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(v) ||
    Number.isNaN(Date.parse(v)) ||
    new Date(v).toISOString().slice(0, 10) !== v
  )
    throw new CliError('INVALID_DATE', 'Use a real date in YYYY-MM-DD format.', 2);
  return `${v.slice(5, 7)}-${v.slice(8, 10)}-${v.slice(0, 4)}`;
}
export function dateRange(start, end) {
  const a = date(start),
    b = date(end);
  if (start > end)
    throw new CliError('INVALID_DATE_RANGE', '--since must be on or before --until.', 2);
  return [a, b];
}
export function phone(v) {
  const s = String(v)
    .trim()
    .replace(/[ ()-]/g, '');
  if (!/^\+[1-9]\d{7,14}$/.test(s))
    throw new CliError(
      'INVALID_PHONE',
      'Use an international phone number, such as +15555550100.',
      2,
    );
  return s;
}
export function timestamp(v) {
  if (v == null || v === '') return null;
  const n = Number(v);
  const d = new Date(Number.isFinite(n) ? n : v);
  return Number.isNaN(d.valueOf()) ? null : d.toISOString();
}
export function items(data) {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.Items)) return data.Items;
  if (Array.isArray(data?.items)) return data.items;
  throw new CliError(
    'UNEXPECTED_RESPONSE',
    'Alive5 returned an unfamiliar list structure. Run with --raw to inspect it.',
    4,
  );
}
export function pagination(data, page) {
  const current = Number(data?.page ?? page ?? 1);
  const total = data?.totalPages ?? data?.pages;
  return {
    page: current,
    totalPages: total == null ? null : Number(total),
    nextPage: total == null ? null : current < Number(total) ? current + 1 : null,
    totalRecords: data?.totalRecord == null ? null : Number(data.totalRecord),
  };
}
export const envelope = (data, meta = {}) => ({
  ok: true,
  data,
  error: null,
  meta: { schemaVersion: 1, ...meta },
});
export function failure(e) {
  return {
    ok: false,
    data: null,
    error: {
      code: e.code || 'INTERNAL_ERROR',
      message: e.message,
      retryable: e.retryable || false,
      ...(e.status && { status: e.status }),
      ...(e.deliveryUnknown && { deliveryUnknown: true }),
      ...(e.retryAfter && { retryAfter: e.retryAfter }),
    },
    meta: { schemaVersion: 1 },
  };
}
