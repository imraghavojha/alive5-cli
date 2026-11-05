import { addLine, removeLine, registeredClient } from '../relay.js';
import { receive } from '../inbox.js';
import { inboxConfig, saveInboxNotifications } from '../storage.js';
import { notifier } from '../notify.js';
import { sanitize } from './text.js';

export const inboxServices = {
  addLine,
  removeLine,
  registeredClient,
  receive,
  config: inboxConfig,
  saveNotifications: saveInboxNotifications,
  notifier,
};

export function open(app) {
  return app.run('Loading inbox', async (current) => {
    const [saved, channels] = await Promise.all([app.inbox.config(), app.services.channels()]);
    if (!current()) return;
    const subscribed = Object.keys(saved.subscriptions || {});
    const numbers = new Set([
      ...subscribed,
      ...channels.map((c) => c.name).filter((name) => /^\+[1-9]\d{7,14}$/.test(name)),
    ]);
    app.show({
      kind: 'inbox',
      section: null,
      index: 0,
      lines: [...numbers].map((line) => ({
        line,
        enabled: subscribed.includes(line),
        status: 'off',
      })),
      notifications: saved.notifications === true,
      messages: [],
      scroll: 0,
    });
  });
}

export function stop(app) {
  app.inboxController?.abort();
  app.inboxController = null;
  return app.inboxTask;
}

export function start(app) {
  const previous = stop(app);
  const panel = app.state.panel;
  if (panel.kind !== 'inbox') return;
  const controller = new AbortController();
  app.inboxController = controller;
  const active = () => !controller.signal.aborted && !app.closed && app.state.panel === panel;
  for (const line of panel.lines) line.status = line.enabled ? 'connecting' : 'off';
  panel.section = null;
  app.changed();
  const update = () => {
    panel.section = panel.lines.some((l) => l.status === 'listening') ? 'inbox' : null;
    app.changed();
  };
  app.inboxTask = (async () => {
    await previous;
    if (!active() || !panel.lines.some((l) => l.enabled)) return;
    const client = await app.inbox.registeredClient();
    if (!active()) return;
    let notify;
    const warn = (message) => {
      if (!active()) return;
      app.state.notice = sanitize(message);
      app.changed();
    };
    await app.inbox.receive(client, {
      signal: controller.signal,
      status: (number, status) => {
        if (!active()) return;
        const line = panel.lines.find((l) => l.line === number);
        if (line) line.status = status;
        update();
      },
      write: async (event) => {
        if (!active()) return;
        panel.messages.push(event);
        if (panel.messages.length > 200) panel.messages.shift();
        app.changed();
      },
      notify: (event) => {
        if (!active() || !panel.notifications) return;
        notify ||= app.inbox.notifier({ warn });
        notify(event);
      },
      warn,
    });
  })().catch((error) => {
    if (!active()) return;
    for (const line of panel.lines) if (line.enabled) line.status = 'stopped';
    app.state.error = sanitize(error.message);
    update();
  });
}

export function toggleLine(app) {
  const panel = app.state.panel;
  const line = panel.lines[panel.index];
  if (!line) return;
  return app.run(line.enabled ? 'Turning line off' : 'Turning line on', async () => {
    await stop(app);
    try {
      await (line.enabled ? app.inbox.removeLine(line.line) : app.inbox.addLine(line.line));
      line.enabled = !line.enabled;
    } finally {
      if (!app.closed && app.state.panel === panel) start(app);
    }
  });
}

export function toggleNotifications(app) {
  const panel = app.state.panel;
  return app.run('Saving notifications', async () => {
    const enabled = !panel.notifications;
    await app.inbox.saveNotifications(enabled);
    panel.notifications = enabled;
  });
}
