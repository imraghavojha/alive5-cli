import { preparePty } from './pty-helper.mjs';
await preparePty();
import { spawn } from 'node-pty';
import headless from '@xterm/headless';
import { createCanvas, GlobalFonts } from '@napi-rs/canvas';
import { writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
const { Terminal } = headless;
const out = process.argv[2] || '.local/design';
const captureTheme = process.env.DEMO_THEME || 'dark';
const defaultColors = {
  dark: { bg: '#111011', fg: '#e4e4e7' },
  light: { bg: '#faf8f4', fg: '#262326' },
  terminal: { bg: '#111011', fg: '#e4e4e7' },
  'high-contrast': { bg: '#000000', fg: '#ffffff' },
}[captureTheme];
await mkdir(out, { recursive: true });
const cols = Number(process.argv[3] || 110),
  rows = Number(process.argv[4] || 38);
const emulator = new Terminal({ cols, rows, allowProposedApi: true });
const env = { ...process.env, TERM: 'xterm-256color', COLORTERM: 'truecolor' };
delete env.NO_COLOR;
delete env.ALIVE5_NO_ANIMATION;
const pty = spawn(process.execPath, ['scripts/tui-demo.mjs'], {
  name: 'xterm-256color',
  cols,
  rows,
  cwd: process.cwd(),
  env,
});
let raw = '';
let bytes = 0;
pty.onData((chunk) => {
  raw += chunk;
  bytes += Buffer.byteLength(chunk);
  emulator.write(chunk);
});
const fontPath = [
  '/System/Library/Fonts/Menlo.ttc',
  '/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf',
  '/usr/share/fonts/truetype/liberation2/LiberationMono-Regular.ttf',
  'C:\\Windows\\Fonts\\consola.ttf',
].find(existsSync);
if (fontPath) GlobalFonts.registerFromPath(fontPath, 'Terminal Mono');
else
  throw new Error(
    'A monospace capture font is required (Menlo, DejaVu Sans Mono, Liberation Mono, or Consolas).',
  );
function rgb(cell, background) {
  const n = background ? cell.getBgColor() : cell.getFgColor();
  const isDefault = background ? cell.isBgDefault() : cell.isFgDefault();
  return isDefault
    ? background
      ? defaultColors.bg
      : defaultColors.fg
    : '#' + n.toString(16).padStart(6, '0');
}
export async function capture(name) {
  await new Promise((r) => emulator.write('', r));
  const cw = 11,
    ch = 23,
    pad = 24,
    top = 38;
  const canvas = createCanvas(cols * cw + pad * 2, rows * ch + pad + top);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = defaultColors.bg;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = captureTheme === 'light' ? '#e8e1db' : '#191718';
  ctx.fillRect(0, 0, canvas.width, top);
  ctx.font = '12px Terminal Mono';
  ctx.fillStyle = captureTheme === 'light' ? '#5b5558' : '#b0a9a5';
  ctx.fillText('alive5  ·  terminal', pad, 24);
  for (let y = 0; y < rows; y++)
    for (let x = 0; x < cols; x++) {
      const cell = emulator.buffer.active.getLine(y)?.getCell(x);
      if (!cell) continue;
      const xx = pad + x * cw,
        yy = top + y * ch;
      const inverse = Boolean(cell.isInverse());
      ctx.fillStyle = rgb(cell, !inverse);
      ctx.fillRect(xx, yy, cw, ch);
      const glyph = cell.getChars();
      if (!glyph) continue;
      ctx.fillStyle = rgb(cell, inverse);
      // Terminal block elements are geometric cells, not font glyphs.
      const quadrants = [
        ' ',
        '▘',
        '▝',
        '▀',
        '▖',
        '▌',
        '▞',
        '▛',
        '▗',
        '▚',
        '▐',
        '▜',
        '▄',
        '▙',
        '▟',
        '█',
      ];
      const bits = quadrants.indexOf(glyph);
      if (bits >= 0) {
        for (let bit = 0; bit < 4; bit++)
          if (bits & (1 << bit))
            ctx.fillRect(
              xx + (bit % 2 ? Math.ceil(cw / 2) : 0),
              yy + (bit >= 2 ? Math.ceil(ch / 2) : 0),
              bit % 2 ? Math.floor(cw / 2) : Math.ceil(cw / 2),
              bit >= 2 ? Math.floor(ch / 2) : Math.ceil(ch / 2),
            );
      } else {
        ctx.font = `${cell.isBold() ? 'bold ' : ''}18px Terminal Mono`;
        ctx.fillText(glyph, xx, yy + 18);
      }
    }
  await writeFile(`${out}/${name}.png`, canvas.toBuffer('image/png'));
  const text = Array.from(
    { length: rows },
    (_, y) => emulator.buffer.active.getLine(y)?.translateToString(true) || '',
  ).join('\n');
  await writeFile(`${out}/${name}.txt`, text);
}
if (process.env.CAPTURE_ANIMATION) {
  for (let i = 0; i < 100 && bytes === 0; i++) await sleep(20);
  for (let i = 0; i < Number(process.env.CAPTURE_FRAMES || 28); i++) {
    await capture(`frame-${String(i).padStart(3, '0')}`);
    await sleep(Number(process.env.CAPTURE_INTERVAL || 65));
  }
}
await sleep(2000);
console.log('initialBytes', bytes);
await writeFile(out + '/raw.ansi', raw);
if (process.env.CAPTURE_PAUSED) {
  pty.write('a ');
  await sleep(100);
  pty.write('\x1b');
  await sleep(100);
  pty.write('1');
  await sleep(100);
}
await capture('01-home');
pty.write('a');
await sleep(200);
await capture('02-appearance');
if (process.env.CAPTURE_LOGOS) {
  for (let i = 1; i <= 8; i++) {
    pty.write(String(i));
    await sleep(220);
    await capture(`logo-${i}`);
  }
}

// Compose: channel, teammate, then the message itself.
pty.write('\x1b');
await sleep(150);
pty.write('1\r');
await sleep(150);
pty.write('\r');
await sleep(150);
pty.write('\r');
await sleep(200);
await capture('03-compose');
pty.write('\r+15555550101\rYour appointment is confirmed for tomorrow at 10. See you then!');
await sleep(200);
await capture('03b-message');
// Caret editing: move back into the sentence and correct a word in place.
for (let i = 0; i < 12; i++) pty.write('\x1b[D');
await sleep(200);
await capture('03c-editing');
pty.write('\r');
await sleep(200);
await capture('04-preview');

// Escape steps back one panel at a time, keeping each draft, so returning Home
// from the preview walks back through the form and both selections.
const home = async () => {
  for (let i = 0; i < 6; i++) {
    pty.write('\x1b');
    await sleep(90);
  }
};

// Contacts: a compact list, a filter, then full detail for one record.
await home();
pty.write('4\r');
await sleep(150);
pty.write('\r');
await sleep(300);
await capture('05-contacts');
pty.write('/Jordan');
await sleep(250);
await capture('05b-filter');
pty.write('\r\r');
await sleep(250);
await capture('05c-detail');
pty.write('\x1b');
await sleep(150);

// The shortcut overlay, reachable from any panel.
pty.write('?');
await sleep(250);
await capture('06-shortcuts');
await home();

// Recent messages, as a table rather than a record dump.
pty.write('2\r');
await sleep(200);
pty.write('\r');
await sleep(300);
await capture('07-messages');
pty.write('\x1b');
await sleep(100);
const idleStart = bytes;
await sleep(1000);
const idleBytes = bytes - idleStart;
pty.write('q');
await new Promise((resolve) => pty.onExit(resolve));
console.log(
  JSON.stringify({
    cols,
    rows,
    idleBytesPerSecond: idleBytes,
    totalBytes: bytes,
    finalBuffer: emulator.buffer.active.type,
  }),
);
