import { readFileSync } from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setImmediate as settle } from 'node:timers/promises';
import { PassThrough, Writable } from 'node:stream';
import { setTimeout as sleep } from 'node:timers/promises';
import { spawn } from 'node-pty';
import headless from '@xterm/headless';
import { preparePty } from '../scripts/pty-helper.mjs';
import { Workspace } from '../src/tui/workspace.js';
import { navigation } from '../src/tui/layout.js';
import { mascots } from '../src/tui/mascot.js';
import { themes } from '../src/tui/screen.js';
import { describeLinear, launchLinear } from '../src/tui/linear.js';
import {
  saveInboxConfig,
  inboxConfig,
  saveInboxNotifications,
  saveInboxCheckpoint,
} from '../src/storage.js';

const LINE = '+15555550100';
const OTHER = '+15555550200';
const press = (app, name) => app.handleKey('', { name });
const event = (id = 'one') => ({
  id,
  from: '+15555550101',
  line: LINE,
  text: `Hello ${id}`,
  receivedAt: '2026-11-05T18:00:00.000Z',
  mediaUrl: null,
});

function fixture({ subscribed = true, notifications = false, ...overrides } = {}) {
  const calls = [];
  const saved = {
    notifications,
    subscriptions: subscribed ? { [LINE]: { subscriptionId: 's' } } : {},
  };
  const changes = [];
  const alerts = [];
  const app = new Workspace({
    account: { org_name: 'Studio workspace' },
    services: { channels: async () => [{ name: LINE }, { name: OTHER }, { name: 'Web chat' }] },
    inbox: {
      config: async () => saved,
      registeredClient: async () => structuredClone(saved),
      addLine: async (line) => {
        changes.push(['add', line]);
        saved.subscriptions[line] = { subscriptionId: 's' };
      },
      removeLine: async (line) => {
        changes.push(['remove', line]);
        delete saved.subscriptions[line];
      },
      saveNotifications: async (enabled) => {
        saved.notifications = enabled;
      },
      notifier: () => (e) => alerts.push(e),
      receive: async (client, options) => {
        calls.push({ client, ...options });
        for (const line of Object.keys(client.subscriptions)) options.status(line, 'listening');
        await new Promise((resolve) =>
          options.signal.addEventListener('abort', resolve, { once: true }),
        );
      },
      ...overrides,
    },
  });
  const open = async () => {
    app.state.nav = navigation.findIndex((n) => n.id === 'inbox');
    await app.activate();
    await settle();
  };
  return { app, calls, saved, changes, alerts, open };
}

test('Inbox opens directly from Home and the command palette, listing SMS subscriptions and available lines', async () => {
  const f = fixture();
  await f.app.handleKey('7');
  await press(f.app, 'return');
  await settle();
  const panel = f.app.state.panel;
  assert.equal(panel.kind, 'inbox');
  assert.deepEqual(
    panel.lines.map(({ line, enabled }) => [line, enabled]),
    [
      [LINE, true],
      [OTHER, false],
    ],
  );
  assert.equal(f.calls.length, 1);
  assert.match(f.app.frame(110, 38).plain(), /Listening for incoming texts/);
  await press(f.app, 'escape');
  assert.equal(f.calls[0].signal.aborted, true);
  f.app.palette();
  await f.app.choose(f.app.state.panel.options.find((o) => o.label === 'Inbox').value);
  await settle();
  assert.equal(f.app.state.panel.kind, 'inbox');
  f.app.quit();
  await f.app.inboxTask;
});

test('Space and Enter use subscription add/remove, and the last line off closes listening', async () => {
  const f = fixture({ subscribed: false });
  await f.open();
  assert.equal(f.calls.length, 0);
  assert.match(f.app.frame(80, 24).plain(), /Turn a line on/);
  await f.app.handleKey(' ');
  await settle();
  assert.deepEqual(f.changes, [['add', LINE]]);
  assert.equal(f.calls.length, 1);
  await press(f.app, 'down');
  await press(f.app, 'return');
  await settle();
  assert.equal(f.calls[0].signal.aborted, true);
  assert.equal(f.calls.length, 2);
  assert.deepEqual(Object.keys(f.calls[1].client.subscriptions), [LINE, OTHER]);
  await press(f.app, 'return');
  await press(f.app, 'up');
  await f.app.handleKey(' ');
  await settle();
  assert.equal(
    f.app.state.panel.lines.some((l) => l.enabled),
    false,
  );
  assert.equal(f.calls.at(-1).signal.aborted, true);
  assert.equal(f.app.state.panel.section, null);
  f.app.quit();
});

test('notifications persist, change without reconnecting, and only fire while enabled and open', async () => {
  const f = fixture();
  await f.open();
  await f.calls[0].write(event());
  f.calls[0].notify(event());
  assert.equal(f.alerts.length, 0);
  await f.app.handleKey('n');
  assert.equal(f.saved.notifications, true);
  f.calls[0].notify(event('two'));
  assert.equal(f.alerts.length, 1);
  assert.equal(f.calls.length, 1);
  assert.match(f.app.frame(80, 24).plain(), /Notifications on/);
  assert.match(f.app.frame(40, 24).plain(), /Notifications on/);
  await f.app.handleKey('n');
  assert.equal(f.saved.notifications, false);
  f.calls[0].notify(event('three'));
  assert.equal(f.alerts.length, 1);
  f.app.home();
  await f.open();
  assert.equal(f.app.state.panel.notifications, false);
  f.app.quit();
  f.calls.at(-1).notify(event('late'));
  assert.equal(f.alerts.length, 1);
  await f.app.inboxTask;
});

test('leaving, returning and quitting abort old listeners and reject stale callbacks', async () => {
  const f = fixture();
  await f.open();
  await f.calls[0].write(event());
  const inbox = f.app.state.panel;
  f.app.help();
  assert.equal(f.calls[0].signal.aborted, true);
  await f.calls[0].write(event('late'));
  f.calls[0].status(LINE, 'reconnecting');
  assert.equal(inbox.messages.length, 1);
  await press(f.app, 'escape');
  await settle();
  assert.equal(f.app.state.panel, inbox);
  assert.equal(f.calls.length, 2);
  f.calls[1].status(LINE, 'reconnecting');
  assert.equal(inbox.section, null);
  f.calls[1].status(LINE, 'listening');
  assert.equal(inbox.section, 'inbox');
  await f.app.handleKey('r');
  await settle();
  assert.equal(f.calls.length, 3);
  f.app.quit();
  await f.app.inboxTask;
  assert.ok(f.calls.every((call) => call.signal.aborted));
});

test('subscription and notification failures preserve state and allow listener recovery', async () => {
  const f = fixture({
    removeLine: async () => {
      throw new Error('Remove failed');
    },
    saveNotifications: async () => {
      throw new Error('Save failed');
    },
  });
  await f.open();
  await f.app.handleKey(' ');
  await settle();
  assert.equal(f.app.state.panel.lines[0].enabled, true);
  assert.match(f.app.state.error, /Remove failed/);
  assert.equal(f.calls.length, 2);
  await f.app.handleKey('n');
  assert.equal(f.app.state.panel.notifications, false);
  assert.match(f.app.state.error, /Save failed/);
  f.app.quit();
  await f.app.inboxTask;
  const broken = fixture({
    receive: async () => {
      throw new Error('History unavailable');
    },
  });
  await broken.open();
  assert.equal(broken.app.state.panel.section, null);
  assert.match(broken.app.state.error, /History unavailable/);
  assert.equal(broken.app.state.panel.lines[0].status, 'stopped');
  broken.app.quit();
});

test('incoming texts are bounded, scrollable, readable in linear mode, and sanitized on screen', async () => {
  const f = fixture();
  await f.open();
  for (let i = 0; i < 205; i++) await f.calls[0].write(event(String(i)));
  assert.equal(f.app.state.panel.messages.length, 200);
  assert.match(f.app.frame(80, 24).plain(), /Hello 204/);
  await press(f.app, 'pageup');
  assert.doesNotMatch(f.app.frame(80, 24).plain(), /Hello 204/);
  await press(f.app, 'end');
  await f.calls[0].write({
    ...event('latest'),
    text: 'One\nTwo\u001b[2J',
    mediaUrl: 'https://example.test/photo.png',
  });
  assert.match(f.app.frame(110, 38).plain(), /Two/);
  assert.doesNotMatch(f.app.frame(110, 38).plain(), /\u001b/);
  assert.match(describeLinear(f.app.state), /Notifications: off/);
  assert.match(describeLinear(f.app.state), /latest|One/);
  f.app.quit();
  await f.app.inboxTask;
});

test('Inbox formats line and sender numbers without changing message bodies or subscription keys', async () => {
  const f = fixture();
  try {
    await f.open();
    await f.calls[0].write({ ...event(), text: 'See you tomorrow at 10, thank you!' });
    await f.calls[0].write({
      ...event('international'),
      from: '+442012345678',
      text: 'C — confirmed',
    });
    const frame = f.app.frame(110, 38).plain();
    const linear = describeLinear(f.app.state);
    for (const text of [frame, linear]) {
      assert.match(text, /\[on\]\s+\+1 \(555\) 555-0100/);
      assert.match(text, /\+1 \(555\) 555-0101 → \+1 \(555\) 555-0100/);
      assert.match(text, /\+442012345678 → \+1 \(555\) 555-0100/);
      assert.match(text, /See you tomorrow at 10, thank you!/);
      assert.match(text, /C — confirmed/);
    }
    const body = frame.split('\n').find((line) => line.includes('See you tomorrow'));
    assert.equal(body.trim(), 'See you tomorrow at 10, thank you!');
    await f.app.handleKey(' ');
    assert.deepEqual(f.changes, [['remove', LINE]]);
  } finally {
    f.app.quit();
    await f.app.inboxTask;
  }
});

test(
  'Inbox demo receives a plain message body with formatted phone metadata in a real PTY',
  { skip: process.platform === 'win32' && 'node-pty needs an attachable console' },
  async () => {
    await preparePty();
    const term = new headless.Terminal({ cols: 110, rows: 38, allowProposedApi: true });
    const pty = spawn(process.execPath, ['scripts/tui-demo.mjs'], {
      cols: 110,
      rows: 38,
      cwd: process.cwd(),
      env: { ...process.env, TERM: 'xterm-256color' },
    });
    pty.onData((chunk) => term.write(chunk));
    const exited = new Promise((resolve) => pty.onExit(resolve));
    const text = () =>
      Array.from(
        { length: 38 },
        (_, i) => term.buffer.active.getLine(i)?.translateToString(true) || '',
      ).join('\n');
    const until = async (pattern) => {
      for (let i = 0; i < 150; i++) {
        await sleep(50);
        if (text().includes(pattern)) return;
      }
      assert.fail(`Terminal did not show ${pattern}\n${text()}`);
    };
    try {
      await until('Compose a text');
      pty.write('7\r');
      await until('Listening for incoming texts');
      await until('See you tomorrow at 10, thank you!');
      const frame = text();
      assert.match(frame, /\+1 \(555\) 555-0101 → \+1 \(555\) 555-0100/);
      assert.equal(
        frame
          .split('\n')
          .find((line) => line.includes('See you tomorrow'))
          .trim(),
        'See you tomorrow at 10, thank you!',
      );
      assert.doesNotMatch(frame, /C —/);
      pty.write('q');
      assert.equal((await exited).exitCode, 0);
    } finally {
      pty.kill();
      term.dispose();
    }
  },
);

test('listening animation stays in the header, follows connection state, and respects motion settings', async () => {
  const original = {
    noColor: process.env.NO_COLOR,
    motion: process.env.ALIVE5_NO_ANIMATION,
    term: process.env.TERM,
  };
  delete process.env.NO_COLOR;
  delete process.env.ALIVE5_NO_ANIMATION;
  process.env.TERM = 'xterm-256color';
  try {
    for (const mascot of mascots)
      for (const theme of Object.keys(themes)) {
        const f = fixture();
        Object.assign(f.app.state, { mascot: mascot.id, theme, motion: 'full' });
        await f.open();
        for (const width of [40, 80, 110]) {
          const at = (time) => f.app.frame(width, 24, f.app.replayAt + time).rows(24);
          const first = at(1000);
          const later = at(2400);
          assert.notDeepEqual(first.slice(3, 8), later.slice(3, 8));
          assert.deepEqual(first.slice(9), later.slice(9));
          for (const motion of ['subtle', 'off']) {
            f.app.state.motion = motion;
            f.app.changed();
            assert.deepEqual(at(1000), at(5000));
          }
          f.app.state.motion = 'full';
          f.app.changed();
        }
        f.calls[0].status(LINE, 'reconnecting');
        assert.equal(f.app.state.panel.section, null);
        f.app.quit();
        await f.app.inboxTask;
      }
    for (const [key, value] of [
      ['NO_COLOR', ''],
      ['ALIVE5_NO_ANIMATION', '1'],
    ]) {
      process.env[key] = value;
      const f = fixture();
      assert.equal(f.app.state.motion, 'off');
      f.app.quit();
      delete process.env[key];
    }
  } finally {
    for (const [key, value] of [
      ['NO_COLOR', original.noColor],
      ['ALIVE5_NO_ANIMATION', original.motion],
      ['TERM', original.term],
    ])
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
  }
});

test('notification preferences and checkpoints survive concurrent saves in existing local config', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'alive5-inbox-preferences-'));
  const previous = process.env.ALIVE5_CONFIG_DIR;
  process.env.ALIVE5_CONFIG_DIR = dir;
  try {
    await saveInboxConfig({
      clientId: 'client',
      subscriptions: { [LINE]: { subscriptionId: 's' } },
    });
    await Promise.all([
      saveInboxNotifications(true),
      saveInboxCheckpoint(LINE, 's', { receivedAt: event().receivedAt }),
    ]);
    const saved = await inboxConfig();
    assert.equal(saved.notifications, true);
    assert.equal(saved.clientId, 'client');
    assert.equal(saved.subscriptions[LINE].checkpoint.receivedAt, event().receivedAt);
  } finally {
    if (previous === undefined) delete process.env.ALIVE5_CONFIG_DIR;
    else process.env.ALIVE5_CONFIG_DIR = previous;
    await rm(dir, { recursive: true, force: true });
  }
});

test('a late client load cannot reopen a listener after leaving Inbox', async () => {
  let release;
  const f = fixture({
    registeredClient: () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  });
  await f.open();
  f.app.help();
  release(f.saved);
  await f.app.inboxTask;
  assert.equal(f.calls.length, 0);
  assert.equal(f.app.state.panel.kind, 'help');
  f.app.quit();
});

test('linear mode streams incoming texts and accepts inbox controls without terminal escapes', async () => {
  const f = fixture();
  const input = new PassThrough();
  let text = '';
  const output = new Writable({
    write(chunk, encoding, callback) {
      text += chunk;
      callback();
    },
  });
  const done = launchLinear({
    input,
    output,
    account: f.app.state.account,
    services: f.app.services,
    inbox: f.app.inbox,
  });
  input.write('7\n');
  for (let i = 0; i < 20 && !f.calls.length; i++) await settle();
  assert.equal(f.calls.length, 1);
  await f.calls[0].write(event('live in linear mode'));
  await settle();
  assert.match(text, /Hello live in linear mode/);
  input.write(':notify\n');
  for (let i = 0; i < 20 && !f.saved.notifications; i++) await settle();
  assert.equal(f.saved.notifications, true);
  input.write(':quit\n');
  await done;
  assert.equal(f.calls[0].signal.aborted, true);
  assert.doesNotMatch(text, /\u001b/);
  f.app.quit();
});

test('inbox times use the local timezone, not UTC', async () => {
  const { shortTime } = await import('../src/tui/records.js');
  const at = '2026-11-05T21:59:56.000Z';
  const d = new Date(at);
  const pad = (n) => String(n).padStart(2, '0');
  assert.equal(
    shortTime(at),
    `2026-11-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`,
  );
  assert.match(
    readFileSync(new URL('../src/tui/panels.js', import.meta.url), 'utf8'),
    /shortTime\(event\.receivedAt\)/,
  );
});
