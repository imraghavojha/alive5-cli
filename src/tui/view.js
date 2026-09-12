import { Screen, theme, clip, wrap } from './screen.js';
import { drawLogo, logoHeight } from './logo.js';
import { VERSION } from '../core.js';

export const navigation = [
  {
    id: 'send',
    label: 'Compose a text',
    icon: '↗',
    eyebrow: 'ONE GOOD CONVERSATION',
    title: 'Make the first move.',
    description:
      'Send a text from your Alive5 number. Choose a channel and teammate, write your message, then review it before sending.',
    action: 'Compose a message',
    code: 'alive5 sms send --help',
  },
  {
    id: 'messages',
    label: 'Recent messages',
    icon: '≋',
    eyebrow: 'PICK UP THE THREAD',
    title: 'See what was said.',
    description:
      'Read recent SMS messages across your workspace, including conversations that started earlier.',
    action: 'Choose a date range',
    code: 'alive5 sms list --help',
  },
  {
    id: 'history',
    label: 'Conversations',
    icon: '◫',
    eyebrow: 'THE WHOLE CONVERSATION',
    title: 'A little more context.',
    description:
      'Read full SMS, live chat, and Facebook Messenger transcripts by conversation start date.',
    action: 'Browse transcripts',
    code: 'alive5 conversations list --help',
  },
  {
    id: 'directory',
    label: 'Your workspace',
    icon: '⌘',
    eyebrow: 'PEOPLE, NUMBERS, CONTEXT',
    title: 'Everyone in one place.',
    description:
      'Find your channels, teammates, contacts, and tags. IDs stay visible when you need them.',
    action: 'Explore your workspace',
    code: 'alive5 channels list --json',
  },
  {
    id: 'agents',
    label: 'For AI agents',
    icon: '⟩',
    eyebrow: 'READY FOR YOUR AGENT',
    title: 'Same tools. Clear output.',
    description:
      'Discover commands, preview requests, and parse predictable JSON. The command interface stays quiet and never prompts when piped.',
    action: 'Read the quick start',
    code: 'alive5 schema',
  },
  {
    id: 'appearance',
    label: 'Appearance',
    icon: '◈',
    eyebrow: 'A LITTLE CHARACTER',
    title: 'Set the mood.',
    description:
      'Choose how the logo moves. Replay its entrance, try a different effect, or keep everything still.',
    action: 'Tune the animation',
    code: 'alive5 --no-animation',
  },
];
export function layout(width, height, task = false) {
  const compact = width < 74 || height < 26;
  const logoWidth = compact ? 28 : task ? 38 : width >= 96 && height >= 34 ? 62 : 48;
  const header = height < 22 ? 4 : logoHeight(logoWidth) + 2;
  const left = 2,
    top = header + 1,
    bottom = height - 4;
  const sidebar = !compact ? 25 : 0;
  return {
    compact,
    logoWidth,
    header,
    left,
    top,
    bottom,
    sidebar,
    x: left + sidebar + (sidebar ? 3 : 0),
    w: width - left * 2 - sidebar - (sidebar ? 3 : 0),
    h: bottom - top,
  };
}
const label = (s, x, y, w, text) => s.text(x, y, w, text, theme.muted);
function paragraph(s, x, y, w, text, fg = theme.muted, max = Infinity, bg = theme.bg) {
  const lines = wrap(text, w);
  lines.slice(0, max).forEach((line, i) => s.put(x, y + i, line, fg, bg));
  return lines.length;
}
function button(s, x, y, w, text, active = true) {
  s.fill(x, y, Math.min(w, text.length + 6), 1, active ? theme.orange : theme.selected);
  s.text(
    x + 2,
    y,
    w - 3,
    text,
    active ? '#fff8f0' : theme.ink,
    active ? theme.orange : theme.selected,
    true,
  );
}
export function view(state, width, height, time = 0) {
  const s = new Screen(width, height),
    l = layout(width, height, !['home', 'appearance'].includes(state.panel.kind));
  if (width < 40 || height < 24) {
    s.text(2, 2, width - 4, 'alive5', theme.orange);
    s.text(2, 4, width - 4, 'Resize to at least 40 × 24.');
    s.text(2, 6, width - 4, 'Ctrl+C to exit', theme.muted);
    return s;
  }
  const motion = state.panel.kind === 'form' ? 'off' : state.motion;
  if (height >= 22) {
    drawLogo(s, {
      x: 3,
      y: 1,
      width: l.logoWidth,
      time,
      entrance: state.entrance,
      motion,
      effect: state.effect,
    });
    const infoX = l.logoWidth + 9,
      infoWidth = width - infoX - 3;
    if (infoWidth >= 20) {
      s.text(infoX, 3, infoWidth, 'CONVERSATION CONSOLE', theme.faint);
      s.text(infoX, 5, infoWidth, state.account?.org_name || 'Your next conversation', theme.ink);
      s.text(
        infoX,
        7,
        infoWidth,
        state.busy
          ? '◌  ' + state.busy
          : state.account
            ? '●  Connected to Alive5'
            : '○  Connect your workspace',
        theme.muted,
      );
      if (logoHeight(l.logoWidth) > 9)
        s.text(infoX, 9, infoWidth, 'Every conversation matters.', theme.muted);
    }
  } else {
    s.put(2, 1, 'alive5', theme.orange, theme.bg, true);
    s.text(11, 1, width - 14, state.account?.org_name || 'Connect your workspace', theme.muted);
  }
  s.line(2, l.header, width - 4);
  const panel = state.panel;
  if (l.sidebar) {
    label(s, 4, l.top, 22, 'WORKSPACE');
    navigation.forEach((n, i) => {
      const row = l.top + 2 + i * 2;
      if (row >= l.bottom) return;
      const active = state.nav === i;
      if (active) {
        s.fill(2, row, 24, 1, theme.selected);
        s.put(2, row, '▌', theme.orange, theme.selected);
      }
      s.text(
        4,
        row,
        21,
        n.icon + '  ' + n.label,
        active ? theme.ink : theme.muted,
        active ? theme.selected : theme.bg,
      );
    });
    for (let y = l.top; y < l.bottom; y++) s.put(27, y, '│', theme.line);
  }
  const x = l.x + 2,
    w = l.w - 4,
    y = l.top;
  if (panel.kind === 'home') {
    if (l.compact) {
      s.text(x, y, w, 'Your workspace', theme.ink, theme.bg, true);
      const visible = Math.min(navigation.length, l.h - 2),
        start = Math.max(0, state.nav - visible + 1);
      navigation.slice(start, start + visible).forEach((n, i) => {
        const row = y + 2 + i,
          active = start + i === state.nav;
        if (active) s.fill(x, row, w, 1, theme.selected);
        s.text(
          x + 1,
          row,
          w - 2,
          (active ? '› ' : '  ') + n.label,
          active ? theme.orange : theme.muted,
          active ? theme.selected : theme.bg,
        );
      });
    } else {
      const n = navigation[state.nav];
      label(s, x, y, w, n.eyebrow);
      s.text(x, y + 2, w, n.title, theme.ink, theme.bg, true);
      paragraph(s, x, y + 4, Math.min(w - 2, 53), n.description, theme.muted, 4);
      button(s, x, Math.min(y + 9, l.bottom - 4), w, n.action + '  ↵');
      s.text(x, Math.min(y + 11, l.bottom - 2), w, n.code, theme.muted);
    }
  } else if (panel.kind === 'select') {
    s.text(x, y, w, panel.title, theme.ink, theme.bg, true);
    label(s, x, y + 1, w, panel.subtitle || 'Choose an option');
    const visible = Math.max(1, l.h - 4),
      start = Math.max(0, panel.index - visible + 1);
    panel.options.slice(start, start + visible).forEach((item, i) => {
      const active = start + i === panel.index,
        row = y + 3 + i;
      if (active) s.fill(x, row, w, 1, theme.selected);
      s.text(
        x + 1,
        row,
        w - 2,
        (active ? '› ' : '  ') + item.label,
        active ? theme.ink : theme.muted,
        active ? theme.selected : theme.bg,
      );
    });
    if (panel.options.length > visible)
      label(
        s,
        x,
        l.bottom - 1,
        w,
        `${start + 1}–${Math.min(start + visible, panel.options.length)} of ${panel.options.length}`,
      );
  } else if (panel.kind === 'form') {
    s.text(x, y, w, panel.title, theme.ink, theme.bg, true);
    label(s, x, y + 1, w, panel.subtitle || 'Tab to move between fields');
    const available = l.h - 4;
    const heights = panel.fields.map((f) => (f.multiline ? 5 : 3));
    let focusY = heights.slice(0, panel.index).reduce((a, b) => a + b, 0);
    const offset = Math.max(0, focusY + heights[panel.index] - available);
    let row = y + 3 - offset;
    panel.fields.forEach((f, i) => {
      const active = i === panel.index;
      const boxHeight = heights[i] - 1;
      if (row >= y + 3 && row < l.bottom - 1)
        s.text(
          x,
          row,
          w,
          f.multiline ? `${f.label} · ${(panel.values[f.key] || '').length} / 1600` : f.label,
          active ? theme.orange : theme.muted,
        );
      const val = panel.values[f.key] || '';
      const display = f.secret ? '•'.repeat(Math.min(val.length, 80)) : val;
      const lines = wrap(display || f.placeholder || '', w - 4);
      for (let n = 0; n < boxHeight - 1; n++) {
        const yy = row + 1 + n;
        if (yy < y + 3 || yy >= l.bottom - 1) continue;
        s.fill(x, yy, w, 1, active ? theme.selected : theme.panel);
        const shown = lines.length > boxHeight - 1 ? lines.slice(-(boxHeight - 1)) : lines;
        s.text(
          x + 2,
          yy,
          w - 4,
          (shown[n] || '') + (active && n === Math.min(shown.length - 1, boxHeight - 2) ? '▏' : ''),
          val ? theme.ink : theme.faint,
          active ? theme.selected : theme.panel,
        );
      }
      row += heights[i];
    });
    s.text(
      x,
      l.bottom - 1,
      w,
      panel.fields[panel.index].multiline ? 'Ctrl+J for a new line · Enter to review' : '',
      theme.muted,
    );
  } else if (panel.kind === 'preview') {
    s.text(x, y, w, 'Review your message', theme.ink, theme.bg, true);
    label(s, x, y + 1, w, 'Nothing has been sent.');
    label(s, x, y + 3, 6, 'FROM');
    s.text(x + 6, y + 3, w - 6, panel.form.from);
    label(s, x, y + 4, 6, 'TO');
    s.text(x + 6, y + 4, w - 6, panel.form.to);
    const lines = wrap(panel.form.message, w - 4),
      visible = Math.max(1, l.h - 11);
    label(s, x, y + 6, w, `MESSAGE  ·  ${panel.form.message.length} / 1600 characters`);
    s.fill(x, y + 7, w, visible, theme.panel);
    lines
      .slice(panel.scroll, panel.scroll + visible)
      .forEach((t, i) => s.put(x + 2, y + 7 + i, t, theme.ink, theme.panel));
    button(s, x, l.bottom - 2, w, 'Send this text  ↵');
    s.text(x + 25, l.bottom - 2, w - 25, 'Esc to edit', theme.muted);
  } else if (panel.kind === 'reader') {
    s.text(x, y, w, panel.title, theme.ink, theme.bg, true);
    label(s, x, y + 1, w, panel.subtitle || '');
    const lines = panel.lines.flatMap((t) => wrap(t, w - 2));
    const visible = Math.max(1, l.h - 4);
    const offset = Math.min(panel.scroll, Math.max(0, lines.length - visible));
    lines
      .slice(offset, offset + visible)
      .forEach((text, i) =>
        s.text(x + 1, y + 3 + i, w - 2, text, text.startsWith('›') ? theme.orange : theme.ink),
      );
    if (lines.length > visible)
      label(
        s,
        x,
        l.bottom - 1,
        w,
        `${offset + 1}–${Math.min(offset + visible, lines.length)} / ${lines.length}  ·  ↑↓ scroll`,
      );
  } else if (panel.kind === 'appearance') {
    s.text(x, y, w, 'Motion studio', theme.ink, theme.bg, true);
    label(s, x, y + 1, w, 'The logo above is your live preview.');
    const rows = [
      [
        'Motion',
        '‹ ' +
          (state.motion === 'full' ? 'Full' : state.motion === 'subtle' ? 'Entrance only' : 'Off') +
          ' ›',
      ],
      [
        'Effect',
        '‹ ' +
          { signal: 'Signal sweep', breathe: 'Slow glow', orbit: 'Orbit' }[state.effect] +
          ' ›',
      ],
      ['↻ Replay entrance', 'Enter ↵'],
      ['Save appearance', 'Enter ↵'],
    ];
    rows.forEach(([name, value], i) => {
      const yy = y + 3 + i * 2,
        active = panel.index === i;
      if (yy >= l.bottom - 2) return;
      if (active) s.fill(x, yy, w, 1, theme.selected);
      s.text(
        x + 1,
        yy,
        Math.min(20, w / 2),
        name,
        active ? theme.ink : theme.muted,
        active ? theme.selected : theme.bg,
      );
      s.text(
        x + Math.min(22, Math.floor(w / 2)),
        yy,
        w / 2 - 2,
        value,
        active ? theme.orange : theme.muted,
        active ? theme.selected : theme.bg,
      );
    });
    paragraph(
      s,
      x,
      l.bottom - 3,
      w,
      {
        signal: 'A quiet light passes across the lettering.',
        breathe: 'Slow, warm light. No moving particles.',
        orbit: 'A few embers trace the edge of the mark.',
      }[state.effect],
      theme.faint,
      2,
    );
  }
  s.line(2, height - 3, width - 4);
  const error = state.error;
  s.text(
    2,
    height - 2,
    width - 4,
    error ||
      state.notice ||
      (panel.kind === 'home'
        ? width < 65
          ? '↑↓ · Enter open · a style · q quit'
          : '↑↓ navigate · Enter open · a appearance · q quit'
        : '') ||
      (width < 65
        ? panel.kind === 'form'
          ? 'Esc back · Tab next · Enter continue'
          : 'Esc back · ↑↓ move · Enter · q quit'
        : '') ||
      (panel.kind === 'form'
        ? 'Esc back  ·  Tab next  ·  Enter continue  ·  Ctrl+U clear'
        : panel.kind === 'preview'
          ? 'Enter send  ·  Esc edit  ·  ↑↓ scroll  ·  q quit'
          : panel.kind === 'appearance'
            ? '↑↓ choose  ·  ←→ change  ·  r replay  ·  Space pause  ·  Esc back'
            : '↑↓ navigate  ·  Enter open  ·  Esc back  ·  a appearance  ·  q quit'),
    error ? theme.hot : theme.muted,
  );
  s.text(
    2,
    height - 1,
    width - 4,
    state.busy
      ? '◌ ' + state.busy
      : state.motion === 'off'
        ? 'Motion off'
        : 'alive5  /  ' + { signal: 'signal', breathe: 'glow', orbit: 'orbit' }[state.effect],
    theme.faint,
  );
  s.text(
    Math.max(2, width - 2 - ('v' + VERSION).length),
    height - 1,
    ('v' + VERSION).length,
    'v' + VERSION,
    theme.faint,
  );
  return s;
}
