import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as sleep } from 'node:timers/promises';
import { spawn } from 'node-pty';
import headless from '@xterm/headless';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable, Writable } from 'node:stream';
import { Workspace } from '../src/tui/workspace.js';
import { appearance, appearanceDefaults } from '../src/storage.js';
import { theme, Screen, themes } from '../src/tui/screen.js';
import { launchLinear } from '../src/tui/linear.js';
import { wrapWithCaret } from '../src/tui/editor.js';
import { sendForm } from '../src/api.js';
import { isoDay } from '../src/tui/flows.js';
import { threads } from '../src/tui/records.js';
import { preparePty } from '../scripts/pty-helper.mjs';
const mock = {
  channels: async () => [{ id: 'c', name: '+15555550100', users: [{ id: 'u', name: 'Avery' }] }],
  sendForm,
};
const press = (app, name, extra = {}) => app.handleKey('', { name, ...extra });

test('guided composer requires a separate preview confirmation and preserves edits', async () => {
  let sends = 0;
  const app = new Workspace({
    account: { org_name: 'test' },
    services: {
      ...mock,
      send: async (f) => {
        sends++;
        return { status: 'accepted', to: f.to, text: f.message, id: 'm' };
      },
    },
  });
  await app.activate();
  await press(app, 'return');
  await press(app, 'return');
  assert.equal(app.state.panel.kind, 'form');
  await press(app, 'return');
  app.insert('+15555550101');
  await press(app, 'return');
  app.insert('Line one\nLine two');
  await press(app, 'return');
  assert.equal(app.state.panel.kind, 'preview');
  assert.equal(sends, 0);
  // Review names every consequential choice, not only the message.
  const shown = app.state.panel.context.map(([name]) => name);
  assert.deepEqual(shown, ['Workspace', 'Channel', 'Send as', 'From', 'To']);

  // Back returns to the message field with the draft and the caret position kept.
  await press(app, 'escape');
  assert.equal(app.state.panel.kind, 'form');
  assert.equal(app.state.panel.values.message, 'Line one\nLine two');
  assert.equal(app.state.panel.index, 2);
  assert.equal(sends, 0);

  await press(app, 'return');
  assert.equal(app.state.panel.kind, 'preview');
  await press(app, 'return');
  assert.equal(sends, 1);
  assert.equal(app.state.panel.kind, 'reader');
  assert.equal(app.state.panel.title, 'Message accepted');

  app.compose(
    { channelName: 'Main', userName: 'Avery', channel: 'c', user: 'u' },
    {
      from: '+15555550100',
      to: '+15555550101',
    },
  );
  await press(app, 'return');
  await press(app, 'return');
  app.insert('x'.repeat(1601));
  await press(app, 'return');
  assert.equal(app.state.panel.kind, 'form');
  assert.equal(app.state.panel.values.message.length, 1601);
  assert.equal(sends, 1);
});

test('an unknown send result keeps the draft and refuses a second send', async () => {
  let sends = 0;
  const app = new Workspace({
    account: { org_name: 'test' },
    services: {
      ...mock,
      send: async () => {
        sends++;
        const e = new Error('The send result is unknown.');
        e.deliveryUnknown = true;
        throw e;
      },
    },
  });
  app.compose(
    { channelName: 'Main', userName: 'Avery', channel: 'c', user: 'u' },
    {
      from: '+15555550100',
      to: '+15555550101',
      message: 'Only once',
    },
  );
  await press(app, 'return');
  await press(app, 'return');
  await press(app, 'return');
  assert.equal(app.state.panel.kind, 'preview');
  await press(app, 'return');
  assert.equal(sends, 1);
  assert.equal(app.state.panel.outcome, 'unknown');
  assert.match(app.state.error, /unknown/);
  // Another Enter must not send again.
  await press(app, 'return');
  assert.equal(sends, 1);
  // The draft survives deliberate recovery.
  await press(app, 'escape');
  assert.equal(app.state.panel.kind, 'form');
  assert.equal(app.state.panel.values.message, 'Only once');
});

test('form fields support caret movement, insertion, and deletion', async () => {
  const app = new Workspace({ account: { org_name: 'test' } });
  app.compose({ channel: 'c', user: 'u' });
  app.state.panel.index = 2;
  app.insert('Hello wrld');
  const message = () => app.state.panel.values.message;
  for (let i = 0; i < 3; i++) await press(app, 'left');
  app.insert('o');
  assert.equal(message(), 'Hello world');
  await press(app, 'home');
  app.insert('> ');
  assert.equal(message(), '> Hello world');
  await press(app, 'end');
  await press(app, 'backspace');
  assert.equal(message(), '> Hello worl');
  await app.handleKey('', { name: 'w', ctrl: true });
  assert.equal(message(), '> Hello ');
  await press(app, 'home');
  await press(app, 'delete');
  assert.equal(message(), ' Hello ');
  await app.handleKey('', { name: 'u', ctrl: true });
  assert.equal(message(), '');
});

test('message editing wraps at words while keeping the caret in place', () => {
  const text = 'See you then!';
  assert.deepEqual(wrapWithCaret(text, 10, text.length).lines, ['See you', 'then!']);
  assert.deepEqual(wrapWithCaret(text, 10, text.length).caret, { row: 1, column: 5 });
});

test('date presets use the local calendar day, not the UTC one', () => {
  const lateEvening = new Date(2026, 8, 26, 23, 30);
  assert.equal(isoDay(0, lateEvening), '2026-09-26');
  assert.equal(isoDay(-1, lateEvening), '2026-09-27');
  assert.equal(isoDay(30, lateEvening), '2026-08-27');
});

test('record lists stay compact, filter loaded rows, and open full detail', async () => {
  const app = new Workspace({ account: { org_name: 'test' } });
  const people = [
    { id: 'c1', firstName: 'Avery', lastName: 'Stone', phone: '+15555550101', email: 'a@x.test' },
    { id: 'c2', firstName: 'Jordan', lastName: 'Reed', phone: '+15555550102', email: 'j@x.test' },
  ];
  app.list('Contacts', 'contacts', people, { page: 1 });
  const panel = app.state.panel;
  assert.deepEqual(
    panel.columns.map((c) => c.header),
    ['NAME', 'PHONE', 'EMAIL', 'COMPANY'],
  );
  // One row per record, rather than a block of internal field labels.
  assert.equal(panel.rows.length, 2);
  const text = app.frame(100, 30).plain();
  assert.ok(text.includes('Avery Stone'));
  assert.equal(text.includes('firstName'), false);

  await app.handleKey('/');
  for (const ch of 'jordan') await app.handleKey(ch);
  assert.equal(app.state.panel.filter, 'jordan');
  await press(app, 'return');
  assert.ok(app.frame(100, 30).plain().includes('filter "jordan" on loaded records'));
  await press(app, 'return');
  assert.equal(app.state.panel.kind, 'reader');
  assert.ok(
    app.state.panel.lines.some(([name, value]) => name === 'First name' && value === 'Jordan'),
  );
  // Values line up in one column, and email addresses are links.
  const screen = app.frame(100, 30);
  const rows = screen.plain().split('\n');
  const at = (label, text) => rows.find((r) => r.includes(label)).indexOf(text);
  assert.equal(at('First name', 'Jordan'), at('Email', 'j@x.test'));
  assert.ok(screen.rows(24).some((r) => r.includes('\x1b]8;;mailto:j@x.test')));
  // Back restores the list with its filter and selection intact.
  await press(app, 'escape');
  assert.equal(app.state.panel.kind, 'list');
  assert.equal(app.state.panel.filter, 'jordan');
});

test('the shortcut overlay opens and closes without losing the panel underneath', async () => {
  const app = new Workspace({ account: { org_name: 'test' } });
  app.reader('Recent messages', ['one', 'two']);
  await app.handleKey('?');
  assert.equal(app.state.panel.kind, 'help');
  assert.ok(app.frame(90, 30).plain().includes('Keyboard shortcuts'));
  await app.handleKey('?');
  assert.equal(app.state.panel.kind, 'reader');
  assert.equal(app.state.panel.title, 'Recent messages');
});

test('long errors wrap into the footer instead of being clipped', () => {
  const app = new Workspace({ account: { org_name: 'test' } });
  app.reader('Contacts', ['one']);
  app.state.error =
    'Alive5 rejected the request because the channel identifier does not belong to this workspace, so nothing was sent.';
  const rows = app.frame(80, 24).plain().split('\n');
  assert.ok(rows[21].includes('does not belong'));
  assert.ok(rows[22].includes('nothing was sent.'));
  // The rule moves up a row so the panel above never shifts.
  assert.ok(rows[20].trim().startsWith('─'));
});

test('fixed screen remains bounded on resize and supports internal scrolling', async () => {
  const app = new Workspace({ account: { org_name: 'test' } });
  app.reader(
    'Contacts',
    Array.from({ length: 50 }, (_, i) => ({ id: 'c' + i, name: 'Contact ' + i })),
  );
  for (const [width, height] of [
    [110, 38],
    [80, 24],
    [64, 24],
    [40, 15],
  ]) {
    const screen = app.frame(width, height, 2000);
    assert.equal(screen.cells.length, height);
    assert.ok(screen.cells.every((row) => row.length === width));
    assert.equal(screen.plain().includes('Resize to'), height < 24);
    assert.ok(screen.plain().includes('Esc back') || screen.plain().includes('Ctrl+C'));
  }
  const before = app.state.panel.scroll;
  await press(app, 'pagedown');
  assert.ok(app.state.panel.scroll > before);
  await press(app, 'escape');
  assert.equal(app.state.panel.kind, 'home');
  const s = new Screen(10, 2);
  s.put(1, 0, '🙂');
  assert.equal(s.cells[0][2].ch, '');
  s.put(0, 1, '');
  assert.equal(s.cells[1][0].ch, ' ');
});

test('End then Up moves the reader immediately and resize retains valid scroll', async () => {
  const app = new Workspace({ account: { org_name: 'test' } });
  app.reader(
    'Long reader',
    Array.from({ length: 90 }, (_, i) => `Line ${i + 1}`),
  );
  app.frame(80, 30);
  await press(app, 'end');
  const atEnd = app.state.panel.scroll;
  assert.ok(atEnd > 0);
  await press(app, 'up');
  assert.equal(app.state.panel.scroll, atEnd - 1);
  assert.ok(app.frame(80, 30).plain().includes(`Line ${atEnd}`));
  app.frame(80, 24);
  assert.ok(app.state.panel.scroll <= 90 - (app.contentHeight() - 4));
  app.frame(80, 38);
  assert.ok(app.state.panel.scroll >= 0);
});

test('wide lists show selected details beside two readable columns', () => {
  const app = new Workspace({ account: { org_name: 'test' } });
  app.list('Contacts', 'contacts', [
    {
      id: 'c1',
      firstName: 'Avery',
      lastName: 'Stone',
      phone: '+15555550100',
      email: 'avery@example.test',
    },
  ]);
  const wide = app.frame(110, 38).plain();
  assert.ok(wide.includes('Details'));
  assert.ok(wide.includes('+15555550100'));
  assert.ok(wide.includes('avery@example.test'));
  assert.equal(app.frame(64, 30).plain().includes('Details'), false);
});

test('messages group into threads that read as a conversation and reply in place', async () => {
  const app = new Workspace({ account: { org_name: 'test' }, services: mock });
  const at = (m) => new Date(Date.now() - m * 60000).toISOString();
  const rows = [
    { threadId: 't1', sender: 'Avery', at: at(5), text: 'See you at 10.' },
    { threadId: 't1', sender: '+15555550101', at: at(9), text: 'Is 10 still OK?' },
    { threadId: 't2', sender: '+15555550102', at: at(90), text: 'Thanks!' },
  ];
  const list = threads(rows);
  assert.deepEqual(
    list.map((t) => [t.id, t.phone, t.messages.length]),
    [
      ['t1', '+15555550101', 2],
      ['t2', '+15555550102', 1],
    ],
  );
  assert.deepEqual(
    list[0].messages.map((m) => m.inbound),
    [true, false],
  );
  app.list('Recent messages', 'threads', list);
  const wide = app.frame(120, 32).plain();
  assert.ok(wide.includes('You: See you at 10.'));
  assert.ok(wide.includes('5m ago'));
  // The customer's message sits on the left, the reply on the right.
  const lines = wide.split('\n');
  const column = (text) => lines.findLast((l) => l.includes(text)).lastIndexOf(text);
  assert.ok(column('Is 10 still OK?') < column('See you at 10.') - 20);
  assert.equal(app.frame(60, 24).plain().includes('Is 10 still OK?'), false);

  await press(app, 'return');
  assert.equal(app.state.panel.kind, 'transcript');
  await app.handleKey('r');
  await press(app, 'return');
  await press(app, 'return');
  assert.equal(app.state.panel.kind, 'form');
  assert.equal(app.state.panel.values.to, '+15555550101');
});

test('fresh appearance is calm, saved motion survives, and native colors use defaults', async () => {
  const previous = process.env.ALIVE5_CONFIG_DIR;
  const dir = await mkdtemp(join(tmpdir(), 'alive5-new-appearance-'));
  process.env.ALIVE5_CONFIG_DIR = dir;
  try {
    assert.deepEqual(await appearance(), appearanceDefaults);
    await writeFile(
      join(dir, 'appearance.json'),
      JSON.stringify({ motion: 'full', theme: 'light' }),
    );
    assert.equal((await appearance()).motion, 'full');
    assert.equal((await appearance()).theme, 'light');
    for (const name of Object.keys(themes)) {
      const screen = new Screen(10, 2, name);
      assert.equal(screen.rows(24).length, 2);
    }
    const native = new Screen(2, 1, 'terminal');
    native.reverse(0, 0, 2);
    assert.match(native.rows(24)[0], /\[39;49;22;7m/);
  } finally {
    if (previous === undefined) delete process.env.ALIVE5_CONFIG_DIR;
    else process.env.ALIVE5_CONFIG_DIR = previous;
    await rm(dir, { recursive: true, force: true });
  }
});

test('linear workspace prints ordinary text and never sends without SEND', async () => {
  let output = '';
  const sink = new Writable({
    write(chunk, encoding, done) {
      output += chunk.toString();
      done();
    },
  });
  await launchLinear({
    input: Readable.from(['6\n', '4\n', ':back\n', ':quit\n']),
    output: sink,
    account: { org_name: 'test' },
  });
  assert.ok(output.includes('Theme:'));
  assert.equal(output.includes('\x1b'), false);
  assert.ok(output.includes('Alive5'));
});

test('linear preview requires the exact SEND command', async () => {
  let sends = 0;
  let output = '';
  const sink = new Writable({
    write(chunk, encoding, done) {
      output += chunk.toString();
      done();
    },
  });
  await launchLinear({
    input: Readable.from([
      '1\n1\n1\n:next\n+15555550101\nHello from the linear workspace\nsend\n:quit\n',
    ]),
    output: sink,
    account: { org_name: 'test' },
    services: {
      ...mock,
      send: async () => {
        sends++;
        return { status: 'accepted' };
      },
    },
  });
  assert.equal(sends, 0);
  assert.ok(output.includes('Type SEND'));
  await launchLinear({
    input: Readable.from([
      '1\n1\n1\n:next\n+15555550101\nHello from the linear workspace\nSEND\n:quit\n',
    ]),
    output: sink,
    account: { org_name: 'test' },
    services: {
      ...mock,
      send: async () => {
        sends++;
        return { status: 'accepted' };
      },
    },
  });
  assert.equal(sends, 1);
});

test('appearance controls select logos and stop motion', async () => {
  const old = process.env.NO_COLOR,
    oldAnimation = process.env.ALIVE5_NO_ANIMATION;
  delete process.env.NO_COLOR;
  delete process.env.ALIVE5_NO_ANIMATION;
  try {
    const app = new Workspace({ account: { org_name: 'test' } });
    await app.handleKey('a', {});
    assert.equal(app.state.panel.kind, 'appearance');
    await press(app, 'right');
    assert.equal(app.state.logo, 'type');
    await press(app, 'down');
    await press(app, 'right');
    assert.equal(app.state.motion, 'off');
    await app.handleKey(' ', {});
    assert.equal(app.state.motion, 'full');
    await app.handleKey(' ', {});
    assert.equal(app.state.motion, 'off');
    const a = app.frame(100, 36, 3000).rows(24).join('');
    const b = app.frame(100, 36, 6000).rows(24).join('');
    assert.equal(a, b);
    assert.ok(
      app
        .frame(100, 36, 6000)
        .cells.flat()
        .some((c) => c.fg === theme.orange),
    );
  } finally {
    if (old === undefined) delete process.env.NO_COLOR;
    else process.env.NO_COLOR = old;
    if (oldAnimation === undefined) delete process.env.ALIVE5_NO_ANIMATION;
    else process.env.ALIVE5_NO_ANIMATION = oldAnimation;
  }
});

test('PTY restores the shell, handles Escape and multiline paste without submitting', async () => {
  await preparePty();
  const term = new headless.Terminal({ cols: 100, rows: 36, allowProposedApi: true });
  const env = { ...process.env, TERM: 'xterm-256color', COLORTERM: 'truecolor' };
  delete env.NO_COLOR;
  const p = spawn(process.execPath, ['scripts/tui-demo.mjs'], {
    cols: 100,
    rows: 36,
    cwd: process.cwd(),
    env,
  });
  let output = '';
  const exited = new Promise((r) => p.onExit(r));
  p.onData((d) => {
    output += d;
    term.write(d);
  });
  const text = () =>
    Array.from(
      { length: 36 },
      (_, i) => term.buffer.active.getLine(i)?.translateToString(true) || '',
    ).join('\n');
  const until = async (pattern) => {
    for (let i = 0; i < 100; i++) {
      await sleep(50);
      if (text().includes(pattern)) return;
    }
    throw new Error('Terminal did not show ' + pattern + '\n' + text());
  };
  try {
    await until('Compose a text');
    assert.equal(term.buffer.active.type, 'alternate');
    p.write('a');
    await until('Save appearance');
    p.write('\x1b');
    await until('Compose a text');
    p.write('1\r');
    await until('Choose a sending channel');
    p.write('\r');
    await until('Send as');
    p.write('\r');
    await until('Compose a text');
    p.write('\r+15555550101\r');
    await sleep(100);
    p.write('\x1b[200~Hello\nfrom a pasted message\x1b[201~');
    await until('from a pasted message');
    assert.equal(text().includes('Review your message'), false);
    p.write('\r');
    await until('Review your message');
    assert.equal(text().includes('Nothing has been sent yet.'), true);
    p.resize(64, 24);
    term.resize(64, 24);
    await sleep(150);
    assert.equal(term.buffer.active.type, 'alternate');
    p.write('q');
    const result = await exited;
    assert.equal(result.exitCode, 0);
    await new Promise((r) => term.write('', r));
    assert.equal(term.buffer.active.type, 'normal');
    assert.ok(output.includes('\x1b[?25h'));
    assert.ok(output.includes('\x1b[?2004l'));
    assert.equal(output.includes('\n'), false);
  } finally {
    p.kill();
    term.dispose();
  }
});

test('eight logo previews are distinct, persist on save, and migrate old preferences', async () => {
  const previous = process.env.ALIVE5_CONFIG_DIR;
  const dir = await mkdtemp(join(tmpdir(), 'alive5-appearance-'));
  process.env.ALIVE5_CONFIG_DIR = dir;
  try {
    await writeFile(
      join(dir, 'appearance.json'),
      JSON.stringify({ motion: 'off', effect: 'breathe' }),
    );
    const migrated = await appearance();
    assert.equal(migrated.logo, 'frame');
    assert.equal(migrated.theme, 'dark');
    const app = new Workspace({ account: { org_name: 'Example' }, settings: migrated });
    await app.handleKey('a');
    const previews = new Set();
    for (let i = 1; i <= 8; i++) {
      await app.handleKey(String(i));
      const screen = app.frame(80, 24);
      assert.ok(screen.plain().includes(`${i}/8`));
      assert.ok(
        screen.cells
          .slice(3, 10)
          .flat()
          .some((cell) => cell.ch.trim() && cell.fg === theme.orange),
        `Logo ${i} keeps the orange 5`,
      );
      previews.add(screen.plain().split('\n').slice(3, 10).join('\n'));
      for (const width of [40, 64, 80, 110]) {
        const text = app.frame(width, 24).plain();
        assert.ok(text.includes('Save appearance'));
        assert.ok(text.includes('Esc back'));
        assert.ok(text.includes('←→ change'));
      }
    }
    assert.equal(previews.size, 8);
    await app.handleKey('s');
    assert.equal(app.state.notice, 'Appearance saved.');
    assert.equal(app.state.panel.index, 0);
    for (let i = 0; i < 5; i++) await press(app, 'down');
    await press(app, 'return');
    assert.equal(app.state.notice, 'Appearance saved.');
    const saved = await appearance();
    assert.deepEqual(saved, { logo: 'frame', motion: 'off', effect: 'breathe', theme: 'dark' });
    assert.equal(JSON.parse(await readFile(join(dir, 'appearance.json'))).logo, 'frame');
    const restarted = new Workspace({ settings: saved });
    assert.ok(restarted.frame(80, 24).plain().includes('│   Alive5   │'));
    await writeFile(join(dir, 'appearance.json'), '{broken');
    assert.equal((await appearance()).logo, 'frame');
  } finally {
    if (previous === undefined) delete process.env.ALIVE5_CONFIG_DIR;
    else process.env.ALIVE5_CONFIG_DIR = previous;
    await rm(dir, { recursive: true, force: true });
  }
});

test('continuous effects persist, stay inside the banner, and stop on task screens', async () => {
  const app = new Workspace({
    account: { org_name: 'Example' },
    settings: { motion: 'full', logo: 'slash', effect: 'orbit' },
  });
  if (app.motionLocked) return;
  const a = app.frame(80, 24, app.replayAt + 4000).rows(24);
  const b = app.frame(80, 24, app.replayAt + 6500).rows(24);
  assert.notDeepEqual(a.slice(3, 10), b.slice(3, 10));
  assert.deepEqual(a.slice(10), b.slice(10));
  app.compose({ from: '+15555550100', to: '+15555550101' });
  const c = app.frame(80, 24, app.replayAt + 8000).rows(24);
  assert.deepEqual(c, app.frame(80, 24, app.replayAt + 12000).rows(24));
});

test('Cosmos preserves the label and content while comets and the moon move', () => {
  for (const width of [40, 80, 110]) {
    const app = new Workspace({
      account: { org_name: 'Example' },
      settings: { logo: 'frame', motion: 'full', effect: 'cosmos' },
    });
    const snapshots = [2000, 6500, 13000].map((elapsed) => {
      const screen = app.frame(width, 24, app.replayAt + elapsed);
      assert.ok(screen.plain().includes('│   Alive5   │'));
      assert.ok(screen.plain().includes(' /(___)/'));
      return screen.rows(24);
    });
    assert.deepEqual(snapshots[0].slice(8), snapshots[1].slice(8));
    if (!app.motionLocked) assert.notDeepEqual(snapshots[0].slice(3, 8), snapshots[1].slice(3, 8));
    app.state.motion = 'off';
    app.changed();
    assert.deepEqual(
      app.frame(width, 24, app.replayAt + 14000).rows(24),
      app.frame(width, 24, app.replayAt + 18000).rows(24),
    );
  }
});
