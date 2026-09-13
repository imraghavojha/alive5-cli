import { Screen, theme, wrap } from './screen.js';
import { drawLogo, logos } from './logo.js';
import { VERSION } from '../core.js';

export const navigation = [
  {
    id: 'send',
    label: 'Compose a text',
    description: 'Write a message and review before sending.',
    code: 'alive5 sms send --help',
  },
  {
    id: 'messages',
    label: 'Recent messages',
    description: 'Read incoming and outgoing SMS.',
    code: 'alive5 sms list --help',
  },
  {
    id: 'history',
    label: 'Conversations',
    description: 'Browse SMS, chat, and Messenger transcripts.',
    code: 'alive5 conversations list --help',
  },
  {
    id: 'directory',
    label: 'Workspace',
    description: 'Find channels, teammates, contacts, and tags.',
    code: 'alive5 channels list --json',
  },
  {
    id: 'agents',
    label: 'Agent quick start',
    description: 'Command discovery, previews, and JSON output.',
    code: 'alive5 schema',
  },
  {
    id: 'appearance',
    label: 'Appearance',
    description: 'Choose from eight logos and preview their motion.',
    code: 'alive5 --no-animation',
  },
];
export function layout(width, height, task = false, homeLogo = null) {
  const left = 3;
  const w = Math.min(78, width - left * 2);
  const header = task ? 3 : homeLogo === 'type' ? 6 : homeLogo === 'frame' ? 8 : 10;
  const top = header + 1;
  const bottom = height - 3;
  return {
    compact: width < 65,
    logoWidth: Math.min(52, w),
    logoHeight: header - 3,
    header,
    left,
    top,
    bottom,
    sidebar: 0,
    x: left,
    w,
    h: bottom - top,
  };
}
const label = (s, x, y, w, text) => s.text(x, y, w, text, theme.muted);
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
    l = layout(
      width,
      height,
      !['home', 'appearance'].includes(state.panel.kind),
      state.panel.kind === 'home' ? state.logo : null,
    );
  if (width < 40 || height < 24) {
    s.text(2, 2, width - 4, 'alive5', theme.orange);
    s.text(2, 4, width - 4, 'Resize to at least 40 × 24.');
    s.text(2, 6, width - 4, 'Ctrl+C to exit', theme.muted);
    return s;
  }
  const panel = state.panel;
  const task = !['home', 'appearance'].includes(panel.kind);
  if (task) {
    s.text(3, 1, l.w, 'Alive 5', theme.ink, theme.bg, true);
    s.text(12, 1, l.w - 9, state.account?.org_name || 'Connect your workspace', theme.muted);
  } else s.text(3, 1, l.w, state.account?.org_name || 'Connect your workspace', theme.muted);
  if (!task)
    drawLogo(s, {
      x: 3,
      y: 3,
      width: l.logoWidth,
      height: l.logoHeight,
      time,
      motion: state.motion,
      effect: state.effect,
      variant: state.logo,
    });
  const x = l.x,
    w = l.w,
    y = l.top;
  if (panel.kind === 'home') {
    navigation.forEach((n, i) => {
      const active = state.nav === i;
      const row = y + i;
      if (active) s.fill(x, row, w, 1, theme.selected);
      s.text(
        x + 1,
        row,
        w - 2,
        `${active ? '›' : ' '} ${i + 1}  ${n.label}`,
        active ? theme.ink : theme.muted,
        active ? theme.selected : theme.bg,
        active,
      );
    });
    if (l.h >= 9) label(s, x, y + 7, w, navigation[state.nav].description);
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
    const simpleRows = panel.fields.filter((field) => !field.multiline).length * 3;
    const heights = panel.fields.map((f) =>
      f.multiline ? Math.max(5, Math.min(10, available - simpleRows)) : 3,
    );
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
  } else if (panel.kind === 'preview') {
    s.text(x, y, w, 'Review your message', theme.ink, theme.bg, true);
    label(s, x, y + 1, w, 'Nothing has been sent.');
    label(s, x, y + 3, 6, 'From');
    s.text(x + 6, y + 3, w - 6, panel.form.from);
    label(s, x, y + 4, 6, 'To');
    s.text(x + 6, y + 4, w - 6, panel.form.to);
    const lines = wrap(panel.form.message, w - 4),
      visible = Math.max(1, l.h - 11);
    label(s, x, y + 6, w, `Message · ${panel.form.message.length} / 1600 characters`);
    s.fill(x, y + 7, w, visible, theme.panel);
    lines
      .slice(panel.scroll, panel.scroll + visible)
      .forEach((t, i) => s.put(x + 2, y + 7 + i, t, theme.ink, theme.panel));
    button(s, x, l.bottom - 2, w, 'Send text  ↵');
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
    const selected = logos.find((logo) => logo.id === state.logo) || logos[0];
    const number = logos.indexOf(selected) + 1;
    s.text(x, y, w, 'Appearance', theme.ink, theme.bg, true);
    const rows = [
      ['Logo', `${number}/8  ${selected.name}`],
      [
        'Motion',
        { full: 'Continuous', subtle: w < 45 ? 'Once' : 'Entrance only', off: 'Off' }[state.motion],
      ],
      [
        'Effect',
        { signal: 'Light sweep', breathe: 'Slow glow', orbit: 'Star drift' }[state.effect],
      ],
      ['Replay', ''],
      ['Save appearance', ''],
    ];
    rows.forEach(([name, value], i) => {
      const yy = y + 2 + i,
        active = panel.index === i;
      if (active) s.fill(x, yy, w, 1, theme.selected);
      const split = w < 45 ? 18 : 24;
      const bg = active ? theme.selected : theme.bg;
      s.text(
        x + 1,
        yy,
        split - 1,
        (active ? '› ' : '  ') + name,
        active ? theme.ink : theme.muted,
        bg,
      );
      const shown = i < 3 && active ? `‹ ${value.replace('  ', ' ')} ›` : value;
      s.text(x + split, yy, w - split, shown, active ? theme.orange : theme.muted, bg);
    });
    if (l.h >= 9) label(s, x, y + 8, w, selected.description);
  }
  s.line(3, height - 3, l.w);
  const narrow = l.w < 60;
  const messageField = panel.kind === 'form' && panel.fields[panel.index].multiline;
  const hints = {
    home: narrow
      ? '↑↓ · Enter open · a style · q quit'
      : '↑↓ or 1–6 select · Enter open · a appearance · q quit',
    appearance: narrow
      ? panel.index >= 3
        ? `Enter ${panel.index === 3 ? 'replay' : 'save'} · ↑↓ row · Esc back`
        : '↑↓ row · ←→ change · Esc back'
      : '↑↓ row · ←→ change · Enter apply · Esc back',
    form: messageField
      ? 'Tab next · Enter review · Esc back'
      : narrow
        ? 'Tab next · Enter · Esc back'
        : 'Tab next · Enter continue · Esc back',
    preview: 'Enter send · Esc edit · ↑↓ scroll',
    reader: narrow ? '↑↓ scroll · Esc back · q quit' : '↑↓ scroll · PgUp/PgDn · Esc back · q quit',
    select: '↑↓ select · Enter open · Esc back',
  };
  s.text(
    3,
    height - 2,
    l.w,
    state.error || state.notice || hints[panel.kind] || '',
    state.error ? theme.hot : theme.muted,
  );
  const secondary =
    panel.kind === 'appearance'
      ? narrow
        ? '1–8 logo · s save'
        : '1–8 logo · Space pause motion · r replay · s save'
      : panel.kind === 'form'
        ? messageField
          ? 'Ctrl+J new line'
          : 'Ctrl+U clear'
        : state.busy
          ? '◌ ' + state.busy
          : '';
  s.text(3, height - 1, l.w - 9, secondary, theme.faint);
  s.text(
    3 + l.w - ('v' + VERSION).length,
    height - 1,
    ('v' + VERSION).length,
    'v' + VERSION,
    theme.faint,
  );
  return s;
}
