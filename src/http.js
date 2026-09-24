// Transport: one request function, the Alive5 response envelope, secret removal,
// and the list/pagination shapes the API returns. No command logic lives here.

import { CliError, EXIT, httpError } from './errors.js';
import { USER_AGENT } from './meta.js';
import { key } from './storage.js';

const ALLOWED_ORIGINS = ['https://api.alive5.com', 'https://api-v2.alive5.com'];

const SECRET_KEYS = /(api.?key|token|password|secret|alivesecure_key|aliveOpentokSession)/i;

/** Drops secret-looking fields and replaces the live API key wherever it appears. */
export function clean(value, secret) {
  if (Array.isArray(value)) return value.map((v) => clean(v, secret));
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .filter(([k]) => !SECRET_KEYS.test(k))
        .map(([k, v]) => [k, clean(v, secret)]),
    );
  if (typeof value === 'string') return secret ? value.split(secret).join('[redacted]') : value;
  return value;
}

/**
 * Alive5 nests its envelope, and a nested layer can report an error while the
 * outer layer says 200. Unwrap every layer so a failure can never look like data.
 */
export function unwrap(body) {
  let data = body;
  for (let i = 0; i < 8 && data && typeof data === 'object' && !Array.isArray(data); i++) {
    if (data.error || (data.code != null && Number(data.code) >= 400) || data.success === false) {
      const status = Number(data.code) || 400;
      const detail =
        typeof data.error === 'string'
          ? data.error
          : data.error?.message || data.message || 'Alive5 rejected the request.';
      throw httpError(status, detail);
    }
    const envelope =
      Object.hasOwn(data, 'data') && (Object.hasOwn(data, 'code') || Object.hasOwn(data, 'error'));
    if (!envelope) break;
    data = data.data;
  }
  return data;
}

export async function request(
  url,
  { apiKey, method = 'GET', form, timeout = 30000, fetchFn = fetch } = {},
) {
  if (!ALLOWED_ORIGINS.includes(new URL(url).origin))
    throw new CliError(
      'INVALID_HOST',
      'Requests must use an official Alive5 API host.',
      EXIT.usage,
    );
  const secret = apiKey || (await key());
  let response;
  try {
    let body;
    if (form) {
      body = new FormData();
      for (const [k, v] of Object.entries(form)) if (v !== undefined) body.set(k, String(v));
    }
    response = await fetchFn(url, {
      method,
      body,
      headers: { 'X-A5-APIKEY': secret, Accept: 'application/json', 'User-Agent': USER_AGENT },
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
          EXIT.api,
          { status: response.status },
        );
      parsed = {};
    }
    if (!response.ok) {
      // Prefer the body's own message; fall back to the status line.
      unwrap(parsed);
      throw httpError(response.status, `Alive5 returned HTTP ${response.status}.`);
    }
    if (
      !parsed ||
      typeof parsed !== 'object' ||
      !Object.hasOwn(parsed, 'data') ||
      !Object.hasOwn(parsed, 'code')
    )
      throw new CliError(
        'INVALID_RESPONSE',
        'Alive5 returned an unfamiliar response envelope.',
        EXIT.api,
      );
    return clean(unwrap(parsed), secret);
  } catch (error) {
    if (!(error instanceof CliError))
      error = new CliError(
        'NETWORK_ERROR',
        method === 'GET'
          ? 'Could not reach Alive5. Check your connection and try again.'
          : 'The send result is unknown. Check Alive5 or the recipient before sending again.',
        EXIT.api,
      );
    error.message = clean(error.message, secret);
    // Reads may be retried by the caller; writes never are, because a failed
    // send can still have been delivered.
    error.retryable =
      method === 'GET' &&
      (error.status === 429 || error.status >= 500 || error.code === 'NETWORK_ERROR');
    if (method !== 'GET' && (!error.status || error.status >= 500)) error.deliveryUnknown = true;
    const retryAfter = response?.headers.get('retry-after');
    if (retryAfter) error.retryAfter = retryAfter;
    throw error;
  }
}

/** Alive5 returns lists as a bare array, `Items`, or `items` depending on the endpoint. */
export function items(data) {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.Items)) return data.Items;
  if (Array.isArray(data?.items)) return data.items;
  throw new CliError(
    'UNEXPECTED_RESPONSE',
    'Alive5 returned an unfamiliar list structure. Run with --raw to inspect it.',
    EXIT.api,
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

export const query = (path, params = {}) => {
  const u = new URL(path);
  for (const [k, v] of Object.entries(params))
    if (v !== undefined) u.searchParams.set(k, String(v));
  return u.toString();
};
