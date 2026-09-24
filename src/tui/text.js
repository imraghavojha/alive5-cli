// Terminal-safe text measurement. Every string drawn to the screen passes
// through sanitize() first, so untrusted content cannot emit escape sequences.

import stringWidth from 'string-width';

export const sanitize = (value) =>
  String(value ?? '')
    .replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g, '')
    .replace(/\t/g, '  ');

const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

/** Grapheme split, with fast paths for short and pure-ASCII strings. */
export const graphemes = (text) =>
  !text
    ? []
    : text.length < 2
      ? [text]
      : /^[\x20-\x7e]*$/.test(text)
        ? text.split('')
        : [...segmenter.segment(text)].map((x) => x.segment);

export function clip(text, width) {
  let out = '';
  let used = 0;
  for (const char of graphemes(sanitize(text).replace(/\n/g, ' '))) {
    const n = stringWidth(char);
    if (used + n > width) break;
    out += char;
    used += n;
  }
  return out;
}

/** Marks a clipped label so a truncated value is never mistaken for a full one. */
export function clipWithEllipsis(text, width) {
  const clean = sanitize(text).replace(/\n/g, ' ');
  if (stringWidth(clean) <= width) return clean;
  return width <= 1 ? clip(clean, width) : clip(clean, width - 1) + '…';
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
      // A word longer than the panel is broken across lines rather than clipped.
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

export { stringWidth };
