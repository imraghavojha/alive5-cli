// One draw function per panel kind. Each receives the panel, the screen, and the
// resolved layout, and owns nothing outside its content area.

import { wrap, clipWithEllipsis, stringWidth, fuzzy, graphemes } from './text.js';
import { wrapWithCaret, length } from './editor.js';
import { MESSAGE_LIMIT } from '../validate.js';
import { logos, logoById } from './logo.js';
import { navigation } from './layout.js';
import { detailLines, ago } from './records.js';
import { mix } from './screen.js';

const muted = (s, x, y, w, text) => s.text(x, y, w, text, s.theme.muted);

/** A heading plus a subtitle, the shared top of every task panel. */
function heading(s, l, title, subtitle) {
  s.text(l.x, l.top, l.w, title, s.theme.ink, s.theme.bg, true);
  muted(s, l.x, l.top + 1, l.w, clipWithEllipsis(subtitle || '', l.w));
}

function button(s, x, y, w, text, tone = s.theme.orange) {
  const width = Math.min(w, text.length + 6);
  s.fill(x, y, width, 1, tone);
  s.text(x + 2, y, w - 3, text, s.theme.bg, tone, true);
}

/** Highlights the focused row and writes its label. */
/** Highlights the focused row, writes its label, and makes it clickable. */
function row(s, l, y, active, text, target) {
  if (active) s.fill(l.x, y, l.w, 1, s.theme.selected);
  s.text(
    l.x + 1,
    y,
    l.w - 2,
    (active ? '▌ ' : '  ') + text,
    active ? s.theme.ink : s.theme.muted,
    active ? s.theme.selected : s.theme.bg,
    active,
  );
  if (active && s.themeName === 'terminal') s.reverse(l.x, y, l.w);
  if (target) s.hit(l.x, y, l.w, target);
}

/** Keeps the focused index inside a window of `visible` rows. */
export function scrollWindow(index, count, visible) {
  const start = Math.max(0, Math.min(index - Math.floor(visible / 2), count - visible));
  return Math.max(0, start);
}

/** A proportional thumb on a one-column track; nothing when everything fits. */
function scrollbar(s, x, y, h, start, visible, total) {
  if (total <= visible || h < 2) return;
  const size = Math.max(1, Math.round((h * visible) / total));
  const at = Math.round(((h - size) * start) / (total - visible));
  for (let i = 0; i < h; i++) {
    const thumb = i >= at && i < at + size;
    s.put(x, y + i, thumb ? '┃' : '│', thumb ? s.theme.muted : s.theme.line);
  }
}

/**
 * Wraps detail lines into screen rows. Strings are headings or prose; arrays
 * are [label, value, link] pairs whose values line up in one column.
 */
export function layoutLines(lines, width) {
  const labels = lines.filter(Array.isArray).map(([name]) => stringWidth(name));
  const indent = Math.min(16, Math.max(0, ...labels) + 2);
  return lines.flatMap((line) => {
    if (!Array.isArray(line)) return wrap(line, width).map((text) => ({ text }));
    const [name, value, url] = line;
    return wrap(value, Math.max(8, width - indent)).map((text, i) => ({
      label: i ? '' : name,
      text,
      url,
      indent,
    }));
  });
}

function drawLines(s, x, y, w, rows) {
  rows.forEach((r, i) => {
    if (r.indent == null)
      return s.text(x, y + i, w, r.text, r.text.startsWith('›') ? s.theme.orange : s.theme.ink);
    s.text(x, y + i, r.indent - 1, r.label, s.theme.muted);
    s.text(x + r.indent, y + i, w - r.indent, r.text, s.theme.ink);
    if (r.url) s.link(x + r.indent, y + i, stringWidth(r.text), r.url);
  });
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
    const menu = l.recent ? { ...l, w: l.recent.x - l.x - 2 } : l;
    const onMenu = state.focus !== 'recent';
    navigation.forEach((item, i) =>
      row(s, menu, l.top + i, onMenu && state.nav === i, `${i + 1}  ${item.label}`, {
        group: 'nav',
        index: i,
      }),
    );
    const active = navigation[state.nav];
    const below = l.top + navigation.length + 1;
    if (l.h >= 9) {
      const about = wrap(active.description, menu.w).slice(0, 2);
      about.forEach((text, i) => muted(s, l.x, below + i, menu.w, text));
      s.text(l.x, below + about.length, menu.w, active.code, s.theme.faint);
    }
    // Recent conversations: beside the menu when wide, under it when there is room.
    if (l.recent) {
      const height = l.bottom - l.top;
      s.box(l.recent.x, l.top, l.recent.w, height, 'Recent conversations', s.theme.muted);
      recent(s, { x: l.recent.x + 1, w: l.recent.w - 2 }, l.top + 1, height - 2, state);
    } else if (l.bottom - (below + 4) >= 3) {
      s.text(l.x, below + 4, l.w, 'Recent conversations', s.theme.faint);
      recent(s, l, below + 5, l.bottom - (below + 5), state);
    }
  },

  select(s, l, panel) {
    heading(s, l, panel.title, panel.subtitle || 'Choose an option');
    const options = visibleOptions(panel);
    if (panel.search) {
      s.text(l.x, l.top + 2, 2, '›', s.theme.orange);
      if (panel.query) s.text(l.x + 2, l.top + 2, l.w - 3, panel.query + '▏', s.theme.ink);
      else muted(s, l.x + 2, l.top + 2, l.w - 3, 'Type to search');
      if (!options.length) muted(s, l.x + 2, l.top + 4, l.w - 2, 'Nothing matches.');
    }
    const first = l.top + (panel.search ? 4 : 3);
    const visible = Math.max(1, l.bottom - 1 - first);
    const start = scrollWindow(panel.index, options.length, visible);
    options.slice(start, start + visible).forEach(({ option, at }, i) => {
      const y = first + i;
      const active = start + i === panel.index;
      row(s, l, y, active, option.label, { index: start + i });
      const bg = active ? s.theme.selected : s.theme.bg;
      // Matched characters are highlighted, fzf-style, so the ranking reads.
      const chars = graphemes(option.label);
      for (const n of at || [])
        if (n < chars.length)
          s.put(
            l.x + 3 + stringWidth(chars.slice(0, n).join('')),
            y,
            chars[n],
            s.theme.orange,
            bg,
            true,
          );
      if (option.detail) {
        const detail = clipWithEllipsis(option.detail, Math.min(28, Math.floor(l.w / 2)));
        s.text(
          l.x + l.w - 2 - stringWidth(detail),
          y,
          stringWidth(detail),
          detail,
          s.theme.faint,
          bg,
        );
      }
    });
    scrollbar(s, l.x + l.w, first, visible, start, visible, options.length);
    scrollNote(s, l, start, visible, options.length);
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
    const lines = layoutLines(panel.lines, l.w - 2);
    const visible = Math.max(1, l.h - 4);
    const offset = Math.min(panel.scroll, Math.max(0, lines.length - visible));
    drawLines(s, l.x + 1, l.top + 3, l.w - 2, lines.slice(offset, offset + visible));
    scrollbar(s, l.x + l.w, l.top + 3, visible, offset, visible, lines.length);
    scrollNote(s, l, offset, visible, lines.length, '  ·  ↑↓ scroll');
  },

  list(s, l, panel) {
    heading(s, l, panel.title, panel.subtitle || '');
    const table = l.list ? { ...l, ...l.list } : l;
    const top = l.top + 2;
    const height = l.bottom - top;
    s.box(table.x, top, table.w, height);
    // Rows sit inside the frame; the right edge doubles as the scrollbar track.
    const inner = { x: table.x + 1, w: table.w - 2 };
    const rows = visibleRows(panel);
    const visible = Math.max(1, height - 3);
    const start = scrollWindow(panel.index, rows.length, visible);
    const columns = fitColumns(panel.columns, inner.w);
    const widths = columnWidths(columns, inner.w);
    // Headers line up with cell text, which sits after the two-column marker.
    s.text(
      inner.x + 3,
      top + 1,
      inner.w - 4,
      columns.map((c, i) => c.header.padEnd(widths[i]).slice(0, widths[i])).join(' '),
      s.theme.faint,
    );
    if (!rows.length) muted(s, inner.x + 2, top + 2, inner.w - 2, 'Nothing matches this filter.');
    rows.slice(start, start + visible).forEach((r, i) => {
      const text = columns
        .map((_, n) => clipWithEllipsis(r.cells[n], widths[n]).padEnd(widths[n]))
        .join(' ');
      row(s, inner, top + 2 + i, start + i === panel.index, text, { index: start + i });
    });
    scrollbar(s, table.x + table.w - 1, top + 2, visible, start, visible, rows.length);
    // The filter state is always stated, so a short filtered list is never
    // mistaken for the whole account. Both notes sit in the frame's bottom edge.
    const bottom = top + height - 1;
    const filter = panel.filtering
      ? `/${panel.filter}▏`
      : panel.filter
        ? `filter "${panel.filter}" on loaded records`
        : '';
    if (filter)
      s.text(inner.x + 1, bottom, inner.w - 14, ` ${filter} `, s.theme.orange, s.theme.bg);
    const range = rows.length
      ? ` ${start + 1}–${Math.min(start + visible, rows.length)} of ${rows.length} `
      : ' no matches ';
    s.text(table.x + table.w - 2 - range.length, bottom, range.length, range, s.theme.muted);
    if (l.detail && panel.recordKind === 'threads')
      conversation(s, l, top, height, rows[panel.index]);
    else if (l.detail) detail(s, l, top, height, rows[panel.index]);
  },

  transcript(s, l, panel) {
    heading(s, l, panel.thread.name, panel.subtitle);
    const rows = bubbles(panel.thread, l.w - 2);
    const visible = Math.max(1, l.h - 4);
    const offset = Math.min(panel.scroll, Math.max(0, rows.length - visible));
    drawBubbles(s, l.x + 1, l.top + 3, l.w - 2, rows.slice(offset, offset + visible));
    scrollbar(s, l.x + l.w, l.top + 3, visible, offset, visible, rows.length);
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
    s.fill(l.x, y + 2, l.w, visible, s.theme.panel);
    const offset = Math.min(panel.scroll, Math.max(0, lines.length - visible));
    lines
      .slice(offset, offset + visible)
      .forEach((t, i) => s.put(l.x + 2, y + 2 + i, t, s.theme.ink, s.theme.panel));
    if (lines.length > visible)
      muted(
        s,
        l.x,
        y + 2 + visible,
        l.w,
        `line ${offset + 1}–${Math.min(offset + visible, lines.length)} of ${lines.length}`,
      );
    if (panel.outcome === 'unknown')
      button(s, l.x, l.bottom - 2, l.w, 'Keep draft  Esc', s.theme.hot);
    else if (!panel.outcome) button(s, l.x, l.bottom - 2, l.w, 'Send text  ↵');
  },

  appearance(s, l, panel, state) {
    const selected = logoById(state.logo);
    s.text(l.x, l.top, l.w, 'Appearance', s.theme.ink, s.theme.bg, true);
    const rows = [
      ['Wordmark', `${logos.indexOf(selected) + 1}/${logos.length}  ${selected.name}`],
      ['Motion', MOTION[state.motion]],
      ['Effect', EFFECTS[state.effect]],
      ['Theme', THEMES[state.theme]],
      ['Replay', ''],
      ['Save appearance', ''],
    ];
    const split = l.w < 45 ? 18 : 24;
    rows.forEach(([name, value], i) => {
      const y = l.top + 2 + i;
      const active = panel.index === i;
      if (active) s.fill(l.x, y, l.w, 1, s.theme.selected);
      const bg = active ? s.theme.selected : s.theme.bg;
      s.text(
        l.x + 1,
        y,
        split - 1,
        (active ? '▌ ' : '  ') + name,
        active ? s.theme.ink : s.theme.muted,
        bg,
      );
      const shown = i < 4 ? `‹ ${value} ›` : value;
      s.text(l.x + split, y, l.w - split, shown, active ? s.theme.hot : s.theme.muted, bg, active);
      if (active && s.themeName === 'terminal') s.reverse(l.x, y, l.w);
    });
    if (l.h >= 10) muted(s, l.x, l.top + 9, l.w, clipWithEllipsis(selected.description, l.w));
  },

  help(s, l, panel) {
    heading(s, l, 'Keyboard shortcuts', 'Esc closes this list');
    const visible = Math.max(1, l.h - 4);
    const offset = Math.min(panel.scroll, Math.max(0, panel.lines.length - visible));
    panel.lines.slice(offset, offset + visible).forEach(([keys, what], i) => {
      const y = l.top + 3 + i;
      if (!what) {
        s.text(l.x, y, l.w, keys, s.theme.orange);
        return;
      }
      s.text(l.x + 1, y, 18, keys, s.theme.ink, s.theme.bg, true);
      muted(s, l.x + 19, y, l.w - 19, what);
    });
    scrollbar(s, l.x + l.w, l.top + 3, visible, offset, visible, panel.lines.length);
    scrollNote(s, l, offset, visible, panel.lines.length);
  },
};

/** The selected record beside a wide list, framed like the table it describes. */
function detail(s, l, top, height, selected) {
  const { x, w } = l.detail;
  s.box(x, top, w, height, 'Details');
  if (!selected) return;
  s.text(x + 2, top + 1, w - 4, selected.title, s.theme.ink, s.theme.bg, true);
  const lines = layoutLines(detailLines(selected.record), w - 4);
  const room = Math.max(0, height - 4);
  drawLines(s, x + 2, top + 3, w - 4, lines.slice(0, room));
  if (lines.length > room)
    s.text(x + 2, top + height - 1, w - 4, ' Enter for full details ', s.theme.muted);
}

/** Home's recent threads: who, when, and the last thing said. */
function recent(s, area, y, rows, state) {
  const say = (text) => muted(s, area.x + 2, y, area.w - 4, text);
  if (state.recent == null) return say(state.recentError || 'Loading…');
  if (!state.recent.length) return say('No messages in the last 7 days.');
  const who = Math.min(18, Math.floor(area.w / 3));
  state.recent.slice(0, rows).forEach((thread, i) => {
    const last = thread.messages.at(-1) || {};
    const when = last.at ? ago(last.at) : '';
    const text = [
      clipWithEllipsis(thread.name, who - 1).padEnd(who),
      when.padEnd(9),
      (last.inbound ? '' : 'You: ') + (last.text ?? ''),
    ].join('');
    const active = state.focus === 'recent' && state.recentIndex === i;
    row(s, area, y + i, active, clipWithEllipsis(text, area.w - 4), { group: 'recent', index: i });
  });
}

/** The selected thread beside the list, scrolled to its latest message. */
function conversation(s, l, top, height, selected) {
  const { x, w } = l.detail;
  s.box(x, top, w, height, 'Conversation');
  if (!selected) return;
  s.text(x + 2, top + 1, w - 4, selected.title, s.theme.ink, s.theme.bg, true);
  const rows = bubbles(selected.record, w - 4);
  const room = Math.max(0, height - 4);
  drawBubbles(s, x + 2, top + 3, w - 4, rows.slice(Math.max(0, rows.length - room)));
}

/**
 * Chat layout: customer messages on the left, your side on the right, each
 * under a faint sender and time. Returns rows so callers can scroll them.
 */
export function bubbles(thread, width) {
  const widest = Math.max(12, Math.floor(width * 0.72));
  const rows = [];
  for (const m of thread.messages) {
    const lines = wrap(String(m.text ?? ''), widest - 2);
    const size = Math.max(...lines.map(stringWidth)) + 2;
    const meta = [m.sender || 'Unknown', m.at ? ago(m.at) : ''].filter(Boolean).join(' · ');
    const align = (w) => (m.inbound ? 0 : Math.max(0, width - w));
    rows.push({ x: align(stringWidth(meta)), text: meta, meta: true });
    for (const text of lines) rows.push({ x: align(size), w: size, text, inbound: m.inbound });
    rows.push({ x: 0, text: '' });
  }
  return rows;
}

function drawBubbles(s, x, y, w, rows) {
  const theirs = s.theme.selected;
  const ours = mix(s.theme.bg, s.theme.orange, 0.3);
  rows.forEach((r, i) => {
    if (r.meta) return s.text(x + r.x, y + i, w - r.x, r.text, s.theme.faint);
    if (r.w == null) return;
    const bg = r.inbound ? theirs : ours;
    s.fill(x + r.x, y + i, r.w, 1, bg);
    s.text(x + r.x + 1, y + i, r.w - 2, r.text, s.theme.ink, bg);
  });
}

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

const THEMES = {
  dark: 'Dark',
  light: 'Light',
  terminal: 'Terminal colors',
  'high-contrast': 'High contrast',
};

function drawField(s, l, panel, field, index, y, height) {
  const active = index === panel.index;
  const inside = (row) => row >= l.top + 3 && row < l.bottom - 1;
  const value = panel.values[field.key] || '';
  const title = field.multiline
    ? `${field.label} · ${length(value)} / ${MESSAGE_LIMIT}`
    : field.label;
  if (inside(y))
    s.text(l.x, y, l.w, clipWithEllipsis(title, l.w), active ? s.theme.orange : s.theme.muted);
  for (let n = 0; n < height - 1; n++) if (inside(y + n)) s.hit(l.x, y + n, l.w, { index });
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
    const bg = active ? s.theme.selected : s.theme.panel;
    s.fill(l.x, row, l.w, 1, bg);
    const text = lines[offset + n];
    const chosen = field.pick && !field.editable;
    const placeholder =
      !value && n === 0 ? field.placeholder || (chosen ? 'Enter to choose' : '') : '';
    s.text(l.x + 2, row, l.w - 4, text ?? placeholder, value ? s.theme.ink : s.theme.faint, bg);
    // Chosen-only fields show a list marker instead of a caret.
    if (chosen) s.put(l.x + l.w - 3, row, '▾', active ? s.theme.orange : s.theme.faint, bg);
    else if (active && offset + n === caret.row)
      s.put(l.x + 2 + Math.min(caret.column, l.w - 5), row, '▏', s.theme.orange, bg);
    if (active && s.themeName === 'terminal') s.reverse(l.x, row, l.w);
  }
}

/** Leading columns that fit at their preferred width; never fewer than two. */
function fitColumns(columns, width) {
  let used = 4;
  return columns.filter((c, i) => (used += c.width + 1) <= width || i < 2);
}

/** Column widths shrink proportionally so a narrow terminal still shows every column. */
function columnWidths(columns, width) {
  const available = width - 4 - (columns.length - 1);
  const wanted = columns.reduce((a, c) => a + c.width, 0);
  // Spare room goes to the flexible column, or the last one.
  const marked = columns.findIndex((c) => c.flex);
  const flex = marked < 0 ? columns.length - 1 : marked;
  if (wanted <= available)
    return columns.map((c, i) => c.width + (i === flex ? available - wanted : 0));
  const scale = available / wanted;
  return columns.map((c) => Math.max(6, Math.floor(c.width * scale)));
}

/**
 * A searchable selection's options, best match first. Earlier and tighter
 * matches rank higher; without a query the original order stands.
 */
export function visibleOptions(panel) {
  if (!panel.query) return panel.options.map((option) => ({ option, at: null }));
  return panel.options
    .map((option) => ({ option, at: fuzzy(panel.query, `${option.label} ${option.detail || ''}`) }))
    .filter((m) => m.at)
    .sort((a, b) => spread(a.at) - spread(b.at));
}

const spread = (at) => at.at(-1) - at[0] + at[0] / 100;

export const visibleRows = (panel) =>
  panel.filter
    ? panel.rows.filter((r) => r.search.includes(panel.filter.toLowerCase()))
    : panel.rows;
