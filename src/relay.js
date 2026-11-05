import { CliError, EXIT, httpError } from './errors.js';
import { clean } from './http.js';
import { inboxConfig, saveInboxConfig, key } from './storage.js';
import { USER_AGENT } from './meta.js';
import { randomUUID } from 'node:crypto';
import { channels } from './api.js';

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
  if (saved.relayUrl !== url || !Object.keys(saved.subscriptions || {}).length)
    throw notRegistered();
  for (const subscription of Object.values(saved.subscriptions)) {
    if (!subscription.subscriptionId || !subscription.deliveryToken || !subscription.channelId)
      throw notRegistered();
    relayUrl(subscription.websocketUrl, true);
  }
  return saved;
}

async function request(client, path, { method = 'GET', apiKey, body, timeout = 30000 } = {}) {
  try {
    const response = await fetch(`${client.relayUrl}/v1/subscriptions${path}`, {
      method,
      headers: {
        Accept: 'application/json',
        'User-Agent': USER_AGENT,
        ...(apiKey && { 'X-A5-APIKEY': apiKey }),
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
    for (const secret of [apiKey].filter(Boolean)) {
      error.message = clean(error.message, secret);
      error.code = clean(error.code, secret);
    }
    throw error;
  }
}

export async function addLine(line, options) {
  const { saved, url } = await settings();
  if (saved.relayUrl && saved.relayUrl !== url && Object.keys(saved.subscriptions || {}).length)
    throw new CliError(
      'RELAY_CHANGED',
      'Remove saved subscriptions before changing relay URL.',
      EXIT.usage,
    );
  const apiKey = await key();
  const channel = (await channels({ ...options, apiKey })).find((c) => c.name === line);
  if (!channel?.id) throw new CliError('line_not_in_account', 'Line not in account.', EXIT.auth);
  // Persist identity before POST so a retry after a lost response uses the same target.
  const client = {
    relayUrl: url,
    clientId: saved.clientId || randomUUID(),
    subscriptions: saved.subscriptions || {},
  };
  await saveInboxConfig(client);
  const data = await request(client, '', {
    ...options,
    method: 'POST',
    apiKey,
    body: { phoneNumber: line, target: { type: 'websocket', clientId: client.clientId } },
  });
  if (
    !data ||
    !['id', 'deliveryToken', 'websocketUrl'].every((k) => typeof data[k] === 'string' && data[k])
  )
    throw new CliError('INVALID_RESPONSE', 'Relay returned an incomplete subscription.', EXIT.api);
  const previous = client.subscriptions[line];
  client.subscriptions[line] = {
    subscriptionId: data.id,
    deliveryToken: data.deliveryToken,
    websocketUrl: relayUrl(data.websocketUrl, true),
    channelId: channel.id,
    ...(previous?.subscriptionId === data.id &&
      previous.checkpoint && { checkpoint: previous.checkpoint }),
  };
  await saveInboxConfig(client);
  return { line, subscriptionId: data.id, channelId: channel.id };
}

export async function removeLine(line, options) {
  const { saved, url } = await settings();
  if (saved.relayUrl !== url) throw notRegistered();
  const subscription = saved.subscriptions?.[line];
  if (subscription) {
    await request(saved, `/${encodeURIComponent(subscription.subscriptionId)}`, {
      ...options,
      method: 'DELETE',
      apiKey: await key(),
    });
    delete saved.subscriptions[line];
    await saveInboxConfig(saved);
  }
  return { line, removed: true };
}

export async function listLines() {
  const saved = await inboxConfig();
  return Object.entries(saved.subscriptions || {}).map(([line, s]) => ({
    line,
    subscriptionId: s.subscriptionId,
    channelId: s.channelId,
  }));
}
