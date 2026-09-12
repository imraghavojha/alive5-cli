import stringWidth from 'string-width';

export const theme = {
  bg: '#111011',
  panel: '#191718',
  ink: '#ede6da',
  muted: '#a09a95',
  faint: '#837d80',
  line: '#363237',
  orange: '#eb5124',
  hot: '#ff936b',
  selected: '#2c1d1a',
  gray: '#48484a',
};
export const sanitize = (value) =>
  String(value ?? '')
    .replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g, '')
    .replace(/\t/g, '  ');
const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
export const graphemes = (text) =>
  !text
    ? []
    : text.length < 2
      ? [text]
      : /^[\x20-\x7e]*$/.test(text)
        ? text.split('')
        : [...segmenter.segment(text)].map((x) => x.segment);
export function clip(text, width) {
  let out = '',
    used = 0;
  for (const char of graphemes(sanitize(text).replace(/\n/g, ' '))) {
    const n = stringWidth(char);
    if (used + n > width) break;
    out += char;
    used += n;
  }
  return out;
}
export function wrap(text, width) {
  const lines = [];
  for (const paragraph of sanitize(text).split('\n')) {
    let line = '';
    for (const word of paragraph.split(' ')) {
      if (stringWidth(line + (line ? ' ' : '') + word) <= width) {
        line += (line ? ' ' : '') + word;
        continue;
      }
      if (line) lines.push(line);
      line = '';
      for (const char of graphemes(word)) {
        if (stringWidth(line + char) > width) {
          lines.push(line);
          line = '';
        }
        line += char;
      }
    }
    lines.push(line);
  }
  return lines;
}
export const mix = (a, b, t) => {
  const rgb = (c) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
  const x = rgb(a),
    y = rgb(b);
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
  if (sgrCache.has(key)) return sgrCache.get(key);
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
      let out = '',
        prev = '';
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
export class Terminal {
  constructor(output = process.stdout) {
    this.output = output;
    this.previous = [];
    this.depth =
      'NO_COLOR' in process.env
        ? 0
        : process.env.COLORTERM === 'truecolor' || process.env.COLORTERM === '24bit'
          ? 24
          : 8;
    this.blocked = false;
    this.closed = false;
  }
  open() {
    this.output.write('\x1b[?1049h\x1b[?25l\x1b[?7l\x1b[?2004h');
  }
  render(screen) {
    if (this.blocked || this.closed) return;
    const rows = screen.rows(this.depth);
    let output = '';
    rows.forEach((row, i) => {
      if (this.previous[i] !== row) output += `\x1b[${i + 1};1H${row}`;
    });
    if (!output) return;
    this.previous = rows;
    this.blocked = !this.output.write('\x1b[?2026h' + output + '\x1b[?2026l');
    if (this.blocked)
      this.output.once('drain', () => {
        this.blocked = false;
      });
  }
  close() {
    if (this.closed) return;
    this.closed = true;
    this.output.write('\x1b[0m\x1b[?2004l\x1b[?7h\x1b[?25h\x1b[?1049l');
  }
}
