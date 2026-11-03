import { CliError, EXIT, httpError } from './errors.js';
import { clean } from './http.js';
import { inboxConfig, saveInboxConfig, key } from './storage.js';
import { USER_AGENT } from './meta.js';

export const notRegistered = () =>
  new CliError(
    'not_registered',
    'Run alive5 inbox channels add <line> to register this client with the relay.',
    EXIT.auth,
  );

export function relayUrl(value, websocket = false) {
  let url;
  try {
    url = new URL(value);
  } catch {}
  const secure = websocket ? 'wss:' : 'https:';
  const local = websocket ? 'ws:' : 'http:';
  if (
    !url ||
    url.username ||
    url.password ||
    url.hash ||
    (!websocket && url.search) ||
    (url.protocol !== secure &&
      !(url.protocol === local && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))
  )
    throw new CliError(
      'INVALID_RELAY_URL',
      `Use a ${secure}// relay URL (localhost may use ${local}//).`,
      EXIT.usage,
    );
  return websocket ? url.toString() : url.toString().replace(/\/$/, '');
}

async function settings() {
  const saved = await inboxConfig();
  const value = process.env.ALIVE5_RELAY_URL || saved.relayUrl;
  if (!value)
    throw new CliError(
      'RELAY_NOT_CONFIGURED',
      'Set ALIVE5_RELAY_URL=https://<deployed-relay-host>, or set relayUrl in inbox.json in the Alive5 config directory.',
      EXIT.usage,
    );
  const url = relayUrl(value);
  return { saved, url };
}

export async function registeredClient() {
  const { saved, url } = await settings();
  if (saved.relayUrl !== url || !saved.clientId || !saved.token || !saved.wsUrl)
    throw notRegistered();
  relayUrl(saved.wsUrl, true);
  return saved;
}

async function request(client, path, { method = 'GET', apiKey, body, timeout = 30000 } = {}) {
  try {
    const response = await fetch(`${client.relayUrl}/v1/cli${path}`, {
      method,
      headers: {
        Accept: 'application/json',
        'User-Agent': USER_AGENT,
        ...(client.token && { Authorization: `Bearer ${client.token}` }),
        ...(apiKey && { 'X-Alive5-Api-Key': apiKey }),
        ...(body && { 'Content-Type': 'application/json' }),
      },
      body: body && JSON.stringify(body),
      redirect: 'error',
      signal: AbortSignal.timeout(timeout),
    });
    const text = await response.text();
    let data;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      if (response.ok)
        throw new CliError('INVALID_RESPONSE', 'Relay returned invalid JSON.', EXIT.api);
    }
    if (!response.ok) {
      if (response.status === 401 && client.token) throw notRegistered();
      const error = httpError(
        response.status,
        data?.error?.message || `Relay returned HTTP ${response.status}.`,
      );
      if (typeof data?.error?.code === 'string') error.code = data.error.code;
      throw error;
    }
    return data;
  } catch (error) {
    if (!(error instanceof CliError))
      error = new CliError(
        'NETWORK_ERROR',
        'Could not reach the relay. Check your connection and relay URL.',
        EXIT.api,
      );
    for (const secret of [apiKey, client.token].filter(Boolean)) {
      error.message = clean(error.message, secret);
      error.code = clean(error.code, secret);
    }
    throw error;
  }
}

export async function addLine(line, options) {
  const { saved, url } = await settings();
  const apiKey = await key();
  const register = async () => {
    const data = await request({ relayUrl: url }, '/register', {
      ...options,
      method: 'POST',
      apiKey,
      body: {},
    });
    if (
      !data ||
      !['clientId', 'token', 'wsUrl'].every((k) => typeof data[k] === 'string' && data[k])
    )
      throw new CliError(
        'INVALID_RESPONSE',
        'Relay registration returned an incomplete client.',
        EXIT.api,
      );
    const client = {
      relayUrl: url,
      clientId: data.clientId,
      token: data.token,
      wsUrl: relayUrl(data.wsUrl, true),
    };
    await saveInboxConfig(client);
    return client;
  };
  let client =
    saved.relayUrl !== url || !saved.clientId || !saved.token || !saved.wsUrl
      ? await register()
      : saved;
  const add = () =>
    request(client, '/lines', { ...options, method: 'POST', apiKey, body: { line } });
  let data;
  try {
    data = await add();
  } catch (error) {
    if (error.code !== 'not_registered') throw error;
    client = await register();
    data = await add();
  }
  return clean(clean(data, apiKey), client.token);
}

export async function removeLine(line, options) {
  const client = await registeredClient();
  await request(client, `/lines/${encodeURIComponent(line)}`, {
    ...options,
    method: 'DELETE',
    apiKey: await key(),
  });
  return { line, removed: true };
}

export async function listLines(options) {
  const client = await registeredClient();
  const data = await request(client, '/lines', options);
  if (!Array.isArray(data?.lines))
    throw new CliError('INVALID_RESPONSE', 'Relay returned an unfamiliar line list.', EXIT.api);
  return clean(data.lines, client.token);
}
