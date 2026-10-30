import * as api from '../api.js';
import { CliError } from '../errors.js';
import { config, saveConfig, saveAppearance, appearanceDefaults } from '../storage.js';
import { validateKey, dateRange, MESSAGE_LIMIT } from '../validate.js';
import { displayName } from '../normalize.js';
import { sanitize } from './text.js';
import { visibleRows, layoutLines, bubbles } from './panels.js';
import { drawLogo, logos } from './logo.js';
import { mascots } from './mascot.js';
import { view, SHORTCUTS } from './view.js';
import { layout, navigation, showsBanner } from './layout.js';
import { handlers } from './keys.js';
import * as flows from './flows.js';
import * as records from './records.js';
import * as edit from './editor.js';

const ENTRANCE_MS = 850;

export class Workspace {
  constructor({
    services = api,
    account,
    settings = appearanceDefaults,
    onExit = () => {},
    onChange = () => {},
    onCopy = defaultCopy,
  } = {}) {
    this.services = services;
    this.onExit = onExit;
    this.onChange = onChange;
    this.onCopy = onCopy;
    this.epoch = 0;
    this.revision = 0;
    this.closed = false;
    this.history = [];
    this.state = {
      nav: 0,
      panel: { kind: 'home' },
      account: account || null,
      error: '',
      notice: '',
      busy: '',
      tick: 0,
      // Home: which column has focus, and the threads from the last week.
      focus: 'nav',
      recent: null,
      recentIndex: 0,
      ...appearanceDefaults,
      ...settings,
      entrance: 0,
    };
    this.motionLocked = Boolean(process.env.ALIVE5_NO_ANIMATION || 'NO_COLOR' in process.env);
    if (this.motionLocked) this.state.motion = 'off';
    this.started = performance.now();
    this.replayAt = this.started;
    this.width = 100;
    this.height = 36;
  }

  // ---- panel stack -------------------------------------------------------

  changed() {
    this.revision++;
    if (!this.closed) this.onChange();
  }

  show(panel, { remember = true } = {}) {
    const previous = this.state.panel;
    const plain =
      ['home', 'appearance', 'help'].includes(panel.kind) ||
      panel.fields?.some((f) => f.key === 'apiKey');
    if (!plain && panel.section === undefined) panel.section = previous.section;
    if (previous.section !== panel.section) this.replayAt = performance.now();
    if (remember && this.state.panel.kind !== 'home') this.history.push(this.state.panel);
    this.state.panel = panel;
    this.state.error = '';
    this.changed();
  }

  back() {
    const previous = this.history.pop();
    if (!previous) return this.home();
    if (previous.section !== this.state.panel.section) this.replayAt = performance.now();
    this.state.panel = previous;
    this.state.error = '';
    this.state.notice = '';
    this.changed();
  }

  home() {
    this.epoch++;
    this.history = [];
    this.state.panel = { kind: 'home' };
    this.state.error = '';
    this.state.busy = '';
    this.changed();
  }

  contentWidth() {
    return layout(this.width, this.height, this.state.panel.kind, this.state.logo).w;
  }

  contentHeight() {
    return layout(this.width, this.height, this.state.panel.kind, this.state.logo).h;
  }

  // ---- panel constructors ------------------------------------------------

  select(
    title,
    options,
    onSelect,
    subtitle,
    { search = false, query = '', index = 0, section } = {},
  ) {
    if (!options.length) throw new CliError('NO_OPTIONS', 'No matching options are available.');
    this.show({
      kind: 'select',
      title,
      options,
      index: query ? 0 : index,
      onSelect,
      subtitle,
      search,
      query,
      section,
    });
  }

  form(title, fields, onSubmit, subtitle, initial = {}) {
    const values = Object.fromEntries(fields.map((f) => [f.key, initial[f.key] ?? f.value ?? '']));
    this.show({
      kind: 'form',
      title,
      fields,
      section: fields.some((f) => f.key === 'message') ? 'compose' : undefined,
      index: 0,
      values,
      carets: Object.fromEntries(fields.map((f) => [f.key, edit.length(values[f.key])])),
      onSubmit,
      subtitle,
    });
  }

  reader(title, lines, subtitle = '', next = null, section) {
    this.show({ kind: 'reader', title, lines, scroll: 0, subtitle, next, section });
  }

  result(title, data, subtitle = '') {
    this.reader(title, records.resultLines(data), subtitle);
  }

  list(title, kind, data, meta = {}, next = null, section) {
    const { columns, rows } = records.describe(kind, data);
    const page = meta.page
      ? `page ${meta.page}${meta.totalPages ? ` of ${meta.totalPages}` : ''}`
      : '';
    this.show({
      kind: 'list',
      title,
      recordKind: kind,
      section:
        section ||
        (['contacts', 'channels', 'tags'].includes(kind)
          ? 'contacts'
          : kind === 'threads'
            ? 'conversations'
            : undefined),
      columns,
      rows: rows.map((r) => ({ ...r, search: records.searchText(r) })),
      index: 0,
      filter: '',
      filtering: false,
      next,
      subtitle: [meta.summary || `${data.length} records`, page, next ? 'n next page' : '']
        .filter(Boolean)
        .join('  ·  '),
    });
  }

  transcript(thread) {
    const count = `${thread.messages.length} message${thread.messages.length === 1 ? '' : 's'}`;
    const subtitle = [thread.phone !== thread.name && thread.phone, count, thread.channelName]
      .filter(Boolean)
      .join('  ·  ');
    this.show({ kind: 'transcript', thread, subtitle, scroll: Infinity, section: 'conversations' });
  }

  help() {
    this.show({ kind: 'help', lines: SHORTCUTS, scroll: 0 });
  }

  palette() {
    return flows.palette(this);
  }

  loadRecent() {
    return flows.loadRecent(this);
  }

  // ---- async work --------------------------------------------------------

  async run(label, fn) {
    if (this.state.busy) return;
    const epoch = this.epoch;
    this.state.busy = label;
    this.state.error = '';
    this.changed();
    try {
      await fn(() => !this.closed && epoch === this.epoch);
    } catch (e) {
      if (epoch === this.epoch && !this.closed) this.state.error = sanitize(e.message);
    } finally {
      if (epoch === this.epoch) this.state.busy = '';
      this.changed();
    }
  }

  // ---- task flows --------------------------------------------------------
  // Each screen's behaviour lives in ./flows.js; these keep the call sites short.

  connect() {
    return flows.connect(this);
  }
  login() {
    return flows.login(this);
  }
  activate() {
    return flows.activate(this);
  }
  startCompose(initial) {
    return flows.startCompose(this, initial);
  }
  compose(context, initial) {
    return flows.compose(this, context, initial);
  }
  sendPreview() {
    return flows.sendPreview(this);
  }
  openRecord(record) {
    return flows.openRecord(this, record);
  }
  messageRecord(record) {
    return flows.messageRecord(this, record);
  }

  async submitForm() {
    const panel = this.state.panel;
    const field = panel.fields[panel.index];
    // An empty field with a list behind it opens the list instead of failing.
    if (field.pick && !panel.values[field.key]?.trim()) return field.pick('');
    if (!panel.values[field.key]?.trim()) {
      this.state.error = `${field.label} is required.`;
      return;
    }
    if (panel.index < panel.fields.length - 1) {
      panel.index++;
      panel.carets[panel.fields[panel.index].key] ??= edit.length(
        panel.values[panel.fields[panel.index].key] || '',
      );
      return;
    }
    const label = panel.fields.some((f) => f.secret)
      ? 'Validating your key'
      : 'Preparing your view';
    await this.run(label, async (current) => {
      const missing = panel.fields.find((f) => !panel.values[f.key]?.trim());
      if (missing) throw new CliError('INPUT_REQUIRED', `${missing.label} is required.`);
      await panel.onSubmit({ ...panel.values }, current);
    });
  }

  choose(value) {
    const panel = this.state.panel;
    try {
      return panel.onSelect(value);
    } catch (e) {
      this.state.error = e.message;
    }
  }

  /** OSC 52. Terminals may refuse it, so the notice says what was attempted. */
  copy(row) {
    const value = row.cells.find(Boolean) || '';
    const copied = this.onCopy(value);
    this.state.notice = copied
      ? `Copied "${value}" if your terminal allows clipboard access.`
      : 'Copying needs an interactive terminal.';
    this.changed();
  }

  // ---- appearance --------------------------------------------------------

  toggleMotion() {
    if (this.motionLocked)
      this.state.notice = 'Motion is disabled by environment or command flags.';
    else this.state.motion = this.state.motion === 'off' ? 'full' : 'off';
    this.changed();
  }

  async saveAppearance() {
    await this.run('Saving appearance', async () => {
      const { logo, mascot, motion, effect, theme } = this.state;
      await saveAppearance({ logo, mascot, motion, effect, theme });
      this.state.notice = 'Appearance saved.';
    });
  }

  async cycleAppearance(direction = 1) {
    const panel = this.state.panel;
    if (panel.kind !== 'appearance') return;
    const step = (list, current) =>
      list[(list.indexOf(current) + direction + list.length) % list.length];
    if (panel.index === 0) {
      this.state.logo = step(
        logos.map((l) => l.id),
        this.state.logo,
      );
      this.replay();
    } else if (panel.index === 1) {
      if (this.motionLocked) return this.toggleMotion();
      this.state.motion = step(['full', 'subtle', 'off'], this.state.motion);
      this.replay();
    } else if (panel.index === 2) {
      this.state.effect = step(['signal', 'breathe', 'orbit', 'cosmos'], this.state.effect);
      this.replay();
    } else if (panel.index === 3) {
      this.state.theme = step(['dark', 'light', 'terminal', 'high-contrast'], this.state.theme);
      this.replay();
    } else if (panel.index === 4) {
      this.state.mascot = step(
        mascots.map((m) => m.id),
        this.state.mascot,
      );
      this.replay();
    } else if (panel.index === 5) this.replay();
    else if (panel.index === 6) await this.saveAppearance();
    this.changed();
  }

  replay() {
    this.replayAt = performance.now();
    this.changed();
  }

  // ---- input -------------------------------------------------------------

  async handleKey(str, key = {}) {
    if (this.closed) return;
    if (key.ctrl && key.name === 'c') return this.quit(130);
    const panel = this.state.panel;
    const typing =
      panel.kind === 'form' ||
      (panel.kind === 'list' && panel.filtering) ||
      (panel.kind === 'select' && panel.search);
    this.state.notice = '';
    if (key.name === 'escape') {
      if (this.state.busy) {
        this.state.notice = 'Waiting for the current request. Ctrl+C exits.';
        this.changed();
        return;
      }
      if (panel.kind === 'list' && panel.filtering) {
        panel.filtering = false;
        panel.filter = '';
        this.changed();
        return;
      }
      this.back();
      return;
    }
    if (this.state.busy) return;
    if (key.ctrl && key.name === 'k') return this.palette();
    if (!typing) {
      if (str === ':') return this.palette();
      if (str === 'q') return this.quit(0);
      if (str === '?') return panel.kind === 'help' ? this.back() : this.help();
      if (str === 'a' && panel.kind !== 'appearance') {
        this.state.nav = navigation.findIndex((n) => n.id === 'appearance');
        this.show({ kind: 'appearance', index: 0 }, { remember: false });
        return;
      }
    }
    await handlers[panel.kind]?.(this, str, key);
    this.changed();
  }

  async mouse({ button, x, y, release }) {
    if (this.closed || this.state.busy || release) return;
    if (button === 64 || button === 65)
      return this.handleKey('', { name: button === 64 ? 'up' : 'down' });
    const hit = button === 0 && this.cachedScreen?.hitAt(x, y);
    if (!hit) return;
    const panel = this.state.panel;
    const again = (current) => current === hit.index;
    if (panel.kind === 'home' && hit.group === 'recent') {
      const opened = this.state.focus === 'recent' && again(this.state.recentIndex);
      Object.assign(this.state, { focus: 'recent', recentIndex: hit.index });
      if (opened) return this.handleKey('', { name: 'return' });
    } else if (panel.kind === 'home') {
      const opened = this.state.focus === 'nav' && again(this.state.nav);
      Object.assign(this.state, { focus: 'nav', nav: hit.index });
      if (opened) return this.activate();
    } else if (panel.kind === 'form') {
      if (again(panel.index)) return;
      panel.index = hit.index;
    } else if ('index' in panel) {
      if (again(panel.index)) return this.handleKey('', { name: 'return' });
      panel.index = hit.index;
    }
    this.changed();
  }

  quit(code = 0) {
    this.closed = true;
    this.onExit(code);
  }

  /** Paste and bracketed-paste input arrive here, not through handleKey. */
  insert(text) {
    const panel = this.state.panel;
    if (panel.kind !== 'form' || this.state.busy) return;
    const field = panel.fields[panel.index];
    if (field.pick && !field.editable) return;
    const caret = panel.carets[field.key] ?? edit.length(panel.values[field.key] || '');
    const next = edit.insert(field, panel.values[field.key] || '', caret, text);
    panel.values[field.key] = next.value;
    panel.carets[field.key] = next.caret;
    this.state.error =
      field.multiline && edit.length(next.value) > MESSAGE_LIMIT
        ? `Message is ${edit.length(next.value)} characters. Shorten it to ${MESSAGE_LIMIT} before continuing.`
        : '';
    this.changed();
  }

  // ---- rendering ---------------------------------------------------------

  frame(width, height, now = performance.now()) {
    this.width = width;
    this.height = height;
    const panel = this.state.panel;
    const l = layout(width, height, panel.kind, this.state.logo);
    if (panel.kind === 'reader') {
      const count = layoutLines(panel.lines, Math.max(10, l.w - 2)).length;
      panel.scroll = Math.max(0, Math.min(panel.scroll, count - Math.max(1, l.h - 4)));
    } else if (panel.kind === 'help') {
      panel.scroll = Math.max(0, Math.min(panel.scroll, panel.lines.length - Math.max(1, l.h - 4)));
    } else if (panel.kind === 'transcript') {
      const count = bubbles(panel.thread, l.w - 2).length;
      panel.scroll = Math.max(0, Math.min(panel.scroll, count - Math.max(1, l.h - 4)));
    } else if (panel.kind === 'list') {
      panel.index = Math.max(0, Math.min(panel.index, visibleRows(panel).length - 1));
    }
    const elapsed = now - this.replayAt;
    this.state.entrance = this.state.motion === 'off' ? 1 : Math.min(1, elapsed / ENTRANCE_MS);
    const cacheKey = `${width}:${height}:${this.revision}`;
    if (this.cacheKey !== cacheKey) {
      this.cachedScreen = view(this.state, width, height, 0);
      this.cacheKey = cacheKey;
    }
    const screen = this.cachedScreen;
    if (!l.tooSmall && (showsBanner(panel.kind) || panel.section)) {
      screen.fill(l.banner.x, l.banner.y, l.banner.width, l.banner.height, screen.theme.bg);
      drawLogo(screen, {
        ...l.banner,
        variant: this.state.logo,
        mascot: this.state.mascot,
        time: Math.max(0, elapsed) / 1000,
        entrance: this.state.entrance,
        motion: this.state.motion,
        effect: showsBanner(panel.kind) ? this.state.effect : 'none',
        section: panel.section,
      });
    }
    return screen;
  }
}

/** Writes an OSC 52 clipboard sequence when attached to a real terminal. */
function defaultCopy(value) {
  if (!process.stdout.isTTY) return false;
  process.stdout.write(`\x1b]52;c;${Buffer.from(value, 'utf8').toString('base64')}\x07`);
  return true;
}
