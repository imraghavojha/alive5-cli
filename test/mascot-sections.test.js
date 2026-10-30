import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { spawn } from 'node-pty';
import headless from '@xterm/headless';
import { Workspace } from '../src/tui/workspace.js';
import { mascots, sectionMascotArea } from '../src/tui/mascot.js';
import { themes } from '../src/tui/screen.js';
import { preparePty } from '../scripts/pty-helper.mjs';

// Exercise motion even when the test runner itself disables terminal colors.
delete process.env.NO_COLOR;
delete process.env.ALIVE5_NO_ANIMATION;
const dir = await mkdtemp(join(tmpdir(), 'alive5-sections-'));
process.env.ALIVE5_CONFIG_DIR = dir;
test.after(() => rm(dir, { recursive: true, force: true }));
const channel = { id: 'c', name: '+15555550100', users: [{ id: 'u', name: 'Avery' }] };
const services = {
  channels: async () => [channel],
  contacts: async () => ({ data: [{ id: 'p', firstName: 'Jordan', phone: '+15555550101' }] }),
  messages: async () => [],
  conversations: async () => ({ data: [] }),
};
const press = (app, name) => app.handleKey('', { name });
const create = (settings = {}) =>
  new Workspace({
    account: { org_name: 'Studio workspace' },
    services,
    settings: { motion: 'full', ...settings },
  });
async function open(app, section) {
  app.home();
  app.state.nav = { compose: 0, messages: 1, conversations: 2, contacts: 3 }[section];
  await app.activate();
  assert.equal(app.state.panel.section, section);
  if (section === 'compose') return;
  await press(app, 'return');
  if (section === 'conversations') await press(app, 'return');
  assert.equal(app.state.panel.kind, 'list');
  assert.equal(app.state.panel.section, section);
}
const snapshot = (app, width, elapsed) => app.frame(width, 24, app.replayAt + elapsed).rows(24);

test('all section animations leave content and header text still across widths, themes, and mascots', async () => {
  for (const mascot of mascots)
    for (const theme of Object.keys(themes))
      for (const section of ['messages', 'compose', 'contacts', 'conversations']) {
        const app = create({ mascot: mascot.id, theme });
        await open(app, section);
        for (const width of [40, 64, 80, 110]) {
          const first = snapshot(app, width, 0);
          const active = snapshot(app, width, 2400);
          assert.notDeepEqual(
            first.slice(0, 4),
            active.slice(0, 4),
            `${mascot.id} ${section} ${theme} ${width}`,
          );
          assert.deepEqual(first.slice(4), active.slice(4), 'animation cannot move task content');
          const area = sectionMascotArea(app.state, width);
          const left = (time) =>
            app
              .frame(width, 24, app.replayAt + time)
              .cells.slice(0, 4)
              .map((row) => row.slice(0, area.x).map((c) => ({ ...c })));
          assert.deepEqual(left(0), left(2400), 'animation cannot overwrite header text');
          assert.ok(app.frame(width, 24).plain().includes('Alive5'));
        }
        app.state.motion = 'subtle';
        app.changed();
        assert.deepEqual(snapshot(app, 40, 1000), snapshot(app, 40, 5000));
        app.state.motion = 'off';
        app.changed();
        assert.deepEqual(snapshot(app, 40, 0), snapshot(app, 40, 2400));
      }
});

test('wider bubbles and cards appear, clear cleanly, and conversations alternate', async () => {
  const app = create();
  const header = (time) =>
    app
      .frame(80, 24, app.replayAt + time)
      .plain()
      .split('\n')
      .slice(0, 4)
      .join('\n');
  await open(app, 'messages');
  assert.ok(header(2200).includes('╭─────╮'));
  assert.ok(header(2200).includes('│ ··· │'));
  assert.ok(!header(5200).includes('╭─────╮'));
  await open(app, 'contacts');
  assert.ok(header(2200).includes('┌─────┐'));
  assert.ok(header(2200).includes('│ o = │'));
  assert.ok(!header(5200).includes('┌─────┐'));
  await open(app, 'conversations');
  assert.ok(header(1800).includes('│ hi  │'));
  assert.ok(header(2700).includes('│ ok  │'));
  await open(app, 'compose');
  assert.ok(header(2100).includes('>h_'));
  assert.ok(header(3000).includes('>hi'));
  assert.ok(!header(5200).includes('>hi'));
  app.state.motion = 'off';
  app.changed();
  assert.ok(!header(2100).includes('>h_'));
});

test('pickers, previews, details, transcripts, and back navigation retain the correct section', async () => {
  const app = create();
  await open(app, 'compose');
  await press(app, 'return');
  assert.equal(app.state.panel.section, 'compose');
  await press(app, 'escape');
  assert.equal(app.state.panel.section, 'compose');
  app.compose(
    { channels: [channel], channel, user: channel.users[0] },
    { to: '+15555550101', message: 'Hello' },
  );
  await press(app, 'return');
  assert.equal(app.state.panel.kind, 'preview');
  assert.equal(app.state.panel.section, 'compose');
  await open(app, 'contacts');
  await press(app, 'return');
  assert.equal(app.state.panel.kind, 'reader');
  assert.equal(app.state.panel.section, 'contacts');
  app.help();
  assert.equal(app.state.panel.section, undefined);
  app.back();
  assert.equal(app.state.panel.section, 'contacts');
  app.palette();
  assert.equal(app.state.panel.section, null);
  await app.choose(app.state.panel.options.find((o) => o.label === 'Agent quick start').value);
  assert.equal(app.state.panel.section, null);
  app.list('Channels', 'channels', [channel]);
  assert.equal(app.state.panel.section, 'contacts');
  app.transcript({ name: 'Jordan', phone: '+15555550101', messages: [] });
  assert.equal(app.state.panel.section, 'conversations');
  app.home();
  assert.equal(app.state.panel.section, undefined);
});

test('no-animation environments keep section mascots static', async () => {
  process.env.ALIVE5_NO_ANIMATION = '1';
  try {
    const app = create();
    await open(app, 'messages');
    assert.equal(app.state.motion, 'off');
    assert.deepEqual(snapshot(app, 80, 0), snapshot(app, 80, 2400));
  } finally {
    delete process.env.ALIVE5_NO_ANIMATION;
  }
});

test(
  'PTY scheduler animates section headers for both mascots and survives narrow resize and exit',
  { skip: process.platform === 'win32' },
  async () => {
    await preparePty();
    for (const mascot of mascots) {
      const term = new headless.Terminal({ cols: 80, rows: 24, allowProposedApi: true });
      const env = {
        ...process.env,
        DEMO_MASCOT: mascot.id,
        DEMO_THEME: 'terminal',
        DEMO_MOTION: 'full',
        TERM: 'xterm-256color',
        COLORTERM: 'truecolor',
      };
      const p = spawn(process.execPath, ['scripts/tui-demo.mjs'], {
        cols: 80,
        rows: 24,
        cwd: process.cwd(),
        env,
      });
      const exited = new Promise((resolve) => p.onExit(resolve));
      p.onData((chunk) => term.write(chunk));
      const lines = () =>
        Array.from(
          { length: term.rows },
          (_, y) => term.buffer.active.getLine(y)?.translateToString(true) || '',
        );
      const until = async (pattern) => {
        for (let i = 0; i < 100; i++) {
          await sleep(40);
          if (lines().join('\n').includes(pattern)) return;
        }
        throw new Error('Terminal did not show ' + pattern + '\n' + lines().join('\n'));
      };
      try {
        await until('Compose a text');
        p.write('2\r');
        await until('Read recent messages');
        p.write('\r');
        await until('Recent messages');
        await until('╭─────╮');
        const body = lines().slice(4);
        await until('···');
        assert.deepEqual(lines().slice(4), body);
        p.resize(40, 24);
        term.resize(40, 24);
        await until('╭─────╮');
        assert.ok(lines().join('\n').includes('Recent messages'));
        assert.ok(
          lines()
            .join('\n')
            .includes(mascot.id === 'isometric-desktop' ? '┌──────┐' : '╰┬───┬╯'),
        );
        p.write('q');
        assert.equal((await exited).exitCode, 0);
        await new Promise((resolve) => term.write('', resolve));
        assert.equal(term.buffer.active.type, 'normal');
      } finally {
        p.kill();
        term.dispose();
      }
    }
  },
);
