// Key handling, one function per panel kind. Each returns nothing and mutates
// the panel it was given; the Workspace owns state transitions and redraws.

import * as edit from './editor.js';
import { visibleRows } from './panels.js';
import { navigation } from './layout.js';
import { logos } from './logo.js';
import { wrap } from './text.js';
import { MESSAGE_LIMIT } from '../validate.js';

const PAGE = 10;

const clamp = (n, max) => Math.max(0, Math.min(max, n));

const cycle = (n, count, delta) => (n + delta + count) % count;

const isDown = (str, key) => key.name === 'down' || str === 'j';
const isUp = (str, key) => key.name === 'up' || str === 'k';

/** Scrolling shared by the reader and the shortcut overlay. */
function scroll(panel, str, key, max) {
  if (isDown(str, key)) panel.scroll = clamp(panel.scroll + 1, max);
  else if (isUp(str, key)) panel.scroll = clamp(panel.scroll - 1, max);
  else if (key.name === 'pagedown') panel.scroll = clamp(panel.scroll + PAGE, max);
  else if (key.name === 'pageup') panel.scroll = clamp(panel.scroll - PAGE, max);
  else if (key.name === 'home') panel.scroll = 0;
  else if (key.name === 'end') panel.scroll = max;
}

export const handlers = {
  home(app, str, key) {
    if (isDown(str, key)) app.state.nav = cycle(app.state.nav, navigation.length, 1);
    else if (isUp(str, key)) app.state.nav = cycle(app.state.nav, navigation.length, -1);
    else if (/^[1-6]$/.test(str || '')) app.state.nav = Number(str) - 1;
    else if (key.name === 'return' || key.name === 'right') return app.activate();
  },

  select(app, str, key) {
    const panel = app.state.panel;
    if (isDown(str, key)) panel.index = cycle(panel.index, panel.options.length, 1);
    else if (isUp(str, key)) panel.index = cycle(panel.index, panel.options.length, -1);
    else if (key.name === 'return') return app.choose(panel.options[panel.index].value);
  },

  reader(app, str, key) {
    const panel = app.state.panel;
    const width = Math.max(10, app.contentWidth() - 2);
    const total = panel.lines.flatMap((t) => wrap(t, width)).length;
    scroll(panel, str, key, Math.max(0, total - 1));
    if (str === 'n' && panel.next) return panel.next();
  },

  help(app, str, key) {
    scroll(app.state.panel, str, key, Math.max(0, app.state.panel.lines.length - 1));
  },

  list(app, str, key) {
    const panel = app.state.panel;
    if (panel.filtering) return filterKeys(app, panel, str, key);
    const rows = visibleRows(panel);
    const last = Math.max(0, rows.length - 1);
    if (isDown(str, key)) panel.index = clamp(panel.index + 1, last);
    else if (isUp(str, key)) panel.index = clamp(panel.index - 1, last);
    else if (key.name === 'pagedown') panel.index = clamp(panel.index + PAGE, last);
    else if (key.name === 'pageup') panel.index = clamp(panel.index - PAGE, last);
    else if (key.name === 'home') panel.index = 0;
    else if (key.name === 'end') panel.index = last;
    else if (str === '/') {
      panel.filtering = true;
      panel.filter = '';
    } else if (key.name === 'return' && rows[panel.index]) app.openRecord(rows[panel.index].record);
    else if (str === 'y' && rows[panel.index]) app.copy(rows[panel.index]);
    else if (str === 'm' && rows[panel.index]) return app.messageRecord(rows[panel.index].record);
    else if (str === 'n' && panel.next) return panel.next();
  },

  form(app, str, key) {
    const panel = app.state.panel;
    const field = panel.fields[panel.index];
    const value = panel.values[field.key] || '';
    const caret = panel.carets[field.key] ?? edit.length(value);
    const focus = (delta) => {
      panel.index = cycle(panel.index, panel.fields.length, delta);
      const next = panel.fields[panel.index];
      panel.carets[next.key] ??= edit.length(panel.values[next.key] || '');
    };
    const apply = ({ value: v, caret: c }) => {
      panel.values[field.key] = v;
      panel.carets[field.key] = c;
      app.state.error =
        field.multiline && edit.length(v) > MESSAGE_LIMIT
          ? `Message is ${edit.length(v)} characters. Shorten it to ${MESSAGE_LIMIT} before continuing.`
          : '';
    };

    if (key.name === 'tab') return focus(key.shift ? -1 : 1);
    if (key.name === 'left') panel.carets[field.key] = edit.move(value, caret, -1);
    else if (key.name === 'right') panel.carets[field.key] = edit.move(value, caret, 1);
    else if (key.name === 'home' || (key.ctrl && key.name === 'a'))
      panel.carets[field.key] = edit.lineStart(value, caret);
    else if (key.name === 'end' || (key.ctrl && key.name === 'e'))
      panel.carets[field.key] = edit.lineEnd(value, caret);
    else if (key.name === 'up' || key.name === 'down') {
      const moved = field.multiline
        ? edit.moveLine(value, caret, key.name === 'up' ? -1 : 1)
        : null;
      if (moved == null) focus(key.name === 'up' ? -1 : 1);
      else panel.carets[field.key] = moved;
    } else if (key.ctrl && key.name === 'u') apply({ value: '', caret: 0 });
    else if (key.ctrl && key.name === 'w') apply(edit.deleteWord(value, caret));
    else if (key.name === 'backspace') apply(edit.deleteBack(value, caret));
    else if (key.name === 'delete') apply(edit.deleteForward(value, caret));
    else if (key.ctrl && key.name === 'j' && field.multiline)
      apply(edit.insert(field, value, caret, '\n'));
    else if (key.name === 'return') return app.submitForm();
    else if (str && !key.ctrl && !key.meta && !str.startsWith('\x1b'))
      apply(edit.insert(field, value, caret, str));
  },

  preview(app, str, key) {
    const panel = app.state.panel;
    const lines = wrap(panel.form.message || '', app.contentWidth() - 4).length;
    if (key.name === 'down') panel.scroll = clamp(panel.scroll + 1, Math.max(0, lines - 1));
    else if (key.name === 'up') panel.scroll = clamp(panel.scroll - 1, Math.max(0, lines - 1));
    else if (key.name === 'return' && !panel.outcome) return app.sendPreview();
  },

  appearance(app, str, key) {
    const panel = app.state.panel;
    if (str === 's') return app.saveAppearance();
    if (/^[1-8]$/.test(str || '')) {
      app.state.logo = logos[Number(str) - 1].id;
      app.replay();
      return;
    }
    if (str === 'r') return app.replay();
    if (str === ' ') return app.toggleMotion();
    if (isDown(str, key)) panel.index = cycle(panel.index, 5, 1);
    else if (isUp(str, key)) panel.index = cycle(panel.index, 5, -1);
    else if (key.name === 'return' || (key.name === 'right' && panel.index < 3))
      return app.cycleAppearance(1);
    else if (key.name === 'left' && panel.index < 3) return app.cycleAppearance(-1);
  },
};

/** While `/` filtering is active the list consumes typing instead of shortcuts. */
function filterKeys(app, panel, str, key) {
  if (key.name === 'return' || key.name === 'escape') {
    panel.filtering = false;
    if (key.name === 'escape') panel.filter = '';
    return;
  }
  if (key.name === 'backspace') panel.filter = panel.filter.slice(0, -1);
  else if (str && !key.ctrl && !key.meta && !str.startsWith('\x1b')) panel.filter += str;
  panel.index = 0;
}

/** Keys that mean the same thing on every panel. */
export const GLOBAL_KEYS = new Set(['q', 'a', '?']);
