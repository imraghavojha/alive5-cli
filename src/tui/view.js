// Screen assembly: the fixed header, the panel, and the fixed footer. Panel
// bodies live in ./panels.js; this file owns only the chrome around them.

import { Screen } from './screen.js';
import { wrap, stringWidth } from './text.js';
import { WORDMARK, drawLogo } from './logo.js';
import { layout, showsBanner, MIN_WIDTH, MIN_HEIGHT } from './layout.js';
import { panels } from './panels.js';
import { VERSION } from '../meta.js';

export { navigation, layout } from './layout.js';

/** Shortcut lines per panel, wide first and narrow as a fallback. */
const HINTS = {
  home: [
    '↑↓ select · Enter open · Ctrl+K commands · a appearance · ? help · q quit',
    '↑↓ · Enter · Ctrl+K · ? · q',
  ],
  appearance: ['↑↓ row · ←→ change · Enter apply · Esc back', '↑↓ row · ←→ change · Esc back'],
  form: ['←→ move · Tab next field · Enter continue · Esc back', 'Tab next · Enter · Esc back'],
  preview: ['Enter send · Esc edit · ↑↓ scroll', 'Enter send · Esc edit'],
  reader: ['↑↓ scroll · PgUp/PgDn · Esc back · q quit', '↑↓ scroll · Esc back · q'],
  list: ['↑↓ select · Enter open · / filter · ? help · Esc back', '↑↓ · Enter · / filter · Esc'],
  transcript: ['↑↓ scroll · r reply · ? help · Esc back', '↑↓ · r reply · Esc'],
  select: ['↑↓ select · Enter choose · Esc back', '↑↓ · Enter · Esc back'],
  help: ['↑↓ scroll · Esc close', '↑↓ · Esc close'],
};

const SPINNER = '⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏';

/** The second footer line: the busy indicator first, otherwise context-specific keys. */
function secondary(state, panel, narrow) {
  if (state.busy) return `${SPINNER[state.tick % SPINNER.length]} ${state.busy}…`;
  if (panel.kind === 'appearance')
    return narrow
      ? '1–8 wordmark · s save'
      : '1–8 wordmark · Space pause motion · r replay · s save';
  if (panel.kind === 'form') {
    const field = panel.fields[panel.index];
    const editing = 'Home/End · Ctrl+U clear · Ctrl+W word';
    if (field.pick && !field.editable) return 'Ctrl+F change · or type to search';
    if (field.pick) return narrow ? 'Ctrl+F find contact' : `Ctrl+F find contact · ${editing}`;
    if (narrow)
      return field.multiline ? 'Ctrl+J newline · Ctrl+U clear' : 'Home/End · Ctrl+U clear';
    return field.multiline ? `Ctrl+J new line · ${editing}` : editing;
  }
  if (panel.kind === 'list')
    return [
      panel.recordKind === 'threads' ? 'r reply' : '',
      panel.recordKind === 'contacts' ? (narrow ? 'm message' : 'm message this contact') : '',
      narrow ? 'y copy' : 'y copy value',
      panel.next ? 'n next page' : '',
    ]
      .filter(Boolean)
      .join(' · ');
  return '';
}

export function view(state, width, height, time = 0) {
  const s = new Screen(width, height, state.theme);
  const panel = state.panel;
  const l = layout(width, height, panel.kind, state.logo);
  if (l.tooSmall) {
    s.text(2, 2, width - 4, WORDMARK.toLowerCase(), s.theme.orange);
    s.text(2, 4, width - 4, `Resize to at least ${MIN_WIDTH} × ${MIN_HEIGHT}.`);
    s.text(2, 6, width - 4, 'Ctrl+C to exit', s.theme.muted);
    return s;
  }
  const workspaceName = state.account?.org_name || 'Connect your workspace';
  if (state.notice) toast(s, l, state.notice, stringWidth(workspaceName));
  if (showsBanner(panel.kind)) {
    s.text(3, 1, l.w, workspaceName, s.theme.muted);
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
  } else {
    // Task screens keep a single-line header so the panel gets the height.
    s.text(3, 1, l.w, WORDMARK, s.theme.ink, s.theme.bg, true);
    s.text(3 + WORDMARK.length + 2, 1, l.w - WORDMARK.length - 2, workspaceName, s.theme.muted);
  }
  panels[panel.kind]?.(s, l, panel, state);
  footer(s, state, panel, l, width, height);
  return s;
}

/** Notices appear at the header's right edge and fade on the next key or after a moment. */
function toast(s, l, notice, reserved) {
  // Leave the wordmark and workspace name on the left untouched.
  const room = l.w - reserved - WORDMARK.length - 6;
  const text = wrap(notice, Math.max(10, room - 2))[0];
  const x = 3 + l.w - stringWidth(text) - 2;
  s.put(x, 1, '●', s.theme.orange);
  s.text(x + 2, 1, stringWidth(text), text, s.theme.ink);
}

/**
 * Shortcut hints written as "key what · key what". Keys are drawn bright and
 * their descriptions dim, so the eye finds the key first.
 */
function keys(s, x, y, w, hint) {
  let at = x;
  const write = (text, fg, bold = false) => {
    if (!text || at >= x + w) return;
    s.text(at, y, x + w - at, text, fg, s.theme.bg, bold);
    at += stringWidth(text);
  };
  hint.split(' · ').forEach((part, i) => {
    const [key, ...what] = part.split(' ');
    write(i ? '  ' : '', s.theme.faint);
    write(key, s.theme.ink, true);
    write(what.length ? ' ' + what.join(' ') : '', s.theme.faint);
  });
}

/**
 * The status area holds an error or the panel's shortcuts. Errors are wrapped
 * over the available lines instead of being clipped mid-sentence.
 */
function footer(s, state, panel, l, width, height) {
  const narrow = l.narrow;
  let hint = HINTS[panel.kind]?.[narrow ? 1 : 0] || '';
  if (s.hits.some((h) => h.group === 'recent'))
    hint = hint.replace('Enter open', 'Enter open · Tab recent');
  const lines = state.error ? wrap(state.error, l.w).slice(0, 2) : [hint];
  // A two-line message borrows the rule's row so the panel never shifts.
  const ruleRow = height - 3 - (lines.length > 1 ? 1 : 0);
  s.line(3, ruleRow, l.w);
  lines.forEach((text, i) => {
    const y = height - 2 - (lines.length - 1) + i;
    if (state.error) s.text(3, y, l.w, text, s.theme.hot);
    else keys(s, 3, y, l.w, text);
  });
  const version = 'v' + VERSION;
  const extra = secondary(state, panel, narrow);
  if (state.busy) s.text(3, height - 1, l.w - version.length - 2, extra, s.theme.orange);
  else keys(s, 3, height - 1, l.w - version.length - 2, extra);
  s.text(3 + l.w - version.length, height - 1, version.length, version, s.theme.faint);
}

/** The shortcut overlay's content, built once from the same key handling below. */
export const SHORTCUTS = [
  ['Everywhere', ''],
  ['↑ ↓ / j k', 'Move the selection'],
  ['Enter', 'Open or confirm'],
  ['Esc', 'Back one step, keeping your work; repeat to reach Home'],
  ['Ctrl+K or :', 'Search every action'],
  ['Tab', 'Home: move between the menu and recent conversations'],
  ['Mouse', 'Click to select, click again to open, wheel to scroll'],
  ['?', 'Show or hide this list'],
  ['q', 'Quit · Ctrl+C always quits'],
  ['', ''],
  ['Lists', ''],
  ['/', 'Filter the records already loaded'],
  ['n', 'Load the next page'],
  ['y', 'Copy the highlighted value, if your terminal allows it'],
  ['m', 'Compose a message to the highlighted contact'],
  ['r', 'Reply to the highlighted conversation'],
  ['', ''],
  ['Editing', ''],
  ['← →', 'Move the caret'],
  ['Home / End', 'Start or end of the line'],
  ['Tab / Shift+Tab', 'Next or previous field'],
  ['Ctrl+J', 'New line in a message'],
  ['Ctrl+W', 'Delete the previous word'],
  ['Ctrl+U', 'Clear the field'],
  ['Ctrl+F', 'Choose a channel, teammate, or contact from a list'],
  ['', ''],
  ['Appearance', ''],
  ['1–8', 'Choose a wordmark'],
  ['← →', 'Change the focused setting'],
  ['Space', 'Pause or resume motion'],
  ['r', 'Replay the entrance'],
  ['s', 'Save these settings'],
];
