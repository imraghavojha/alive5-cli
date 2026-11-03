import WebSocket from 'ws';
import { setTimeout as delay } from 'node:timers/promises';
import { CliError, EXIT, envelope } from './errors.js';
import { safe } from './output.js';
import { notRegistered } from './relay.js';

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
  const fields = ['type', 'id', 'line', 'channelId', 'from', 'text', 'threadId', 'receivedAt'];
  if (
    event?.type !== 'message' ||
    !fields.every((key) => typeof event[key] === 'string') ||
    !event.id
  )
    throw new CliError('INVALID_RESPONSE', 'Relay sent an unfamiliar text event.', EXIT.api);
  return Object.fromEntries(fields.map((key) => [key, event[key]]));
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

async function connection(client, { once, line, signal, write, notify, selected, pingMs }) {
  const socket = new WebSocket(client.wsUrl, {
    headers: { Authorization: `Bearer ${client.token}` },
    handshakeTimeout: 30000,
    maxPayload: 1024 * 1024,
    followRedirects: false,
  });
  let ping;
  let pongDeadline;
  let ready = false;
  let claimed = false;
  let ended = false;
  let queue = Promise.resolve();
  let pending = 0;
  let abort;
  try {
    return await new Promise((resolve, reject) => {
      const finish = (error, result = false) => {
        if (ended) return;
        ended = true;
        error ? reject(error) : resolve(result);
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
        queue.then(() => {
          const auth = [1008, 4401, 4403].includes(code) || (!ready && code === 1000);
          finish(auth ? notRegistered() : null);
        });
      });
      socket.on('message', (frame) => {
        if (ended || (once && claimed)) return;
        let event;
        try {
          event = message(frame);
        } catch (error) {
          finish(error);
          return;
        }
        if (event.type === 'ready') {
          ready = true;
          return;
        }
        if (event.type === 'pong') {
          clearTimeout(pongDeadline);
          pongDeadline = undefined;
          return;
        }
        if (event.type !== 'message' || (line && line !== event.line)) return;
        claimed = true;
        if (once) selected();
        pending++;
        clearTimeout(pongDeadline);
        pongDeadline = undefined;
        socket.pause();
        queue = queue
          .then(async () => {
            if (ended || signal.aborted) return;
            try {
              await write(event);
            } catch {
              finish(
                new CliError(
                  'OUTPUT_ERROR',
                  'Could not write the text to stdout; it remains unacked.',
                  EXIT.local,
                ),
              );
              return;
            }
            if (ended || signal.aborted) return;
            if (socket.readyState === WebSocket.OPEN) {
              try {
                await send(socket, { action: 'ack', id: event.id });
              } catch {
                socket.terminate();
              }
            }
            notify?.(event);
            pending--;
            if (once) finish(null, true);
            else if (!pending && socket.readyState === WebSocket.OPEN) socket.resume();
          })
          .catch(() =>
            finish(new CliError('LOCAL_ERROR', 'Could not finish receiving the text.', EXIT.local)),
          );
      });
    });
  } finally {
    ended = true;
    clearInterval(ping);
    clearTimeout(pongDeadline);
    signal.removeEventListener('abort', abort);
    socket.resume();
    await close(socket);
  }
}

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
  } = {},
) {
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
  let backoff = 1000;
  try {
    while (!controller.signal.aborted) {
      const started = Date.now();
      const done = await connection(client, {
        once,
        line,
        signal: controller.signal,
        write,
        notify,
        pingMs,
        selected: () => clearTimeout(timer),
      });
      if (done) return;
      if (Date.now() - started > 30000) backoff = 1000;
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
  } finally {
    clearTimeout(timer);
    process.removeListener('SIGINT', cancel);
    process.removeListener('SIGTERM', cancel);
    signal?.removeEventListener('abort', forward);
  }
}
