import WebSocket from 'ws';
import { setTimeout as delay } from 'node:timers/promises';
import { CliError, EXIT, envelope } from './errors.js';
import { safe } from './output.js';
import { notRegistered } from './relay.js';
import { inboxHistory } from './api.js';
import { saveInboxCheckpoint } from './storage.js';
import { createHash } from 'node:crypto';

export function writeText(event, { stdout = process.stdout, json = !stdout.isTTY } = {}) {
  const line = json
    ? JSON.stringify(envelope(event))
    : `${safe(event.receivedAt)}  ${safe(event.from)} → ${safe(event.line)}  ${safe(event.text)}`;
  return new Promise((resolve, reject) => {
    stdout.write(line + '\n', (error) => (error ? reject(error) : resolve()));
  });
}

function message(frame) {
  let event;
  try {
    event = JSON.parse(frame.toString());
  } catch {
    throw new CliError('INVALID_RESPONSE', 'Relay sent an invalid WebSocket frame.', EXIT.api);
  }
  if (event?.type === 'ready' || event?.type === 'pong') return event;
  const strings = [
    'event_id',
    'message',
    'from_phone',
    'business_line',
    'channel_id',
    'received_at',
  ];
  if (
    !event ||
    !strings.every((k) => typeof event[k] === 'string') ||
    !event.event_id ||
    event.direction !== 'inbound' ||
    !Number.isFinite(Date.parse(event.received_at)) ||
    !(event.thread_id === null || typeof event.thread_id === 'string') ||
    !(event.media_url === null || typeof event.media_url === 'string')
  )
    throw new CliError('INVALID_RESPONSE', 'Relay sent an unfamiliar text event.', EXIT.api);
  return {
    type: 'message',
    id: event.event_id,
    text: event.message,
    from: event.from_phone,
    line: event.business_line,
    channelId: event.channel_id,
    threadId: event.thread_id,
    receivedAt: event.received_at,
    direction: event.direction,
    mediaUrl: event.media_url,
  };
}

function send(socket, data) {
  return new Promise((resolve, reject) => {
    socket.send(JSON.stringify(data), (error) => (error ? reject(error) : resolve()));
  });
}

async function close(socket) {
  if (socket.readyState === WebSocket.CLOSED) return;
  await new Promise((resolve) => {
    const timer = setTimeout(() => socket.terminate(), 1000);
    socket.once('close', () => {
      clearTimeout(timer);
      resolve();
    });
    if (socket.readyState === WebSocket.OPEN) socket.close();
    else socket.terminate();
  });
}

// A connection holds live frames only while the history scan is running. Once
// merged, pause the socket until stdout and the checkpoint have both drained.
async function connection(subscription, line, { signal, deliver, pingMs, renewMs, history }) {
  const url = new URL(subscription.websocketUrl);
  url.searchParams.set('subscriptionId', subscription.subscriptionId);
  url.searchParams.set('deliveryToken', subscription.deliveryToken);
  const socket = new WebSocket(url, {
    handshakeTimeout: 30000,
    maxPayload: 1024 * 1024,
    followRedirects: false,
  });
  const scanController = new AbortController();
  let ping, pongDeadline, renewal, abort;
  let ended = false;
  let scanning = true;
  let held = [];
  let queue = Promise.resolve();
  let scanTask = Promise.resolve();
  let pending = 0;
  try {
    return await new Promise((resolve, reject) => {
      const finish = (error, result = false) => {
        if (ended) return;
        ended = true;
        error ? reject(error) : resolve(result);
      };
      const enqueue = (event) => {
        pending++;
        clearTimeout(pongDeadline);
        pongDeadline = undefined;
        socket.pause();
        queue = queue
          .then(async () => {
            if (ended || signal.aborted) return;
            if (await deliver(event, subscription)) finish(null, true);
            pending--;
            if (!pending && socket.readyState === WebSocket.OPEN) socket.resume();
          })
          .catch(finish);
      };
      abort = () => finish(signal.reason);
      socket.on('error', () => {});
      signal.addEventListener('abort', abort, { once: true });
      if (signal.aborted) return abort();
      socket.on('open', () => {
        ping = setInterval(() => {
          if (!pending && !pongDeadline && socket.readyState === WebSocket.OPEN) {
            pongDeadline = setTimeout(() => socket.terminate(), 60000);
            send(socket, { action: 'ping' }).catch(() => socket.terminate());
          }
        }, pingMs);
        renewal = setTimeout(() => socket.terminate(), renewMs);
        const since = subscription.checkpoint?.receivedAt
          ? Date.parse(subscription.checkpoint.receivedAt) - 60000
          : Date.now() - 24 * 60 * 60 * 1000;
        scanTask = Promise.resolve()
          .then(() =>
            history(line, subscription.channelId, since, {
              signal: AbortSignal.any([signal, scanController.signal]),
            }),
          )
          .then((past) => {
            if (ended || signal.aborted) return;
            // Prefer the relay ID when a history row and live frame share a time.
            const merged = [...held, ...past].sort(
              (a, b) => Date.parse(a.receivedAt) - Date.parse(b.receivedAt),
            );
            held = [];
            scanning = false;
            for (const event of merged) enqueue(event);
          })
          .catch(finish);
      });
      socket.on('unexpected-response', (request, response) => {
        const auth = response.statusCode === 401 || response.statusCode === 403;
        response.destroy();
        request.destroy();
        finish(auth ? notRegistered() : null);
      });
      socket.on('close', (code) => {
        clearInterval(ping);
        clearTimeout(pongDeadline);
        clearTimeout(renewal);
        scanTask
          .then(() => queue)
          .then(() => finish([1008, 4401, 4403].includes(code) ? notRegistered() : null));
      });
      socket.on('message', (frame) => {
        if (ended) return;
        let event;
        try {
          event = message(frame);
        } catch (error) {
          finish(error);
          return;
        }
        if (event.type === 'ready') return;
        if (event.type === 'pong') {
          clearTimeout(pongDeadline);
          pongDeadline = undefined;
          return;
        }
        if (event.line !== line || event.channelId !== subscription.channelId) return;
        if (scanning) {
          held.push(event);
          if (held.length > 10000)
            finish(
              new CliError(
                'BACKFILL_INCOMPLETE',
                'Too many live frames during history scan; retry to recover history.',
                EXIT.api,
              ),
            );
        } else enqueue(event);
      });
    });
  } finally {
    ended = true;
    scanController.abort();
    clearInterval(ping);
    clearTimeout(pongDeadline);
    clearTimeout(renewal);
    signal.removeEventListener('abort', abort);
    socket.resume();
    await close(socket);
  }
}

const fingerprint = (event) =>
  createHash('sha256')
    .update(JSON.stringify([event.from, event.text]))
    .digest('hex');

export async function receive(
  client,
  {
    once = false,
    line,
    timeout,
    write = writeText,
    notify,
    warn = console.error,
    signal,
    pingMs = 5 * 60 * 1000,
    renewMs = 110 * 60 * 1000,
    history = inboxHistory,
    checkpoint = saveInboxCheckpoint,
    backoffMs = 1000,
  } = {},
) {
  const subscriptions = Object.entries(client.subscriptions).filter(
    ([number]) => !line || line === number,
  );
  if (!subscriptions.length) throw notRegistered();
  const controller = new AbortController();
  const cancel = () =>
    controller.abort(new CliError('CANCELLED', 'Inbox stopped.', EXIT.cancelled));
  const forward = () => controller.abort(signal.reason);
  process.once('SIGINT', cancel);
  process.once('SIGTERM', cancel);
  signal?.addEventListener('abort', forward, { once: true });
  if (signal?.aborted) forward();
  const timer =
    timeout === undefined
      ? undefined
      : setTimeout(() => {
          controller.abort(
            new CliError('WAIT_TIMEOUT', 'No text arrived before the timeout.', EXIT.timeout),
          );
        }, timeout * 1000);
  let output = Promise.resolve();
  let completed = false;
  // All sockets share one output queue, including wait's single-text claim.
  const deliver = (event, subscription) => {
    const result = output.then(async () => {
      if (controller.signal.aborted || completed) return false;
      const at = Date.parse(event.receivedAt);
      const key = fingerprint(event);
      const saved = subscription.checkpoint;
      if (
        saved?.seen?.some(
          (s) => (event.id && s.id === event.id) || (s.key === key && Math.abs(s.at - at) <= 5000),
        )
      )
        return false;
      if (once) clearTimeout(timer);
      try {
        await write(event);
      } catch {
        throw new CliError(
          'OUTPUT_ERROR',
          'Could not write the text to stdout; checkpoint was not advanced.',
          EXIT.local,
        );
      }
      if (controller.signal.aborted) return false;
      const latest = Math.max(at, Date.parse(saved?.receivedAt) || 0);
      const next = {
        receivedAt: new Date(latest).toISOString(),
        seen: [...(saved?.seen || []), { key, at, id: event.id }]
          .filter((s) => s.at >= latest - 60000)
          .slice(-1000),
      };
      try {
        await checkpoint(event.line, subscription.subscriptionId, next);
      } catch {
        throw new CliError(
          'CONFIG_ERROR',
          'Text was written but its inbox checkpoint could not be saved.',
          EXIT.local,
        );
      }
      subscription.checkpoint = next;
      notify?.(event);
      completed = once;
      return once;
    });
    // Keep later work stopped on failure until the controller closes all sockets.
    output = result;
    return result;
  };
  const run = async ([number, subscription]) => {
    let backoff = backoffMs;
    while (!controller.signal.aborted) {
      const started = Date.now();
      if (
        await connection(subscription, number, {
          signal: controller.signal,
          deliver,
          pingMs,
          renewMs,
          history,
        })
      )
        return;
      if (Date.now() - started > 30000) backoff = backoffMs;
      const wait = Math.round(backoff * (0.8 + Math.random() * 0.2));
      warn(`Relay disconnected; reconnecting in ${(wait / 1000).toFixed(1)}s.`);
      try {
        await delay(wait, undefined, { signal: controller.signal });
      } catch {
        throw controller.signal.reason;
      }
      backoff = Math.min(backoff * 2, 30000);
    }
    throw controller.signal.reason;
  };
  const workers = subscriptions.map(run);
  try {
    await Promise.race(workers);
  } finally {
    controller.abort();
    await Promise.allSettled(workers);
    clearTimeout(timer);
    process.removeListener('SIGINT', cancel);
    process.removeListener('SIGTERM', cancel);
    signal?.removeEventListener('abort', forward);
  }
}
