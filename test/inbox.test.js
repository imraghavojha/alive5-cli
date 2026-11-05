import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, writeFile, stat, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Writable } from 'node:stream';
import { setTimeout as delay } from 'node:timers/promises';
import { WebSocketServer } from 'ws';
import { receive, writeText } from '../src/inbox.js';
import { inboxHistory } from '../src/api.js';
import { notifier } from '../src/notify.js';

const LINE = '+15555550100';
const OTHER = '+15555550200';
const AT = Date.now() - 60000;
const event = (id, line = LINE, at = AT) => ({
  event_id: id,
  message: `Hello ${id}\n"there"\u001b[2J`,
  from_phone: '+15555550101',
  business_line: line,
  channel_id: line === LINE ? 'channel-1' : 'channel-2',
  thread_id: null,
  direction: 'inbound',
  received_at: new Date(at).toISOString(),
  media_url: null,
});
const outputEvent = (e) => ({
  type: 'message',
  id: e.event_id,
  text: e.message,
  from: e.from_phone,
  line: e.business_line,
  channelId: e.channel_id,
  threadId: e.thread_id,
  receivedAt: e.received_at,
  direction: e.direction,
  mediaUrl: e.media_url,
});
const row = (e) => ({
  message_content: e.message,
  created_by: e.from_phone,
  channel_name: e.business_line,
  channel_id: e.channel_id,
  thread_id: e.thread_id,
  created_at: e.received_at,
  media_url: e.media_url,
});
async function until(predicate, timeout = 5000) {
  const end = Date.now() + timeout;
  while (!(await predicate())) {
    if (Date.now() > end) throw new Error('Timed out waiting for test condition');
    await delay(10);
  }
}

async function fixture(t, { registered = true, multiple = false } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'alive5-inbox-'));
  const requests = [];
  const state = {
    frames: [],
    sent: [],
    checkpoints: [],
    pings: 0,
    connections: 0,
    sockets: [],
    auth: true,
    rows: [],
  };
  const server = createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    requests.push({ method: req.method, url: req.url, headers: req.headers, body });
    res.setHeader('Content-Type', 'application/json');
    if (req.headers['x-a5-apikey'] !== 'alive5-secret') {
      res
        .writeHead(401)
        .end(JSON.stringify({ error: { code: 'AUTH_FAILED', message: 'Bad key' } }));
      return;
    }
    if (req.url.startsWith('/public/1.0/objects/channels-and-users/list')) {
      res.end(
        JSON.stringify({
          code: 200,
          data: {
            Items: [
              { channel_id: 'channel-1', channel_label: LINE },
              { channel_id: 'channel-2', channel_label: OTHER },
            ],
          },
        }),
      );
    } else if (req.url.startsWith('/public/1.2/conversations/sms')) {
      const page = Number(new URL(req.url, client.relayUrl).searchParams.get('page'));
      const rows = state.onHistory
        ? await state.onHistory(page)
        : state.rows.slice((page - 1) * 50, page * 50);
      res.end(JSON.stringify({ code: 200, data: rows }));
    } else if (req.method === 'POST' && req.url === '/v1/subscriptions') {
      if (state.failAdd) {
        res
          .writeHead(409)
          .end(JSON.stringify({ error: { code: 'pending', message: 'Try again' } }));
        return;
      }
      const { phoneNumber } = JSON.parse(body);
      const subscription = client.subscriptions[phoneNumber] || subscriptionFor(phoneNumber);
      res.writeHead(201).end(
        JSON.stringify({
          id: subscription.subscriptionId,
          phoneNumber,
          deliveryToken: subscription.deliveryToken,
          websocketUrl: subscription.websocketUrl,
        }),
      );
    } else if (req.method === 'DELETE' && req.url.startsWith('/v1/subscriptions/')) {
      if (state.failDelete)
        res
          .writeHead(503)
          .end(JSON.stringify({ error: { code: 'cleanup_failed', message: 'Retry cleanup' } }));
      else res.end(JSON.stringify({ ok: true }));
    } else res.writeHead(404).end('{}');
  });
  const wss = new WebSocketServer({ noServer: true });
  server.on('upgrade', (req, socket, head) => {
    state.wsHeaders = req.headers;
    state.wsUrl = new URL(req.url, 'http://localhost');
    if (!state.auth) {
      socket.end('HTTP/1.1 401 Unauthorized\r\nContent-Length: 0\r\n\r\n');
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  });
  wss.on('connection', (ws, req) => {
    const id = new URL(req.url, 'http://localhost').searchParams.get('subscriptionId');
    const line = id === 'subscription-2' ? OTHER : LINE;
    state.connections++;
    state.sockets.push(ws);
    ws.on('message', (raw) => {
      const frame = JSON.parse(raw);
      state.sent.push(frame);
      if (frame.action === 'ping') {
        state.pings++;
        if (state.onPing?.(ws) === false) return;
        ws.send(JSON.stringify({ type: 'pong' }));
      }
    });
    ws.send(JSON.stringify({ type: 'ready' }));
    for (const e of state.frames.filter((e) => e.business_line === line))
      ws.send(JSON.stringify(e));
    state.onConnect?.(ws, line);
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const relayUrl = `http://127.0.0.1:${server.address().port}`;
  const subscriptionFor = (line) => ({
    subscriptionId: line === LINE ? 'subscription-1' : 'subscription-2',
    deliveryToken: 'delivery-secret',
    websocketUrl: relayUrl.replace('http:', 'ws:') + '/',
    channelId: line === LINE ? 'channel-1' : 'channel-2',
  });
  const client = {
    relayUrl,
    clientId: 'client-1',
    subscriptions: {
      [LINE]: subscriptionFor(LINE),
      ...(multiple && { [OTHER]: subscriptionFor(OTHER) }),
    },
  };
  await writeFile(join(dir, 'credentials.json'), JSON.stringify({ apiKey: 'alive5-secret' }));
  if (registered) await writeFile(join(dir, 'inbox.json'), JSON.stringify(client));
  // All official API reads in child processes go to this mock. No production I/O.
  const preload = join(dir, 'mock-api.mjs');
  await writeFile(
    preload,
    `
    const nativeFetch = globalThis.fetch;
    globalThis.fetch = (url, init) => {
      const u = new URL(url);
      if (u.hostname === 'api-v2.alive5.com') return nativeFetch(${JSON.stringify(relayUrl)} + u.pathname + u.search, init);
      if (u.origin !== ${JSON.stringify(relayUrl)}) throw new Error('Unexpected network host');
      return nativeFetch(url, init);
    };
    if (process.env.TEST_HEARTBEAT) {
      const interval = globalThis.setInterval, timeout = globalThis.setTimeout;
      globalThis.setInterval = (fn, ms, ...args) => interval(fn, ms === 300000 ? 50 : ms, ...args);
      globalThis.setTimeout = (fn, ms, ...args) => timeout(fn, ms === 60000 ? 150 : ms, ...args);
    }
  `,
  );
  const children = [];
  function run(args, env = {}, { paused = false, closed = false, heartbeat = false } = {}) {
    const child = spawn(
      process.execPath,
      ['--import', pathToFileURL(preload).href, 'bin/alive5.js', ...args],
      {
        cwd: new URL('..', import.meta.url),
        env: {
          ...process.env,
          ALIVE5_CONFIG_DIR: dir,
          ALIVE5_RELAY_URL: relayUrl,
          ALIVE5_API_KEY: '',
          TEST_HEARTBEAT: heartbeat ? '1' : '',
          ...env,
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    children.push(child);
    const result = { child, stdout: '', stderr: '' };
    child.stdout.on('data', (data) => {
      result.stdout += data;
    });
    if (paused) child.stdout.pause();
    if (closed) child.stdout.destroy();
    child.stderr.on('data', (data) => {
      result.stderr += data;
    });
    result.exited = new Promise((resolve) =>
      child.once('exit', (code, signal) => resolve({ code, signal })),
    );
    result.done = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        reject(new Error('CLI did not exit'));
      }, 10000);
      child.on('error', reject);
      child.on('close', (code, signal) => {
        clearTimeout(timer);
        result.code = code;
        result.signal = signal;
        resolve(result);
      });
    });
    return result;
  }
  const history = (line, channel, since, options) =>
    inboxHistory(line, channel, since, {
      ...options,
      apiKey: 'alive5-secret',
      fetchFn: (url, init) => {
        const u = new URL(url);
        return fetch(relayUrl + u.pathname + u.search, init);
      },
    });
  const receiveMock = (options) =>
    receive(client, {
      history,
      backoffMs: 20,
      checkpoint: async (...args) => {
        state.checkpoints.push(args);
      },
      ...options,
    });
  const saved = async () => JSON.parse(await readFile(join(dir, 'inbox.json'), 'utf8'));
  t.after(async () => {
    for (const child of children) {
      child.stdout.resume();
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    }
    for (const ws of wss.clients) ws.terminate();
    await new Promise((resolve) => wss.close(resolve));
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    await rm(dir, { recursive: true, force: true });
  });
  return { dir, client, state, requests, run, history, receive: receiveMock, saved };
}

test('channels use shared subscriptions, stable identity, private storage and local listing', async (t) => {
  const f = await fixture(t, { registered: false });
  for (const line of [LINE, LINE, OTHER]) {
    const r = await f.run(['inbox', 'channels', 'add', line]).done;
    assert.equal(r.code, 0, r.stderr + r.stdout);
    assert.equal(JSON.parse(r.stdout).data.line, line);
    assert.doesNotMatch(r.stdout, /secret|websocketUrl/);
  }
  const saved = await f.saved();
  assert.ok(saved.clientId);
  assert.deepEqual(saved.subscriptions, {
    ...f.client.subscriptions,
    [OTHER]: {
      ...f.client.subscriptions[LINE],
      subscriptionId: 'subscription-2',
      channelId: 'channel-2',
    },
  });
  if (process.platform !== 'win32')
    assert.equal((await stat(join(f.dir, 'inbox.json'))).mode & 0o777, 0o600);
  const posts = f.requests.filter((r) => r.method === 'POST');
  assert.equal(posts.length, 3);
  for (const r of posts) {
    assert.equal(r.url, '/v1/subscriptions');
    assert.deepEqual(JSON.parse(r.body).target, { type: 'websocket', clientId: saved.clientId });
    assert.equal(r.headers['x-a5-apikey'], 'alive5-secret');
    assert.equal(r.headers.authorization, undefined);
  }
  const count = f.requests.length;
  const list = await f.run(['inbox', 'channels', 'list'], {
    ALIVE5_RELAY_URL: '',
    ALIVE5_API_KEY: '',
  }).done;
  assert.equal(JSON.parse(list.stdout).data.length, 2);
  assert.equal(f.requests.length, count);
  for (let i = 0; i < 2; i++)
    assert.equal((await f.run(['inbox', 'channels', 'remove', LINE]).done).code, 0);
  assert.equal(f.requests.filter((r) => r.method === 'DELETE').length, 1);
  assert.equal(f.requests.at(-1).url, '/v1/subscriptions/subscription-1');
  assert.deepEqual(Object.keys((await f.saved()).subscriptions), [OTHER]);
});

test('failed add preserves client identity; failed delete preserves subscription for retry', async (t) => {
  const f = await fixture(t, { registered: false });
  f.state.failAdd = true;
  const failed = await f.run(['inbox', 'channels', 'add', LINE]).done;
  assert.equal(failed.code, 4);
  const id = (await f.saved()).clientId;
  f.state.failAdd = false;
  assert.equal((await f.run(['inbox', 'channels', 'add', LINE]).done).code, 0);
  assert.equal((await f.saved()).clientId, id);
  f.state.failDelete = true;
  const removed = await f.run(['inbox', 'channels', 'remove', LINE]).done;
  assert.equal(removed.code, 4);
  assert.equal(JSON.parse(removed.stdout).error.code, 'cleanup_failed');
  assert.ok((await f.saved()).subscriptions[LINE]);
});

test('legacy registration is replaced on add without calling the discarded API', async (t) => {
  const f = await fixture(t);
  await writeFile(
    join(f.dir, 'inbox.json'),
    JSON.stringify({
      relayUrl: f.client.relayUrl,
      clientId: 'old-client',
      token: 'old-secret',
      wsUrl: 'wss://discarded.example/',
    }),
  );
  const r = await f.run(['inbox', 'channels', 'add', LINE]).done;
  assert.equal(r.code, 0, r.stderr);
  assert.equal((await f.saved()).token, undefined);
  assert.equal((await f.saved()).clientId, 'old-client');
  assert.ok(f.requests.every((r) => !r.url.includes('/v1/cli/')));
});

test('setup, line authorization and switched relay errors retain exit codes', async (t) => {
  const f = await fixture(t, { registered: false });
  const unset = await f.run(['inbox', 'wait'], { ALIVE5_RELAY_URL: '' }).done;
  assert.equal(unset.code, 2);
  assert.equal(unset.stdout, '');
  assert.match(JSON.parse(unset.stderr).error.message, /Set ALIVE5_RELAY_URL=/);
  const invalid = await f.run(['inbox', 'channels', 'add', '+15555550999']).done;
  assert.equal(invalid.code, 3);
  assert.equal(JSON.parse(invalid.stdout).error.code, 'line_not_in_account');
  const switched = await f.run(['inbox', 'wait'], { ALIVE5_RELAY_URL: 'https://other.example' })
    .done;
  assert.equal(switched.code, 3);
  assert.equal(JSON.parse(switched.stderr).error.code, 'not_registered');
});

test('wait emits one normalized nullable event and authenticates the socket by query', async (t) => {
  const f = await fixture(t, { multiple: true });
  f.state.frames = [event('other', OTHER), event('first'), event('second')];
  const r = await f.run(['inbox', 'wait', '--line', LINE, '--json', '--timeout', '2']).done;
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.stderr, '');
  assert.deepEqual(JSON.parse(r.stdout).data, outputEvent(event('first')));
  assert.equal(f.state.connections, 1);
  assert.equal(f.state.wsUrl.searchParams.get('subscriptionId'), 'subscription-1');
  assert.equal(f.state.wsUrl.searchParams.get('deliveryToken'), 'delivery-secret');
  assert.equal(f.state.wsHeaders.authorization, undefined);
  assert.equal(f.state.wsHeaders['x-a5-apikey'], undefined);
  assert.deepEqual(f.state.sent, []);
  assert.equal(
    (await f.saved()).subscriptions[LINE].checkpoint.receivedAt,
    event('first').received_at,
  );
  // Repeated history/live overlap is skipped using the persisted successful output checkpoint.
  const next = await f.run(['inbox', 'wait', '--line', LINE, '--timeout', '2']).done;
  assert.equal(next.code, 0, next.stderr);
  assert.equal(JSON.parse(next.stdout).data.id, 'second');
});

test('wait timeout interrupts both idle sockets and reconnect backoff', async (t) => {
  const f = await fixture(t);
  let r = await f.run(['inbox', 'wait', '--timeout', '1']).done;
  assert.equal(r.code, 124);
  assert.equal(r.stdout, '');
  assert.equal(JSON.parse(r.stderr).error.code, 'WAIT_TIMEOUT');
  f.state.onConnect = (ws) => ws.terminate();
  r = await f.run(['inbox', 'wait', '--timeout', '1']).done;
  assert.equal(r.code, 124);
  assert.match(r.stderr, /reconnecting/);
});

test('history scans beyond fifty rows and filters channel, sender and time locally', async (t) => {
  const f = await fixture(t);
  const old = AT - 10000;
  f.state.rows = [
    ...Array.from({ length: 50 }, (_, i) => row(event(`out-${i}`, OTHER, AT + i))),
    row(event('wanted', LINE, AT)),
    { ...row(event('agent')), created_by: 'Jane' },
    { ...row(event('self')), created_by: '1 (555) 555-0100' },
    row(event('stale', LINE, old)),
    { ...row(event('phone-format')), created_by: '1 (555) 555-0101' },
  ];
  const result = await f.history(LINE, 'channel-1', AT - 1, {});
  assert.deepEqual(
    result.map((e) => e.text),
    [event('wanted').message, event('phone-format').message],
  );
  assert.equal(result[0].threadId, null);
  assert.equal(result[0].id, null);
  assert.deepEqual(
    f.requests.map((r) => new URL(r.url, f.client.relayUrl).searchParams.get('page')),
    ['1', '2'],
  );
  assert.ok(
    f.requests.every((r) => new URL(r.url, f.client.relayUrl).searchParams.get('limit') === '50'),
  );
});

test('socket opens first, holds live frames during scan and merges overlap in time order', async (t) => {
  const f = await fixture(t);
  let release;
  f.state.onHistory = async () => {
    assert.equal(f.state.connections, 1);
    await new Promise((resolve) => {
      release = resolve;
    });
    return [row(event('duplicate')), row(event('older', LINE, AT - 1000))];
  };
  const seen = [];
  const controller = new AbortController();
  const done = f.receive({
    signal: controller.signal,
    write: async (e) => {
      seen.push(e);
    },
  });
  const stopped = assert.rejects(done, /stop/);
  await until(() => release);
  f.state.sockets[0].send(JSON.stringify(event('duplicate')));
  f.state.sockets[0].send(JSON.stringify(event('newer', LINE, AT + 1000)));
  await delay(30);
  assert.deepEqual(seen, []);
  release();
  await until(() => seen.length === 3 && f.state.checkpoints.length === 3);
  assert.deepEqual(
    seen.map((e) => e.text),
    [event('older').message, event('duplicate').message, event('newer').message],
  );
  await delay(50);
  assert.equal(f.requests.length, 1, 'there is no history polling while connected');
  controller.abort(new Error('stop'));
  await stopped;
});

test('reconnect backfills a missed text, merges a live duplicate and preserves NDJSON', async (t) => {
  const f = await fixture(t);
  f.state.frames = [event('first')];
  const r = f.run(['inbox', 'listen', '--output', 'text']);
  await until(async () => (await f.saved()).subscriptions[LINE].checkpoint);
  f.state.rows = [row(event('first')), row(event('missed', LINE, AT + 1000))];
  f.state.frames = [event('missed', LINE, AT + 1000), event('live', LINE, AT + 2000)];
  f.state.sockets[0].close();
  await until(() => r.stdout.trim().split('\n').length === 3);
  f.state.sockets.at(-1).send('{bad json');
  await r.done;
  assert.equal(r.code, 4);
  const rows = r.stdout.trim().split('\n').map(JSON.parse);
  assert.deepEqual(
    rows.map((r) => r.data.text),
    ['first', 'missed', 'live'].map((id) => event(id).message),
  );
  assert.ok(rows.every((r) => r.ok && r.meta.schemaVersion === 1));
  assert.match(r.stderr, /reconnecting/);
  assert.equal(f.state.connections, 2);
  assert.equal(f.requests.length, 2);
  assert.deepEqual(f.state.sent, []);
});

test('all subscribed lines use sockets and serialize wait to exactly one successful write', async (t) => {
  const f = await fixture(t, { multiple: true });
  f.state.frames = [event('one'), event('two', OTHER)];
  const r = await f.run(['inbox', 'wait', '--timeout', '2']).done;
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.stdout.trim().split('\n').length, 1);
  assert.equal(f.state.connections, 2);
  assert.equal(f.state.sockets.filter((s) => s.readyState !== 3).length, 0);
  const checkpoints = Object.values((await f.saved()).subscriptions).filter((s) => s.checkpoint);
  assert.equal(checkpoints.length, 1);
});

test('incomplete or failed history is reported without output or checkpoint advancement', async (t) => {
  const f = await fixture(t);
  f.state.rows = Array.from({ length: 50 }, (_, i) => row(event(`repeat-${i}`)));
  f.state.onHistory = () => f.state.rows;
  f.state.frames = [event('live')];
  const r = await f.run(['inbox', 'wait']).done;
  assert.equal(r.code, 4, r.stderr);
  assert.equal(JSON.parse(r.stderr).error.code, 'BACKFILL_INCOMPLETE');
  assert.equal(r.stdout, '');
  assert.equal((await f.saved()).subscriptions[LINE].checkpoint, undefined);
  assert.equal(f.requests.length, 2);
  await assert.rejects(
    f.receive({
      history: async () => {
        throw new Error('history unavailable');
      },
    }),
    /history unavailable/,
  );
});

test('history scan guard reports incomplete scans rather than silently truncating', async (t) => {
  const f = await fixture(t);
  f.state.onHistory = (page) => Array.from({ length: 50 }, (_, i) => row(event(`${page}-${i}`)));
  await assert.rejects(f.history(LINE, 'channel-1', AT - 1, {}), { code: 'BACKFILL_INCOMPLETE' });
  assert.equal(f.requests.length, 100);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  test(
    `${signal} closes idle sockets and cancels an in-progress history scan`,
    { skip: process.platform === 'win32' },
    async (t) => {
      const f = await fixture(t);
      let release;
      f.state.onHistory = () =>
        new Promise((resolve) => {
          release = resolve;
        });
      const r = f.run(['inbox', signal === 'SIGINT' ? 'listen' : 'wait']);
      await until(() => release);
      r.child.kill(signal);
      await r.done;
      release([]);
      assert.equal(r.code, 130, r.stderr);
      assert.equal(r.stdout, '');
      assert.equal(f.state.sockets[0].readyState, 3);
    },
  );
}

test('socket authentication failures stop with setup instructions on stderr', async (t) => {
  const f = await fixture(t);
  f.state.auth = false;
  const r = await f.run(['inbox', 'wait', '--timeout', '2']).done;
  assert.equal(r.code, 3, r.stderr);
  assert.equal(r.stdout, '');
  assert.equal(JSON.parse(r.stderr).error.code, 'not_registered');
  assert.match(r.stderr, /alive5 inbox channels add/);
  assert.doesNotMatch(r.stderr, /delivery-secret/);
});

test('checkpoint follows stdout callback; failed stdout and failed config save stop receiving', async (t) => {
  const f = await fixture(t);
  f.state.frames = [event('slow')];
  let flush,
    output = '';
  const stdout = new Writable({
    highWaterMark: 1,
    write(chunk, encoding, callback) {
      output += chunk;
      flush = callback;
    },
  });
  const done = f.receive({ once: true, write: (e) => writeText(e, { stdout }) });
  await until(() => flush);
  await delay(30);
  assert.deepEqual(f.state.checkpoints, []);
  assert.equal(JSON.parse(output).data.id, 'slow');
  flush();
  await done;
  assert.equal(f.state.checkpoints.length, 1);
  f.state.frames = [event('failed')];
  const broken = new Writable({
    write(chunk, encoding, callback) {
      callback(new Error('broken pipe'));
    },
  });
  broken.on('error', () => {});
  await assert.rejects(f.receive({ once: true, write: (e) => writeText(e, { stdout: broken }) }), {
    code: 'OUTPUT_ERROR',
  });
  assert.equal(f.state.checkpoints.length, 1);
  await assert.rejects(
    f.receive({
      once: true,
      write: async () => {},
      checkpoint: async () => {
        throw new Error('disk full');
      },
    }),
    { code: 'CONFIG_ERROR' },
  );
});

test('closed stdout fails wait without advancing checkpoint; other commands keep their pipe behavior', async (t) => {
  const f = await fixture(t);
  f.state.frames = [event('closed')];
  const r = await f.run(['inbox', 'wait'], {}, { closed: true }).done;
  assert.equal(r.code, 1);
  assert.equal(r.stdout, '');
  assert.equal(JSON.parse(r.stderr).error.code, 'OUTPUT_ERROR');
  assert.equal((await f.saved()).subscriptions[LINE].checkpoint, undefined);
  const other = await f.run(['schema'], {}, { closed: true }).done;
  assert.equal(other.code, 0);
  assert.equal(other.stderr, '');
});

async function blockedOutput(f) {
  await until(async () => (await f.saved()).subscriptions[LINE].checkpoint);
  let before;
  do {
    before = JSON.stringify((await f.saved()).subscriptions[LINE].checkpoint);
    await delay(100);
  } while (before !== JSON.stringify((await f.saved()).subscriptions[LINE].checkpoint));
  assert.notEqual(
    (await f.saved()).subscriptions[LINE].checkpoint.receivedAt,
    event('last', LINE, AT + 2047 * 10).received_at,
  );
  return before;
}
const flood = () =>
  Array.from({ length: 2048 }, (_, i) => ({
    ...event(`flood-${i}`, LINE, AT + i * 10),
    message: `${i} ${'x'.repeat(1600)}`,
  }));

test(
  'SIGINT exits with stdout blocked and leaves its unfinished checkpoint unchanged',
  { skip: process.platform === 'win32' },
  async (t) => {
    const f = await fixture(t);
    f.state.frames = flood();
    const r = f.run(['inbox', 'listen'], {}, { paused: true });
    const before = await blockedOutput(f);
    r.child.kill('SIGINT');
    await until(() => r.child.exitCode !== null, 2000);
    assert.deepEqual(await r.exited, { code: 130, signal: null });
    assert.equal(JSON.parse(r.stderr).error.code, 'CANCELLED');
    assert.equal(JSON.stringify((await f.saved()).subscriptions[LINE].checkpoint), before);
    assert.equal(f.state.sockets[0].readyState, 3);
    r.child.stdout.resume();
    await r.done;
  },
);

for (const command of ['wait', 'listen']) {
  test(`${command} reconnects when TCP stays open but pongs stop`, async (t) => {
    const f = await fixture(t);
    f.state.onConnect = (ws) => {
      if (f.state.connections === 2) ws.send(JSON.stringify(event('recovered')));
    };
    const r = f.run(['inbox', command], {}, { heartbeat: true });
    await until(() => f.state.pings >= 8);
    assert.equal(f.state.connections, 1);
    f.state.onPing = () => false;
    await until(() => r.stdout.includes('recovered'), 4000);
    if (command === 'listen') f.state.sockets.at(-1).send('{stop');
    await r.done;
    assert.equal(r.code, command === 'wait' ? 0 : 4, r.stderr);
    assert.equal(JSON.parse(r.stdout).data.id, 'recovered');
    assert.match(r.stderr, /reconnecting/);
    assert.equal(f.state.sockets[0].readyState, 3);
    assert.ok(f.state.sent.every((s) => s.action === 'ping'));
  });
}

test('pong deadline pauses for stdout backpressure and resumes after draining', async (t) => {
  const f = await fixture(t);
  let flooded = false;
  f.state.onPing = (ws) => {
    if (!flooded) {
      flooded = true;
      for (const e of flood()) ws.send(JSON.stringify(e));
    }
    return false;
  };
  f.state.onConnect = (ws) => {
    if (f.state.connections === 2) ws.send('{stop');
  };
  const r = f.run(['inbox', 'listen'], {}, { paused: true, heartbeat: true });
  await blockedOutput(f);
  await delay(500);
  assert.equal(f.state.connections, 1);
  assert.equal(f.state.sockets[0].readyState, 1);
  r.child.stdout.resume();
  await until(() => r.stdout.trim().split('\n').length === 2048);
  await r.done;
  assert.equal(r.code, 4, r.stderr);
  assert.equal(f.state.connections, 2);
});

test('proactive socket renewal reconnects and backfills without waiting for server closure', async (t) => {
  const f = await fixture(t);
  const controller = new AbortController();
  const done = f.receive({ renewMs: 50, signal: controller.signal, pingMs: 10, warn: () => {} });
  const stopped = assert.rejects(done, /stop/);
  await until(() => f.state.connections >= 2 && f.requests.length >= 2);
  controller.abort(new Error('stop'));

  await stopped;
  assert.ok(f.requests.length >= 2);
  assert.ok(f.state.sent.length);
  assert.ok(f.state.sent.every((s) => s.action === 'ping'));
});

test('dedupe uses phone, text and a small time window, plus exact relay event IDs', async (t) => {
  const f = await fixture(t);
  const original = event('same');
  f.state.frames = [
    original,
    original,
    { ...original, event_id: 'replayed' },
    { ...original, event_id: 'later', received_at: new Date(AT + 6000).toISOString() },
    { ...original, event_id: 'other-sender', from_phone: '+15555550102' },
  ];
  const seen = [];
  const controller = new AbortController();
  const done = f.receive({
    signal: controller.signal,
    write: async (e) => {
      seen.push(e);
    },
  });
  const stopped = assert.rejects(done, /stop/);
  await until(() => f.state.checkpoints.length === 3);
  controller.abort(new Error('stop'));
  await stopped;
  assert.equal(seen.length, 3);
  assert.ok(f.state.checkpoints.at(-1)[2].seen.every((s) => !s.key.includes('Hello')));
});

test('human output is safe and notification content is passed as data', async () => {
  let output = '';
  const stdout = new Writable({
    write(chunk, encoding, callback) {
      output += chunk;
      callback();
    },
  });
  await writeText(outputEvent(event('human')), { stdout, json: false });
  assert.equal(output.trim().split('\n').length, 1);
  assert.doesNotMatch(output, /\u001b/);
  const calls = [];
  const notify = notifier({
    platform: 'darwin',
    run: (...args) => {
      calls.push(args);
      args[3](null);
    },
  });
  const attack = '" & do shell script "touch /tmp/should-not-exist" & "\\\n$(id)\n--help';
  notify({ from: attack, text: attack });
  assert.equal(calls[0][0], '/usr/bin/osascript');
  assert.deepEqual(calls[0][1].slice(2), ['--', attack, attack]);
  assert.equal(calls[0][1][1].includes(attack), false);
  assert.equal(calls[0][2].shell, undefined);
  const warnings = [];
  const other = notifier({ platform: 'linux', warn: (s) => warnings.push(s) });
  other({});
  other({});
  assert.equal(warnings.length, 1);
});

test('schema discovers inbox streaming rules and timeout exit code; invalid options stay on stderr', async (t) => {
  const f = await fixture(t);
  const r = await f.run(['schema', 'inbox', 'wait']).done;
  const data = JSON.parse(r.stdout).data;
  assert.equal(data.commands.name, 'wait');
  assert.equal(data.exitCodes['124'], 'inbox wait timed out');
  assert.ok(data.commands.options.some((o) => o.flag === '--timeout <seconds>'));
  assert.ok(data.notes.some((n) => n.includes('NDJSON')));
  for (const args of [
    ['--timeout', '0'],
    ['--timeout'],
    ['--line', 'bad'],
    ['--fields', 'text'],
    ['--bad'],
  ]) {
    const invalid = await f.run(['inbox', 'wait', ...args]).done;
    assert.equal(invalid.code, 2);
    assert.equal(invalid.stdout, '');
    assert.equal(JSON.parse(invalid.stderr).ok, false);
  }
});
