import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as sleep } from 'node:timers/promises';
import { spawn } from 'node-pty';
import headless from '@xterm/headless';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Workspace, appearance } from '../src/tui/app.js';
import { theme, Screen } from '../src/tui/screen.js';
import { sendForm } from '../src/api.js';
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
  await press(app, 'escape');
  assert.equal(app.state.panel.values.message, 'Line one\nLine two');
  await press(app, 'return');
  await press(app, 'return');
  await press(app, 'return');
  assert.equal(app.state.panel.kind, 'preview');
  await press(app, 'return');
  assert.equal(sends, 1);
  assert.equal(app.state.panel.title, 'Message submitted');
  app.compose({ from: '+15555550100', to: '+15555550101', channel: 'c', user: 'u' });
  await press(app, 'return');
  await press(app, 'return');
  app.insert('x'.repeat(1601));
  await press(app, 'return');
  assert.equal(app.state.panel.kind, 'form');
  assert.equal(app.state.panel.values.message.length, 1601);
  assert.equal(sends, 1);
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
    assert.equal(app.state.logo, 'pixel');
    await press(app, 'down');
    await press(app, 'right');
    assert.equal(app.state.motion, 'subtle');
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
    assert.equal(text().includes('Nothing has been sent.'), true);
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
    assert.equal(migrated.logo, 'outline');
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
    for (let i = 0; i < 4; i++) await press(app, 'down');
    await press(app, 'return');
    assert.equal(app.state.notice, 'Appearance saved.');
    const saved = await appearance();
    assert.deepEqual(saved, { logo: 'frame', motion: 'off', effect: 'breathe' });
    assert.equal(JSON.parse(await readFile(join(dir, 'appearance.json'))).logo, 'frame');
    const restarted = new Workspace({ settings: saved });
    assert.ok(restarted.frame(80, 24).plain().includes('│   Alive 5   │'));
    await writeFile(join(dir, 'appearance.json'), '{broken');
    assert.equal((await appearance()).logo, 'outline');
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
