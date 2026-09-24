// Screen assembly: the fixed header, the panel, and the fixed footer. Panel
// bodies live in ./panels.js; this file owns only the chrome around them.

import { Screen, theme } from './screen.js';
import { wrap } from './text.js';
import { WORDMARK, drawLogo } from './logo.js';
import { layout, showsBanner, MIN_WIDTH, MIN_HEIGHT } from './layout.js';
import { panels } from './panels.js';
import { VERSION } from '../meta.js';

export { navigation, layout } from './layout.js';

/** Shortcut lines per panel, wide first and narrow as a fallback. */
const HINTS = {
  home: [
    '↑↓ or 1–6 select · Enter open · a appearance · ? help · q quit',
    '↑↓ · Enter · ? help · q',
  ],
  appearance: ['↑↓ row · ←→ change · Enter apply · Esc back', '↑↓ row · ←→ change · Esc back'],
  form: ['←→ move · Tab next field · Enter continue · Esc back', 'Tab next · Enter · Esc back'],
  preview: ['Enter send · Esc edit · ↑↓ scroll', 'Enter send · Esc edit'],
  reader: ['↑↓ scroll · PgUp/PgDn · Esc back · q quit', '↑↓ scroll · Esc back · q'],
  list: ['↑↓ select · Enter open · / filter · ? help · Esc back', '↑↓ · Enter · / filter · Esc'],
  select: ['↑↓ select · Enter open · Esc back', '↑↓ · Enter · Esc back'],
  help: ['↑↓ scroll · Esc close', '↑↓ · Esc close'],
};

/** The second footer line: context-specific keys, or the busy indicator. */
function secondary(state, panel, narrow) {
  if (panel.kind === 'appearance')
    return narrow
      ? '1–8 wordmark · s save'
      : '1–8 wordmark · Space pause motion · r replay · s save';
  if (panel.kind === 'form') {
    const field = panel.fields[panel.index];
    const editing = 'Home/End · Ctrl+U clear · Ctrl+W word';
    return field.multiline ? `Ctrl+J new line · ${editing}` : editing;
  }
  if (panel.kind === 'list')
    return narrow ? 'y copy · m message' : 'y copy value · m message this contact · n next page';
  if (state.busy) return '◌ ' + state.busy;
  return '';
}

export function view(state, width, height, time = 0) {
  const s = new Screen(width, height);
  const panel = state.panel;
  const l = layout(width, height, panel.kind, state.logo);
  if (l.tooSmall) {
    s.text(2, 2, width - 4, WORDMARK.toLowerCase(), theme.orange);
    s.text(2, 4, width - 4, `Resize to at least ${MIN_WIDTH} × ${MIN_HEIGHT}.`);
    s.text(2, 6, width - 4, 'Ctrl+C to exit', theme.muted);
    return s;
  }
  const workspaceName = state.account?.org_name || 'Connect your workspace';
  if (showsBanner(panel.kind)) {
    s.text(3, 1, l.w, workspaceName, theme.muted);
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
    s.text(3, 1, l.w, WORDMARK, theme.ink, theme.bg, true);
    s.text(3 + WORDMARK.length + 2, 1, l.w - WORDMARK.length - 2, workspaceName, theme.muted);
  }
  panels[panel.kind]?.(s, l, panel, state);
  footer(s, state, panel, l, width, height);
  return s;
}

/**
 * The status area holds an error, a notice, or the panel's shortcuts. Errors are
 * wrapped over the available lines instead of being clipped mid-sentence.
 */
function footer(s, state, panel, l, width, height) {
  const narrow = l.narrow;
  const hint = HINTS[panel.kind]?.[narrow ? 1 : 0] || '';
  const message = state.error || state.notice || hint;
  const tone = state.error ? theme.hot : theme.muted;
  const lines = wrap(message, l.w).slice(0, 2);
  // A two-line message borrows the rule's row so the panel never shifts.
  const ruleRow = height - 3 - (lines.length > 1 ? 1 : 0);
  s.line(3, ruleRow, l.w);
  lines.forEach((text, i) => s.text(3, height - 2 - (lines.length - 1) + i, l.w, text, tone));
  const version = 'v' + VERSION;
  s.text(3, height - 1, l.w - version.length - 2, secondary(state, panel, narrow), theme.faint);
  s.text(3 + l.w - version.length, height - 1, version.length, version, theme.faint);
}

/** The shortcut overlay's content, built once from the same key handling below. */
export const SHORTCUTS = [
  ['Everywhere', ''],
  ['↑ ↓ / j k', 'Move the selection'],
  ['Enter', 'Open or confirm'],
  ['Esc', 'Back one step, keeping your work; repeat to reach Home'],
  ['?', 'Show or hide this list'],
  ['q', 'Quit · Ctrl+C always quits'],
  ['', ''],
  ['Lists', ''],
  ['/', 'Filter the records already loaded'],
  ['n', 'Load the next page'],
  ['y', 'Copy the highlighted value, if your terminal allows it'],
  ['m', 'Compose a message to the highlighted contact'],
  ['', ''],
  ['Editing', ''],
  ['← →', 'Move the caret'],
  ['Home / End', 'Start or end of the line'],
  ['Tab / Shift+Tab', 'Next or previous field'],
  ['Ctrl+J', 'New line in a message'],
  ['Ctrl+W', 'Delete the previous word'],
  ['Ctrl+U', 'Clear the field'],
  ['', ''],
  ['Appearance', ''],
  ['1–8', 'Choose a wordmark'],
  ['← →', 'Change the focused setting'],
  ['Space', 'Pause or resume motion'],
  ['r', 'Replay the entrance'],
  ['s', 'Save these settings'],
];
