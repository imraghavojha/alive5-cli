// The cell buffer. A Screen is a plain grid of styled cells that can be turned
// into ANSI rows; it has no knowledge of panels, keys, or the real terminal.

import { sanitize, graphemes, clip, stringWidth } from './text.js';

export const theme = {
  bg: '#111011',
  panel: '#191718',
  ink: '#e4e4e7',
  muted: '#a09a95',
  faint: '#837d80',
  line: '#363237',
  orange: '#eb5124',
  hot: '#ff936b',
  selected: '#242426',
};

export const mix = (a, b, t) => {
  const rgb = (c) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
  const x = rgb(a);
  const y = rgb(b);
  return (
    '#' +
    x
      .map((n, i) =>
        Math.round(n + (y[i] - n) * Math.min(1, Math.max(0, t)))
          .toString(16)
          .padStart(2, '0'),
      )
      .join('')
  );
};

const sgrCache = new Map();

function color(hex, background, depth) {
  const key = hex + background + depth;
  const cached = sgrCache.get(key);
  if (cached) return cached;
  const rgb = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const code =
    depth === 24
      ? `${background ? 48 : 38};2;${rgb.join(';')}`
      : `${background ? 48 : 38};5;${16 + 36 * Math.round((rgb[0] / 255) * 5) + 6 * Math.round((rgb[1] / 255) * 5) + Math.round((rgb[2] / 255) * 5)}`;
  sgrCache.set(key, code);
  return code;
}

export class Screen {
  constructor(width, height) {
    this.width = width;
    this.height = height;
    this.rowCache = [];
    this.cells = Array.from({ length: height }, () =>
      Array.from({ length: width }, () => ({ ch: ' ', fg: theme.ink, bg: theme.bg, bold: false })),
    );
  }
  put(x, y, text, fg = theme.ink, bg = theme.bg, bold = false) {
    if (y < 0 || y >= this.height) return;
    this.rowCache[y] = null;
    for (const ch of graphemes(sanitize(text).replace(/\n/g, ' '))) {
      const w = stringWidth(ch);
      if (x >= 0 && x + w <= this.width) {
        this.cells[y][x] = { ch, fg, bg, bold };
        // A double-width glyph owns the next cell, which must stay empty.
        if (w === 2) this.cells[y][x + 1] = { ch: '', fg, bg, bold };
      }
      x += w;
      if (x >= this.width) break;
    }
  }
  fill(x, y, w, h, bg = theme.panel) {
    for (let row = y; row < y + h; row++)
      this.put(x, row, ' '.repeat(Math.max(0, w)), theme.ink, bg);
  }
  line(x, y, w, fg = theme.line) {
    this.put(x, y, '─'.repeat(Math.max(0, w)), fg);
  }
  text(x, y, w, text, fg = theme.ink, bg = theme.bg, bold = false) {
    this.put(x, y, clip(text, w), fg, bg, bold);
  }
  rows(depth = 24) {
    return this.cells.map((row, index) => {
      if (this.rowCache[index]?.depth === depth) return this.rowCache[index].text;
      let out = '';
      let prev = '';
      for (const cell of row) {
        const style = depth
          ? `\x1b[${color(cell.fg, false, depth)};${color(cell.bg, true, depth)};${cell.bold ? 1 : 22}m`
          : cell.bold
            ? '\x1b[1m'
            : '\x1b[22m';
        if (style !== prev) {
          out += style;
          prev = style;
        }
        // Without color, a half block on a tinted background would vanish.
        out += !depth && cell.ch === '▀' && cell.bg !== theme.bg ? '█' : cell.ch;
      }
      const text = out + '\x1b[0m';
      this.rowCache[index] = { depth, text };
      return text;
    });
  }
  plain() {
    return this.cells.map((row) => row.map((c) => c.ch).join('')).join('\n');
  }
}
