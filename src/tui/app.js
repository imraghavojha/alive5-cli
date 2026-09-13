import { emitKeypressEvents } from 'node:readline';
import { PassThrough } from 'node:stream';
import * as api from '../api.js';
import { config, validateKey, saveConfig, CliError, dateRange } from '../core.js';
import { Terminal, wrap, sanitize, graphemes, theme } from './screen.js';
import { drawLogo, logos } from './logo.js';
import { view, navigation, layout } from './view.js';

import { appearance, saveAppearance, defaults, appearanceChoices } from '../appearance.js';
export { appearance } from '../appearance.js';

export function recordLines(data) {
  if (!Array.isArray(data))
    return Object.entries(data || {}).map(
      ([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`,
    );
  if (!data.length) return ['No results in this view.'];
  return data.flatMap((row) => {
    if (row.messages)
      return [
        `› ${row.contact?.firstName || row.contact?.phone || 'Conversation'}  ·  ${row.type}`,
        `  ${row.id}`,
        ...row.messages.flatMap((m) => [
          `${m.sender || 'Unknown'}  ·  ${m.at || ''}`,
          String(m.text ?? ''),
          '',
        ]),
        '',
      ];
    if ('text' in row)
      return [
        `› ${row.sender || 'Unknown'}  ·  ${row.at || ''}`,
        String(row.text ?? ''),
        `Thread ${row.threadId || ''}`,
        '',
      ];
    if (row.users)
      return [
        `› ${row.name}`,
        row.id,
        ...row.users.map((u) => `  ${u.name || 'User'}  ·  ${u.id}`),
        '',
      ];
    return [
      `› ${row.name || [row.firstName, row.lastName].filter(Boolean).join(' ') || row.phone || row.id}`,
      ...Object.entries(row)
        .filter(([k, v]) => v != null && v !== '' && k !== 'name')
        .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : v}`),
      '',
    ];
  });
}
export class Workspace {
  constructor({
    services = api,
    account,
    settings = defaults,
    onExit = () => {},
    onChange = () => {},
  } = {}) {
    this.services = services;
    this.onExit = onExit;
    this.onChange = onChange;
    this.epoch = 0;
    this.revision = 0;
    this.closed = false;
    this.state = {
      nav: 0,
      panel: { kind: 'home' },
      account: account || null,
      error: '',
      notice: '',
      busy: '',
      ...defaults,
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
  changed() {
    this.revision++;
    if (!this.closed) this.onChange();
  }
  home() {
    this.epoch++;
    this.state.panel = { kind: 'home' };
    this.state.error = '';
    this.state.busy = '';
    this.changed();
  }
  select(title, options, onSelect, subtitle) {
    if (!options.length) throw new CliError('NO_OPTIONS', 'No matching options are available.');
    this.state.panel = { kind: 'select', title, options, index: 0, onSelect, subtitle };
    this.changed();
  }
  form(title, fields, onSubmit, subtitle, initial = {}) {
    this.state.panel = {
      kind: 'form',
      title,
      fields,
      index: 0,
      values: Object.fromEntries(fields.map((f) => [f.key, initial[f.key] ?? f.value ?? ''])),
      onSubmit,
      subtitle,
    };
    this.state.error = '';
    this.changed();
  }
  reader(title, data, meta = {}, next) {
    this.state.panel = {
      kind: 'reader',
      title,
      lines: recordLines(data),
      scroll: 0,
      subtitle: `${Array.isArray(data) ? data.length + ' records' : 'Result'}${meta.page ? '  ·  page ' + meta.page + (meta.totalPages ? ' of ' + meta.totalPages : '') : ''}${next ? '  ·  n next page' : ''}`,
      next,
    };
    this.changed();
  }
  async run(label, fn) {
    if (this.state.busy) return;
    const epoch = this.epoch;
    this.state.busy = label;
    this.state.error = '';
    this.changed();
    try {
      await fn(() => !this.closed && epoch === this.epoch);
    } catch (e) {
      if (epoch === this.epoch && !this.closed)
        this.state.error = sanitize(e.message).replace(/\n/g, ' ');
    } finally {
      if (epoch === this.epoch) this.state.busy = '';
      this.changed();
    }
  }
  async connect() {
    await this.run('Connecting', async (current) => {
      const stored = process.env.ALIVE5_API_KEY ? {} : await config();
      if (!process.env.ALIVE5_API_KEY && !stored.apiKey) {
        if (current()) this.login();
        return;
      }
      try {
        const account = await this.services.account();
        if (current()) this.state.account = account;
      } catch (e) {
        if (!process.env.ALIVE5_API_KEY && e.exitCode === 3) {
          if (current()) this.login();
        } else throw e;
      }
    });
  }
  login() {
    this.form(
      'Connect to Alive5',
      [{ key: 'apiKey', label: 'API key', secret: true, placeholder: 'Paste your existing key' }],
      async (values, current) => {
        const apiKey = validateKey(values.apiKey);
        const account = await this.services.account({ apiKey });
        await saveConfig({ apiKey });
        if (current()) {
          this.state.account = account;
          this.state.panel = { kind: 'home' };
          this.state.notice = 'Connected. Your key is saved only on this computer.';
        }
      },
      'Alive5 → Integrations → API Key',
    );
  }
  dates(title, callback) {
    const today = new Date().toISOString().slice(0, 10),
      tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
    this.form(
      title,
      [
        { key: 'since', label: 'From · YYYY-MM-DD', value: today },
        { key: 'until', label: 'Until · next day to include a full day', value: tomorrow },
      ],
      async (v, current) => {
        dateRange(v.since, v.until);
        await callback(v, current);
      },
    );
  }
  async activate() {
    const id = navigation[this.state.nav].id;
    this.state.error = '';
    this.state.notice = '';
    if (id === 'appearance') {
      this.state.panel = { kind: 'appearance', index: 0 };
      this.changed();
      return;
    }
    if (id === 'agents') {
      this.state.panel = {
        kind: 'reader',
        title: 'Built for your agent',
        subtitle: 'Quiet commands. Predictable JSON.',
        scroll: 0,
        lines: [
          '› Discover the command interface',
          'alive5 schema',
          'alive5 schema sms send',
          '',
          '› Find channel and user IDs',
          'alive5 channels list --json',
          '',
          '› Preview before sending',
          'alive5 sms send --help',
          'Add --dry-run to validate without sending.',
          'Use --yes only when the recipient and text are authorized.',
          '',
          'Piped commands return one JSON envelope and never prompt.',
          'Use --message-file for multiline text.',
          'Docs: docs/agents.md',
        ],
      };
      this.changed();
      return;
    }
    if (!this.state.account) {
      this.login();
      return;
    }
    if (id === 'send') {
      await this.run('Loading channels', async (current) => {
        const channels = await this.services.channels();
        if (!current()) return;
        this.select(
          'Choose a sending channel',
          channels.map((ch) => ({ label: ch.name, value: ch })),
          (ch) => {
            this.select(
              'Send as',
              ch.users.map((u) => ({ label: u.name || u.id, value: u })),
              (u) => {
                this.compose({
                  channel: ch.id,
                  user: u.id,
                  from: /^\+\d+$/.test(ch.name) ? ch.name : '',
                });
              },
              'This teammate will own the message.',
            );
          },
        );
      });
      return;
    }
    if (id === 'directory') {
      this.select(
        'Explore your workspace',
        [
          { label: 'Channels & teammates', value: 'channels' },
          { label: 'Contacts', value: 'contacts' },
          { label: 'Tags', value: 'tags' },
        ],
        async (type) => {
          await this.run('Loading ' + type, async (current) => {
            const fetchPage = async (page = 1) => {
              const result = await this.services[type]({ page, limit: 25 });
              if (current())
                this.reader(
                  type[0].toUpperCase() + type.slice(1),
                  type === 'contacts' ? result.data : result,
                  result.meta,
                  result.meta?.nextPage
                    ? () => this.run('Loading next page', () => fetchPage(result.meta.nextPage))
                    : null,
                );
            };
            await fetchPage();
          });
        },
      );
      return;
    }
    if (id === 'messages') {
      this.dates('Read recent messages', async (v, current) => {
        const d = await this.services.messages(v);
        if (current()) this.reader('Recent messages', d);
      });
      return;
    }
    if (id === 'history') {
      this.select(
        'Conversation type',
        [
          { label: 'SMS', value: 'sms' },
          { label: 'Live chat', value: 'livechat' },
          { label: 'Facebook Messenger', value: 'fbm' },
        ],
        (type) =>
          this.dates('Read ' + type + ' conversations', async (v, current) => {
            const fetchPage = async (page = 1) => {
              const r = await this.services.conversations(type, { ...v, page });
              if (current())
                this.reader(
                  'Conversations',
                  r.data,
                  r.meta,
                  r.meta?.nextPage
                    ? () => this.run('Loading next page', () => fetchPage(r.meta.nextPage))
                    : null,
                );
            };
            await fetchPage();
          }),
        'This filters conversation start dates.',
      );
    }
  }
  compose(initial) {
    this.form(
      'Compose a text',
      [
        { key: 'from', label: 'From · your Alive 5 number', placeholder: '+15555550100' },
        { key: 'to', label: 'To · include country code', placeholder: '+15555550101' },
        {
          key: 'message',
          label: 'Message',
          multiline: true,
          placeholder: 'Write your message',
        },
      ],
      async (v, current) => {
        const form = { ...initial, ...v };
        this.services.sendForm ? this.services.sendForm(form) : api.sendForm(form);
        if (current()) this.state.panel = { kind: 'preview', form, scroll: 0 };
      },
      'Review before sending.',
      initial,
    );
  }
  async cycleAppearance(direction = 1) {
    const p = this.state.panel;
    if (p.kind !== 'appearance') return;
    if (p.index === 0) {
      const index = logos.findIndex((logo) => logo.id === this.state.logo);
      this.state.logo = logos[(index + direction + logos.length) % logos.length].id;
      this.replay();
    }
    if (p.index === 1) {
      if (this.motionLocked) {
        this.state.notice = 'Motion disabled by environment or command flags.';
        this.changed();
        return;
      }
      const options = ['full', 'subtle', 'off'];
      this.state.motion = options[(options.indexOf(this.state.motion) + direction + 3) % 3];
      this.replay();
    }
    if (p.index === 2) {
      const options = appearanceChoices.effect;
      this.state.effect =
        options[(options.indexOf(this.state.effect) + direction + options.length) % options.length];
      this.replay();
    }
    if (p.index === 3) this.replay();
    if (p.index === 4)
      await this.run('Saving appearance', async () => {
        await saveAppearance({
          motion: this.state.motion,
          effect: this.state.effect,
          logo: this.state.logo,
        });
        this.state.notice = 'Appearance saved.';
      });
    this.changed();
  }
  replay() {
    this.replayAt = performance.now();
    this.changed();
  }
  insert(text) {
    const p = this.state.panel;
    if (p.kind !== 'form' || this.state.busy) return;
    const f = p.fields[p.index];
    const value = sanitize(text);
    const v = f.multiline ? value : value.replace(/\n/g, '');
    const valueWithInput = (p.values[f.key] || '') + v;
    p.values[f.key] = valueWithInput.slice(0, f.secret || f.multiline ? 8192 : 500);
    this.state.error =
      f.multiline && valueWithInput.length > 1600
        ? 'Message is over 1600 characters. Shorten it before continuing.'
        : '';
    this.changed();
  }
  async handleKey(str, key = {}) {
    if (this.closed) return;
    if (key.ctrl && key.name === 'c') {
      this.closed = true;
      this.onExit(130);
      return;
    }
    const p = this.state.panel;
    this.state.notice = '';
    if (key.name === 'escape') {
      if (this.state.busy) {
        this.state.notice = 'Waiting for the current request. Ctrl+C exits.';
        this.changed();
        return;
      }
      if (p.kind === 'preview') this.compose(p.form);
      else this.home();
      return;
    }
    if (this.state.busy) return;
    if (p.kind === 'form') {
      const f = p.fields[p.index];
      if (key.name === 'tab' || key.name === 'down' || key.name === 'up') {
        p.index =
          (p.index + (key.shift || key.name === 'up' ? -1 : 1) + p.fields.length) % p.fields.length;
      } else if (key.ctrl && key.name === 'u') p.values[f.key] = '';
      else if (key.name === 'backspace')
        p.values[f.key] = graphemes(p.values[f.key]).slice(0, -1).join('');
      else if (key.ctrl && key.name === 'j' && f.multiline) this.insert('\n');
      else if (key.name === 'return') {
        if (!p.values[f.key]?.trim()) {
          this.state.error = f.label + ' is required.';
        } else if (p.index < p.fields.length - 1) p.index++;
        else
          await this.run(
            p.fields.some((f) => f.secret) ? 'Validating your key' : 'Preparing your view',
            async (current) => {
              if (p.fields.some((f) => !p.values[f.key]?.trim()))
                throw new CliError('INPUT_REQUIRED', 'Complete every field.');
              await p.onSubmit({ ...p.values }, current);
            },
          );
      } else if (str && !key.ctrl && !key.meta && !str.startsWith('\x1b')) this.insert(str);
      this.changed();
      return;
    }
    if (str === 'q') {
      this.closed = true;
      this.onExit();
      return;
    }
    if (str === 'a') {
      this.state.nav = 5;
      this.state.panel = { kind: 'appearance', index: 0 };
      this.changed();
      return;
    }
    if (str === 'r' && p.kind === 'appearance') {
      this.replay();
      return;
    }
    if (str === ' ' && p.kind === 'appearance') {
      if (!this.motionLocked) this.state.motion = this.state.motion === 'off' ? 'full' : 'off';
      this.changed();
      return;
    }
    if (p.kind === 'reader') {
      const max = Math.max(
        0,
        p.lines.flatMap((t) => wrap(t, Math.max(10, layout(this.width, this.height).w - 2)))
          .length - 1,
      );
      if (key.name === 'down' || str === 'j') p.scroll = Math.min(max, p.scroll + 1);
      if (key.name === 'up' || str === 'k') p.scroll = Math.max(0, p.scroll - 1);
      if (key.name === 'pagedown') p.scroll = Math.min(max, p.scroll + 10);
      if (key.name === 'pageup') p.scroll = Math.max(0, p.scroll - 10);
      if (key.name === 'home') p.scroll = 0;
      if (key.name === 'end') p.scroll = max;
      if (str === 'n' && p.next) await p.next();
      this.changed();
      return;
    }
    if (p.kind === 'preview') {
      if (key.name === 'down')
        p.scroll = Math.min(
          wrap(p.form.message, layout(this.width, this.height).w - 4).length - 1,
          p.scroll + 1,
        );
      if (key.name === 'up') p.scroll = Math.max(0, p.scroll - 1);
      if (key.name === 'return')
        await this.run('Sending your text', async (current) => {
          const result = await this.services.send(p.form);
          if (current())
            this.reader('Message submitted', {
              status: result.status,
              to: result.to,
              message: result.text,
              id: result.id,
              delivery: 'Accepted by Alive5. Handset delivery is not yet confirmed.',
            });
        });
      this.changed();
      return;
    }
    if (p.kind === 'appearance') {
      if (str === 's') {
        const previousIndex = p.index;
        p.index = 4;
        await this.cycleAppearance();
        p.index = previousIndex;
      }
      if (/^[1-8]$/.test(str || '')) {
        this.state.logo = logos[Number(str) - 1].id;
        this.replay();
      }
      if (key.name === 'down' || str === 'j') p.index = (p.index + 1) % 5;
      if (key.name === 'up' || str === 'k') p.index = (p.index + 4) % 5;
      if (key.name === 'return' || (key.name === 'right' && p.index < 3))
        await this.cycleAppearance(1);
      if (key.name === 'left' && p.index < 3) await this.cycleAppearance(-1);
      this.changed();
      return;
    }
    if (p.kind === 'select') {
      if (key.name === 'down' || str === 'j') p.index = (p.index + 1) % p.options.length;
      if (key.name === 'up' || str === 'k')
        p.index = (p.index + p.options.length - 1) % p.options.length;
      if (key.name === 'return')
        try {
          await p.onSelect(p.options[p.index].value);
        } catch (e) {
          this.state.error = e.message;
        }
    } else {
      if (key.name === 'down' || str === 'j')
        this.state.nav = (this.state.nav + 1) % navigation.length;
      if (key.name === 'up' || str === 'k')
        this.state.nav = (this.state.nav + navigation.length - 1) % navigation.length;
      if (/^[1-6]$/.test(str || '')) this.state.nav = Number(str) - 1;
      if (key.name === 'return' || key.name === 'right') await this.activate();
    }
    this.changed();
  }
  frame(width, height, now = performance.now()) {
    this.width = width;
    this.height = height;
    const elapsed = now - this.replayAt;
    this.state.entrance = this.state.motion === 'off' ? 1 : Math.min(1, elapsed / 850);
    const cacheKey = `${width}:${height}:${this.revision}`;
    if (this.cacheKey !== cacheKey) {
      this.cachedScreen = view(this.state, width, height, 0);
      this.cacheKey = cacheKey;
    }
    const screen = this.cachedScreen,
      l = layout(
        width,
        height,
        !['home', 'appearance'].includes(this.state.panel.kind),
        this.state.panel.kind === 'home' ? this.state.logo : null,
      );
    if (width >= 40 && height >= 24 && ['home', 'appearance'].includes(this.state.panel.kind)) {
      screen.fill(3, 3, l.logoWidth, l.logoHeight, theme.bg);
      drawLogo(screen, {
        x: 3,
        y: 3,
        variant: this.state.logo,
        width: l.logoWidth,
        height: l.logoHeight,
        time: Math.max(0, now - this.replayAt) / 1000,
        entrance: this.state.panel.kind === 'form' ? 1 : this.state.entrance,
        motion: this.state.panel.kind === 'form' ? 'off' : this.state.motion,
        effect: this.state.effect,
      });
    }
    return screen;
  }
}

export async function launchTui(options = {}) {
  const terminal = new Terminal();
  let timer, workspace, resolveExit, rejectExit;
  const exited = new Promise((resolve, reject) => {
    resolveExit = resolve;
    rejectExit = reject;
  });
  const input = new PassThrough();
  emitKeypressEvents(input);
  const settings = options.settings || (await appearance());
  let finished = false,
    scheduled = false;
  const draw = () => {
    if (finished) return;
    scheduled = false;
    terminal.render(workspace.frame(process.stdout.columns || 80, process.stdout.rows || 24));
  };
  const change = () => {
    if (!scheduled) {
      scheduled = true;
      setImmediate(draw);
    }
  };
  const restore = () => {
    if (finished) return;
    finished = true;
    clearInterval(timer);
    clearTimeout(escapeTimer);
    process.stdin.removeListener('data', onData);
    input.removeAllListeners();
    process.stdout.removeListener('resize', onResize);
    process.removeListener('SIGTERM', onTerminate);
    process.removeListener('SIGINT', onTerminate);
    process.removeListener('uncaughtException', onError);
    process.removeListener('unhandledRejection', onError);
    process.stdin.setRawMode?.(false);
    process.stdin.pause();
    terminal.close();
  };
  const quit = (code = 0) => {
    restore();
    process.exitCode = code;
    resolveExit();
  };
  const onError = (e) => {
    restore();
    rejectExit(e);
  };
  const onTerminate = () => {
    restore();
    process.exitCode = 130;
    resolveExit();
  };
  const onResize = () => {
    terminal.previous = [];
    change();
  };
  workspace = new Workspace({ ...options, settings, onExit: quit, onChange: change });
  input.on('keypress', (s, k) => {
    Promise.resolve(workspace.handleKey(s, k)).catch(onError);
  });
  let escapeTimer;
  let pending = '',
    pasting = false,
    pasted = '';
  const start = '\x1b[200~',
    end = '\x1b[201~';
  function onData(chunk) {
    clearTimeout(escapeTimer);
    pending += chunk.toString('utf8');
    while (pending) {
      const marker = pasting ? end : start,
        index = pending.indexOf(marker);
      if (index >= 0) {
        const value = pending.slice(0, index);
        pending = pending.slice(index + marker.length);
        if (pasting) {
          pasted += value;
          workspace.insert(pasted);
          pasted = '';
        } else if (value) input.write(value);
        pasting = !pasting;
        continue;
      }
      let keep = 0;
      for (let n = 1; n < marker.length; n++) if (pending.endsWith(marker.slice(0, n))) keep = n;
      const value = pending.slice(0, pending.length - keep);
      pending = pending.slice(pending.length - keep);
      if (pasting) pasted = (pasted + value).slice(0, 8192);
      else if (value) input.write(value);
      break;
    }
    if (pending && !pasting)
      escapeTimer = setTimeout(() => {
        const value = pending;
        pending = '';
        if (value === '\x1b') workspace.handleKey('', { name: 'escape' }).catch(onError);
        else input.write(value);
      }, 30);
  }
  terminal.open();
  process.stdin.setRawMode?.(true);
  process.stdin.setEncoding('utf8');
  process.stdin.resume();
  process.stdin.on('data', onData);
  process.stdout.on('resize', onResize);
  process.on('SIGTERM', onTerminate);
  process.on('SIGINT', onTerminate);
  process.on('uncaughtException', onError);
  process.on('unhandledRejection', onError);
  draw();
  // One capped scheduler; static screens perform no render or output work.
  let lastAnimation = 0;
  timer = setInterval(() => {
    if (finished || !['home', 'appearance'].includes(workspace.state.panel.kind)) return;
    const now = performance.now();
    if (now - workspace.replayAt >= 900 && now - lastAnimation < 160) return;
    lastAnimation = now;
    if (
      workspace.state.motion === 'full' ||
      (workspace.state.motion === 'subtle' && performance.now() - workspace.replayAt < 900)
    )
      draw();
  }, 1000 / 20);
  if (!options.account) workspace.connect().catch(onError);
  await exited;
}
