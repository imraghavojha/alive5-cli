// One draw function per panel kind. Each receives the panel, the screen, and the
// resolved layout, and owns nothing outside its content area.

import { theme } from './screen.js';
import { wrap, clipWithEllipsis } from './text.js';
import { wrapWithCaret, length } from './editor.js';
import { MESSAGE_LIMIT } from '../validate.js';
import { logos, logoById } from './logo.js';
import { navigation } from './layout.js';

const muted = (s, x, y, w, text) => s.text(x, y, w, text, theme.muted);

/** A heading plus a subtitle, the shared top of every task panel. */
function heading(s, l, title, subtitle) {
  s.text(l.x, l.top, l.w, title, theme.ink, theme.bg, true);
  muted(s, l.x, l.top + 1, l.w, subtitle || '');
}

function button(s, x, y, w, text, tone = theme.orange) {
  const width = Math.min(w, text.length + 6);
  s.fill(x, y, width, 1, tone);
  s.text(x + 2, y, w - 3, text, '#fff8f0', tone, true);
}

/** Highlights the focused row and writes its label. */
function row(s, l, y, active, text, tone) {
  if (active) s.fill(l.x, y, l.w, 1, theme.selected);
  s.text(
    l.x + 1,
    y,
    l.w - 2,
    (active ? '› ' : '  ') + text,
    tone || (active ? theme.ink : theme.muted),
    active ? theme.selected : theme.bg,
    active,
  );
}

/** Keeps the focused index inside a window of `visible` rows. */
export function scrollWindow(index, count, visible) {
  const start = Math.max(0, Math.min(index - Math.floor(visible / 2), count - visible));
  return Math.max(0, start);
}

function scrollNote(s, l, start, shown, total, suffix = '') {
  if (total <= shown) return;
  muted(
    s,
    l.x,
    l.bottom - 1,
    l.w,
    `${start + 1}–${Math.min(start + shown, total)} of ${total}${suffix}`,
  );
}

export const panels = {
  home(s, l, panel, state) {
    navigation.forEach((item, i) =>
      row(s, l, l.top + i, state.nav === i, `${i + 1}  ${item.label}`),
    );
    const active = navigation[state.nav];
    if (l.h >= 9) {
      muted(s, l.x, l.top + navigation.length + 1, l.w, active.description);
      s.text(l.x, l.top + navigation.length + 2, l.w, active.code, theme.faint);
    }
  },

  select(s, l, panel) {
    heading(s, l, panel.title, panel.subtitle || 'Choose an option');
    const visible = Math.max(1, l.h - 4);
    const start = scrollWindow(panel.index, panel.options.length, visible);
    panel.options
      .slice(start, start + visible)
      .forEach((item, i) => row(s, l, l.top + 3 + i, start + i === panel.index, item.label));
    scrollNote(s, l, start, visible, panel.options.length);
  },

  form(s, l, panel) {
    heading(s, l, panel.title, panel.subtitle || 'Tab moves between fields');
    const available = l.h - 4;
    const simple = panel.fields.filter((f) => !f.multiline).length * 3;
    const heights = panel.fields.map((f) =>
      f.multiline ? Math.max(5, Math.min(12, available - simple)) : 3,
    );
    const focusTop = heights.slice(0, panel.index).reduce((a, b) => a + b, 0);
    const offset = Math.max(0, focusTop + heights[panel.index] - available);
    let y = l.top + 3 - offset;
    panel.fields.forEach((field, i) => {
      drawField(s, l, panel, field, i, y, heights[i]);
      y += heights[i];
    });
  },

  reader(s, l, panel) {
    heading(s, l, panel.title, panel.subtitle || '');
    const lines = panel.lines.flatMap((t) => wrap(t, l.w - 2));
    const visible = Math.max(1, l.h - 4);
    const offset = Math.min(panel.scroll, Math.max(0, lines.length - visible));
    lines
      .slice(offset, offset + visible)
      .forEach((text, i) =>
        s.text(
          l.x + 1,
          l.top + 3 + i,
          l.w - 2,
          text,
          text.startsWith('›') ? theme.orange : theme.ink,
        ),
      );
    scrollNote(s, l, offset, visible, lines.length, '  ·  ↑↓ scroll');
  },

  list(s, l, panel) {
    heading(s, l, panel.title, panel.subtitle || '');
    const rows = visibleRows(panel);
    const visible = Math.max(1, l.h - 5);
    const start = scrollWindow(panel.index, rows.length, visible);
    const widths = columnWidths(panel.columns, l.w);
    // Headers line up with cell text, which sits after the two-column marker.
    s.text(
      l.x + 3,
      l.top + 3,
      l.w - 4,
      panel.columns.map((c, i) => c.header.padEnd(widths[i]).slice(0, widths[i])).join(' '),
      theme.faint,
    );
    if (!rows.length) muted(s, l.x + 2, l.top + 4, l.w - 2, 'Nothing matches this filter.');
    rows.slice(start, start + visible).forEach((r, i) => {
      const text = r.cells
        .map((cell, n) => clipWithEllipsis(cell, widths[n]).padEnd(widths[n]))
        .join(' ');
      row(s, l, l.top + 4 + i, start + i === panel.index, text);
    });
    // The filter state is always stated, so a short filtered list is never
    // mistaken for the whole account.
    const filter = panel.filter ? `filter "${panel.filter}" on loaded records` : '';
    const range = rows.length
      ? `${start + 1}–${Math.min(start + visible, rows.length)} of ${rows.length}`
      : 'no matches';
    if (filter || rows.length > visible)
      muted(s, l.x, l.bottom - 1, l.w, [range, filter].filter(Boolean).join('  ·  '));
  },

  preview(s, l, panel) {
    const sent = panel.outcome === 'accepted';
    heading(
      s,
      l,
      sent ? 'Message accepted' : 'Review your message',
      panel.outcome ? OUTCOMES[panel.outcome] : 'Nothing has been sent yet.',
    );
    let y = l.top + 3;
    for (const [name, value] of panel.context) {
      muted(s, l.x, y, 12, name);
      s.text(l.x + 12, y, l.w - 12, value || '—');
      y++;
    }
    const message = panel.form.message || '';
    const lines = wrap(message, l.w - 4);
    const visible = Math.max(1, l.bottom - 3 - (y + 2));
    muted(s, l.x, y + 1, l.w, `Message · ${length(message)} / ${MESSAGE_LIMIT} characters`);
    s.fill(l.x, y + 2, l.w, visible, theme.panel);
    const offset = Math.min(panel.scroll, Math.max(0, lines.length - visible));
    lines
      .slice(offset, offset + visible)
      .forEach((t, i) => s.put(l.x + 2, y + 2 + i, t, theme.ink, theme.panel));
    if (lines.length > visible)
      muted(
        s,
        l.x,
        y + 2 + visible,
        l.w,
        `line ${offset + 1}–${Math.min(offset + visible, lines.length)} of ${lines.length}`,
      );
    if (panel.outcome === 'unknown')
      button(s, l.x, l.bottom - 2, l.w, 'Keep draft  Esc', theme.hot);
    else if (!panel.outcome) button(s, l.x, l.bottom - 2, l.w, 'Send text  ↵');
  },

  appearance(s, l, panel, state) {
    const selected = logoById(state.logo);
    s.text(l.x, l.top, l.w, 'Appearance', theme.ink, theme.bg, true);
    const rows = [
      ['Wordmark', `${logos.indexOf(selected) + 1}/${logos.length}  ${selected.name}`],
      ['Motion', MOTION[state.motion]],
      ['Effect', EFFECTS[state.effect]],
      ['Replay', ''],
      ['Save appearance', ''],
    ];
    const split = l.w < 45 ? 18 : 24;
    rows.forEach(([name, value], i) => {
      const y = l.top + 2 + i;
      const active = panel.index === i;
      if (active) s.fill(l.x, y, l.w, 1, theme.selected);
      const bg = active ? theme.selected : theme.bg;
      s.text(
        l.x + 1,
        y,
        split - 1,
        (active ? '› ' : '  ') + name,
        active ? theme.ink : theme.muted,
        bg,
      );
      const shown = i < 3 && active ? `‹ ${value} ›` : value;
      s.text(l.x + split, y, l.w - split, shown, active ? theme.orange : theme.muted, bg);
    });
    if (l.h >= 9) muted(s, l.x, l.top + 8, l.w, selected.description);
  },

  help(s, l, panel) {
    heading(s, l, 'Keyboard shortcuts', 'Esc closes this list');
    const visible = Math.max(1, l.h - 4);
    const offset = Math.min(panel.scroll, Math.max(0, panel.lines.length - visible));
    panel.lines.slice(offset, offset + visible).forEach(([keys, what], i) => {
      const y = l.top + 3 + i;
      if (!what) {
        s.text(l.x, y, l.w, keys, theme.orange);
        return;
      }
      s.text(l.x + 1, y, 18, keys, theme.ink);
      muted(s, l.x + 19, y, l.w - 19, what);
    });
    scrollNote(s, l, offset, visible, panel.lines.length);
  },
};

const OUTCOMES = {
  accepted: 'Accepted by Alive5. Handset delivery is not yet confirmed.',
  unknown: 'The send result is unknown. Your draft is kept; check Alive5 before retrying.',
};

const MOTION = { full: 'Continuous', subtle: 'Entrance only', off: 'Off' };

const EFFECTS = {
  signal: 'Light sweep',
  breathe: 'Slow glow',
  orbit: 'Star drift',
  cosmos: 'Cosmos',
};

function drawField(s, l, panel, field, index, y, height) {
  const active = index === panel.index;
  const inside = (row) => row >= l.top + 3 && row < l.bottom - 1;
  const value = panel.values[field.key] || '';
  const title = field.multiline
    ? `${field.label} · ${length(value)} / ${MESSAGE_LIMIT}`
    : field.label;
  if (inside(y)) s.text(l.x, y, l.w, title, active ? theme.orange : theme.muted);
  const shown = field.secret ? '•'.repeat(Math.min(length(value), 80)) : value;
  const rows = height - 2;
  const { lines, caret } = wrapWithCaret(
    shown,
    l.w - 4,
    field.secret ? length(shown) : panel.carets[field.key] || 0,
  );
  // Keep the caret's line visible inside the field's own box.
  const offset = Math.max(0, Math.min(caret.row - rows + 1, lines.length - rows));
  for (let n = 0; n < rows; n++) {
    const row = y + 1 + n;
    if (!inside(row)) continue;
    const bg = active ? theme.selected : theme.panel;
    s.fill(l.x, row, l.w, 1, bg);
    const text = lines[offset + n];
    const placeholder = !value && n === 0 ? field.placeholder || '' : '';
    s.text(l.x + 2, row, l.w - 4, text ?? placeholder, value ? theme.ink : theme.faint, bg);
    if (active && offset + n === caret.row)
      s.put(l.x + 2 + Math.min(caret.column, l.w - 5), row, '▏', theme.orange, bg);
  }
}

/** Column widths shrink proportionally so a narrow terminal still shows every column. */
function columnWidths(columns, width) {
  const available = width - 4 - (columns.length - 1);
  const wanted = columns.reduce((a, c) => a + c.width, 0);
  if (wanted <= available) return columns.map((c) => c.width);
  const scale = available / wanted;
  return columns.map((c) => Math.max(6, Math.floor(c.width * scale)));
}

export const visibleRows = (panel) =>
  panel.filter
    ? panel.rows.filter((r) => r.search.includes(panel.filter.toLowerCase()))
    : panel.rows;
