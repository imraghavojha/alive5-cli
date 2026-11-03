import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, writeFile, stat, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Writable } from 'node:stream';
import { setTimeout as delay } from 'node:timers/promises';
import { WebSocketServer } from 'ws';
import { receive, writeText } from '../src/inbox.js';
import { notifier } from '../src/notify.js';

const LINE = '+15555550100';
const OTHER = '+15555550200';
const event = (id, line = LINE) => ({
  type: 'message',
  id,
  line,
  channelId: 'channel-1',
  from: '+15555550101',
  text: 'Hello\n"there"\u001b[2J',
  threadId: 'thread-1',
  receivedAt: '2026-11-03T20:00:00.000Z',
});

async function until(predicate, timeout = 5000) {
  const end = Date.now() + timeout;
  while (!predicate()) {
    if (Date.now() > end) throw new Error('Timed out waiting for test condition');
    await delay(10);
  }
}

async function fixture(t, { registered = true } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'alive5-inbox-'));
  const requests = [];
  const lines = new Map();
  const state = { pending: [], acks: [], pings: 0, connections: 0, sockets: [], auth: true };
  const server = createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    requests.push({ method: req.method, url: req.url, headers: req.headers, body });
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/v1/cli/register') {
      res
        .writeHead(201)
        .end(JSON.stringify({ clientId: 'client-1', token: 'client-secret', wsUrl: client.wsUrl }));
    } else if (req.headers.authorization !== 'Bearer client-secret') {
      res
        .writeHead(401)
        .end(JSON.stringify({ error: { code: 'not_registered', message: 'Invalid token' } }));
    } else if (req.method === 'POST' && req.url === '/v1/cli/lines') {
      const { line } = JSON.parse(body);
      if (line === '+15555550999') {
        res.writeHead(403).end(
          JSON.stringify({
            error: { code: 'line_not_in_account', message: 'Line not in account' },
          }),
        );
        return;
      }
      const record = {
        line,
        channelId: 'channel-1',
        name: 'Support',
        subscribedAt: '2026-11-03T20:00:00.000Z',
      };
      res.statusCode = lines.has(line) ? 200 : 201;
      lines.set(line, record);
      res.end(JSON.stringify(record));
    } else if (req.method === 'GET') {
      res.end(JSON.stringify({ lines: [...lines.values()] }));
    } else {
      lines.delete(decodeURIComponent(req.url.split('/').at(-1)));
      res.writeHead(204).end();
    }
  });
  const wss = new WebSocketServer({ noServer: true });
  server.on('upgrade', (req, socket, head) => {
    state.wsHeaders = req.headers;
    if (!state.auth) {
      socket.end('HTTP/1.1 401 Unauthorized\r\nContent-Length: 0\r\n\r\n');
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  });
  wss.on('connection', (ws) => {
    state.connections++;
    state.sockets.push(ws);
    ws.on('message', (raw) => {
      const frame = JSON.parse(raw);
      if (frame.action === 'ack') {
        state.acks.push(frame.id);
        if (state.onAck?.(frame, ws) === false) return;
        state.pending = state.pending.filter((e) => e.id !== frame.id);
      } else if (frame.action === 'ping') {
        state.pings++;
        ws.send(JSON.stringify({ type: 'pong' }));
      }
    });
    ws.send(JSON.stringify({ type: 'ready', pending: state.pending.length }));
    for (const e of state.pending) ws.send(JSON.stringify(e));
    state.onConnect?.(ws);
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const relayUrl = `http://127.0.0.1:${server.address().port}`;
  const client = {
    relayUrl,
    clientId: 'client-1',
    token: 'client-secret',
    wsUrl: relayUrl.replace('http:', 'ws:') + '/',
  };
  await writeFile(join(dir, 'credentials.json'), JSON.stringify({ apiKey: 'alive5-secret' }));
  if (registered) await writeFile(join(dir, 'inbox.json'), JSON.stringify(client));
  const children = [];
  function run(args, env = {}) {
    const child = spawn(process.execPath, ['bin/alive5.js', ...args], {
      cwd: new URL('..', import.meta.url),
      env: {
        ...process.env,
        ALIVE5_CONFIG_DIR: dir,
        ALIVE5_RELAY_URL: relayUrl,
        ALIVE5_API_KEY: '',
        ...env,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    children.push(child);
    const result = { child, stdout: '', stderr: '' };
    child.stdout.on('data', (data) => {
      result.stdout += data;
    });
    child.stderr.on('data', (data) => {
      result.stderr += data;
    });
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
  t.after(async () => {
    for (const child of children)
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    for (const ws of wss.clients) ws.terminate();
    await new Promise((resolve) => wss.close(resolve));
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    await rm(dir, { recursive: true, force: true });
  });
  return { dir, client, state, requests, run };
}

test('channels add registers once, stores private credentials, lists and removes lines', async (t) => {
  const f = await fixture(t, { registered: false });
  for (const line of [LINE, LINE, OTHER]) {
    const r = await f.run(['inbox', 'channels', 'add', line]).done;
    assert.equal(r.code, 0, r.stderr + r.stdout);
    assert.equal(JSON.parse(r.stdout).data.line, line);
    assert.equal(r.stderr, '');
    assert.doesNotMatch(r.stdout, /secret/);
  }
  assert.deepEqual(JSON.parse(await readFile(join(f.dir, 'inbox.json'), 'utf8')), f.client);
  if (process.platform !== 'win32')
    assert.equal((await stat(join(f.dir, 'inbox.json'))).mode & 0o777, 0o600);
  assert.equal(f.requests.filter((r) => r.url.endsWith('/register')).length, 1);
  const list = await f.run(['inbox', 'channels', 'list'], {
    ALIVE5_API_KEY: '',
    ALIVE5_RELAY_URL: '',
  }).done;
  assert.equal(JSON.parse(list.stdout).data.length, 2);
  for (let i = 0; i < 2; i++) {
    const removed = await f.run(['inbox', 'channels', 'remove', LINE]).done;
    assert.equal(removed.code, 0);
  }
  const remaining = await f.run(['inbox', 'channels', 'list']).done;
  assert.deepEqual(
    JSON.parse(remaining.stdout).data.map((x) => x.line),
    [OTHER],
  );
  assert.equal(f.requests[0].headers['x-alive5-api-key'], 'alive5-secret');
  assert.equal(f.requests[0].headers.authorization, undefined);
  assert.equal(f.requests[0].body, '{}');
  for (const r of f.requests.slice(1)) {
    assert.equal(r.headers.authorization, 'Bearer client-secret');
    assert.equal(r.headers['x-alive5-api-key'], r.method === 'GET' ? undefined : 'alive5-secret');
  }
  assert.ok(f.requests.some((r) => r.url.endsWith('/%2B15555550100')));
});

test('relay errors retain their code and missing configuration gives exact setup instructions', async (t) => {
  const f = await fixture(t, { registered: false });
  const unset = await f.run(['inbox', 'wait'], { ALIVE5_RELAY_URL: '' }).done;
  assert.equal(unset.stdout, '');
  assert.equal(unset.code, 2);
  assert.match(
    JSON.parse(unset.stderr).error.message,
    /Set ALIVE5_RELAY_URL=https:\/\/<deployed-relay-host>, or set relayUrl in inbox.json/,
  );
  const invalid = await f.run(['inbox', 'channels', 'add', '+15555550999']).done;
  assert.equal(invalid.code, 3);
  assert.equal(JSON.parse(invalid.stdout).error.code, 'line_not_in_account');
  const switched = await f.run(['inbox', 'wait'], { ALIVE5_RELAY_URL: 'https://other.example' })
    .done;
  assert.equal(switched.code, 3);
  assert.equal(JSON.parse(switched.stderr).error.code, 'not_registered');
});

test('wait prints and acks exactly one buffered text; the next wait receives the next text', async (t) => {
  const f = await fixture(t);
  f.state.pending = [event('evt_1', OTHER), event('evt_2'), event('evt_3')];
  const r = await f.run(['inbox', 'wait', '--line', LINE, '--json', '--timeout', '2']).done;
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.stderr, '');
  assert.deepEqual(JSON.parse(r.stdout).data, event('evt_2'));
  assert.deepEqual(f.state.acks, ['evt_2']);
  assert.deepEqual(
    f.state.pending.map((e) => e.id),
    ['evt_1', 'evt_3'],
  );
  const next = await f.run(['inbox', 'wait', '--timeout', '2']).done;
  assert.equal(next.code, 0);
  assert.equal(JSON.parse(next.stdout).data.id, 'evt_1');
  assert.deepEqual(f.state.acks, ['evt_2', 'evt_1']);
  assert.equal(f.state.wsHeaders.authorization, 'Bearer client-secret');
  assert.equal(f.state.wsHeaders['x-alive5-api-key'], undefined);
  assert.equal(f.requests.length, 0);
});

test('wait timeout exits 124 without stdout or acks, including a filtered buffered text', async (t) => {
  const f = await fixture(t);
  f.state.pending = [event('evt_other', OTHER)];
  const r = await f.run(['inbox', 'wait', '--line', LINE, '--timeout', '1']).done;
  assert.equal(r.code, 124);
  assert.equal(r.stdout, '');
  assert.equal(JSON.parse(r.stderr).error.code, 'WAIT_TIMEOUT');
  assert.deepEqual(f.state.acks, []);
  assert.equal(f.state.pending.length, 1);
});

test('listen emits NDJSON and replays an unacked text on reconnect', async (t) => {
  const f = await fixture(t);
  f.state.pending = [event('evt_replay')];
  f.state.onAck = (frame, ws) => {
    if (f.state.acks.length === 1) {
      ws.close();
      return false;
    }
  };
  const r = f.run(['inbox', 'listen', '--output', 'text']);
  await until(() => f.state.acks.length === 2);
  f.state.sockets.at(-1).send('{bad json');
  await r.done;
  assert.equal(r.code, 4);
  assert.equal(r.signal, null);
  const rows = r.stdout.trim().split('\n').map(JSON.parse);
  assert.equal(rows.length, 2);
  for (const row of rows) {
    assert.equal(row.ok, true);
    assert.equal(row.meta.schemaVersion, 1);
    assert.deepEqual(row.data, event('evt_replay'));
  }
  assert.match(r.stderr, /reconnecting/);
  assert.doesNotMatch(r.stdout, /\u001b/);
  assert.deepEqual(f.state.pending, []);
  assert.equal(f.state.connections, 2);
  assert.equal(f.requests.length, 0);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  test(
    `${signal} closes an idle inbox without acknowledging anything`,
    { skip: process.platform === 'win32' },
    async (t) => {
      const f = await fixture(t);
      const r = f.run(['inbox', signal === 'SIGINT' ? 'listen' : 'wait']);
      await until(() => f.state.connections === 1);
      r.child.kill(signal);
      await r.done;
      assert.equal(r.code, 130);
      assert.equal(r.signal, null);
      assert.equal(r.stdout, '');
      assert.deepEqual(f.state.acks, []);
    },
  );
}

test('channels add replaces an expired registration after a definite auth rejection', async (t) => {
  const f = await fixture(t);
  await writeFile(join(f.dir, 'inbox.json'), JSON.stringify({ ...f.client, token: 'expired' }));
  const r = await f.run(['inbox', 'channels', 'add', LINE]).done;
  assert.equal(r.code, 0, r.stderr + r.stdout);
  assert.deepEqual(
    f.requests.map((r) => r.url),
    ['/v1/cli/lines', '/v1/cli/register', '/v1/cli/lines'],
  );
  assert.deepEqual(JSON.parse(await readFile(join(f.dir, 'inbox.json'), 'utf8')), f.client);
});

test('wait timeout also interrupts reconnect backoff', async (t) => {
  const f = await fixture(t);
  f.state.onConnect = (ws) => ws.terminate();
  const r = await f.run(['inbox', 'wait', '--timeout', '1']).done;
  assert.equal(r.code, 124);
  assert.equal(r.stdout, '');
  assert.match(r.stderr, /WAIT_TIMEOUT/);
  assert.match(r.stderr, /reconnecting/);
  assert.deepEqual(f.state.acks, []);
});

test('WebSocket authentication failures stop with not_registered on stderr', async (t) => {
  const f = await fixture(t);
  f.state.auth = false;
  const r = await f.run(['inbox', 'wait', '--timeout', '2']).done;
  assert.equal(r.code, 3, r.stderr);
  assert.equal(r.stdout, '');
  assert.equal(JSON.parse(r.stderr).error.code, 'not_registered');
  assert.match(r.stderr, /alive5 inbox channels add/);
});

test('acks follow the stdout write callback and a failed write stays buffered', async (t) => {
  const f = await fixture(t);
  f.state.pending = [event('evt_slow')];
  let flush;
  let output = '';
  const stdout = new Writable({
    highWaterMark: 1,
    write(chunk, encoding, callback) {
      output += chunk;
      flush = callback;
    },
  });
  const done = receive(f.client, { once: true, write: (e) => writeText(e, { stdout }) });
  await until(() => flush);
  await delay(30);
  assert.deepEqual(f.state.acks, []);
  assert.equal(JSON.parse(output).data.id, 'evt_slow');
  flush();
  await done;
  assert.deepEqual(f.state.acks, ['evt_slow']);
  f.state.pending = [event('evt_failed')];
  const broken = new Writable({
    write(chunk, encoding, callback) {
      callback(new Error('broken pipe'));
    },
  });
  broken.on('error', () => {});
  await assert.rejects(
    receive(f.client, { once: true, write: (e) => writeText(e, { stdout: broken }) }),
    { code: 'OUTPUT_ERROR' },
  );
  assert.deepEqual(f.state.acks, ['evt_slow']);
  assert.equal(f.state.pending[0].id, 'evt_failed');
});

test('keepalive uses contract ping frames and cancellation cleans up', async (t) => {
  const f = await fixture(t);
  const controller = new AbortController();
  const done = receive(f.client, { pingMs: 20, signal: controller.signal });
  const stopped = assert.rejects(done, /test stopped/);
  await until(() => f.state.pings >= 2);
  controller.abort(new Error('test stopped'));
  await stopped;
  assert.equal(f.state.connections, 1);
});

test('human output is one safe line, and notification content is passed as data, never source', async () => {
  let output = '';
  const stdout = new Writable({
    write(chunk, encoding, callback) {
      output += chunk;
      callback();
    },
  });
  await writeText(event('evt_human'), { stdout, json: false });
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
  other(event('a'));
  other(event('b'));
  assert.equal(warnings.length, 1);
});

test('schema discovers nested inbox commands, streaming rules, and timeout exit code', async (t) => {
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
