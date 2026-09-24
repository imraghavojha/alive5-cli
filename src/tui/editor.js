// Text editing for workspace form fields: a value plus a caret, with the usual
// cursor movement, insertion, and deletion. Typing no longer only appends.

import { graphemes, sanitize, stringWidth } from './text.js';

const SINGLE_LINE_LIMIT = 500;
const LONG_LIMIT = 8192;

export const limitFor = (field) =>
  field.secret || field.multiline ? LONG_LIMIT : SINGLE_LINE_LIMIT;

const parts = (value) => graphemes(value ?? '');

export const length = (value) => parts(value).length;

const clampCaret = (value, caret) => Math.max(0, Math.min(length(value), caret));

/** Inserts text at the caret, honouring the field's own length limit. */
export function insert(field, value, caret, text) {
  const clean = sanitize(text);
  const addition = field.multiline ? clean : clean.replace(/\n/g, '');
  const chars = parts(value);
  const at = clampCaret(value, caret);
  const room = limitFor(field) - chars.length;
  const added = parts(addition).slice(0, Math.max(0, room));
  return {
    value: [...chars.slice(0, at), ...added, ...chars.slice(at)].join(''),
    caret: at + added.length,
  };
}

export function deleteBack(value, caret) {
  const chars = parts(value);
  const at = clampCaret(value, caret);
  if (!at) return { value, caret: 0 };
  return { value: [...chars.slice(0, at - 1), ...chars.slice(at)].join(''), caret: at - 1 };
}

export function deleteForward(value, caret) {
  const chars = parts(value);
  const at = clampCaret(value, caret);
  if (at >= chars.length) return { value, caret: at };
  return { value: [...chars.slice(0, at), ...chars.slice(at + 1)].join(''), caret: at };
}

/** Ctrl+W: removes the word before the caret, including any trailing spaces. */
export function deleteWord(value, caret) {
  const chars = parts(value);
  let at = clampCaret(value, caret);
  while (at > 0 && /\s/.test(chars[at - 1])) at--;
  while (at > 0 && !/\s/.test(chars[at - 1])) at--;
  return {
    value: [...chars.slice(0, at), ...chars.slice(clampCaret(value, caret))].join(''),
    caret: at,
  };
}

export const move = (value, caret, delta) => clampCaret(value, caret + delta);

const lineBounds = (value, caret) => {
  const chars = parts(value);
  const at = clampCaret(value, caret);
  let start = at;
  while (start > 0 && chars[start - 1] !== '\n') start--;
  let end = at;
  while (end < chars.length && chars[end] !== '\n') end++;
  return { start, end, column: at - start };
};

export const lineStart = (value, caret) => lineBounds(value, caret).start;
export const lineEnd = (value, caret) => lineBounds(value, caret).end;

/**
 * Moves the caret one logical line up or down. Returns null at the first or last
 * line so the caller can move focus to the next field instead.
 */
export function moveLine(value, caret, direction) {
  const chars = parts(value);
  const { start, end, column } = lineBounds(value, caret);
  if (direction < 0) {
    if (start === 0) return null;
    const previous = lineBounds(value, start - 1);
    return previous.start + Math.min(column, previous.end - previous.start);
  }
  if (end >= chars.length) return null;
  const next = lineBounds(value, end + 1);
  return next.start + Math.min(column, next.end - next.start);
}

/**
 * Wraps a value for display and reports where the caret lands. Offsets are kept
 * so the caret stays correct through soft wrapping and multi-byte graphemes.
 */
export function wrapWithCaret(value, width, caret = 0) {
  const chars = parts(value);
  const lines = [];
  let line = '';
  let start = 0;
  const push = (nextStart) => {
    lines.push({ text: line, start });
    start = nextStart;
    line = '';
  };
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    if (ch === '\n') {
      push(i + 1);
      continue;
    }
    if (ch === ' ' && line) {
      let j = i + 1;
      while (j < chars.length && chars[j] !== ' ' && chars[j] !== '\n') j++;
      const nextWord = chars.slice(i + 1, j).join('');
      if (nextWord && stringWidth(line + ' ' + nextWord) > width) {
        push(i + 1);
        continue;
      }
    }
    if (stringWidth(line + ch) > width && line) push(i);
    line += ch;
  }
  lines.push({ text: line, start });
  const at = clampCaret(value, caret);
  let row = lines.length - 1;
  for (let i = 0; i < lines.length; i++) {
    const nextStart = i + 1 < lines.length ? lines[i + 1].start : Infinity;
    if (at < nextStart) {
      row = i;
      break;
    }
  }
  const column = stringWidth(
    parts(lines[row].text)
      .slice(0, at - lines[row].start)
      .join(''),
  );
  return { lines: lines.map((l) => l.text), caret: { row, column } };
}
