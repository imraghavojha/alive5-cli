// A line-by-line peer of the full-screen runtime. It uses the same Workspace
// state and actions, but writes ordinary text and never changes terminal modes.

import { createInterface } from 'node:readline';
import { Workspace } from './workspace.js';
import { navigation } from './layout.js';
import { visibleRows } from './panels.js';
import { sanitize } from './text.js';

const say = (output, text = '') => output.write(sanitize(String(text)) + '\n');

export function describeLinear(state) {
  const panel = state.panel;
  const lines = [`\n${panel.title || (panel.kind === 'home' ? 'Alive5' : panel.kind)}`];
  if (panel.subtitle) lines.push(panel.subtitle);
  if (panel.kind === 'home')
    lines.push(
      ...navigation.map((item, i) => `${i + 1}. ${item.label}`),
      'Enter a number to open.',
    );
  else if (panel.kind === 'select')
    lines.push(
      ...panel.options.map((item, i) => `${i + 1}. ${item.label}`),
      'Enter a number to select.',
    );
  else if (panel.kind === 'list') {
    const rows = visibleRows(panel);
    lines.push(...rows.map((row, i) => `${i + 1}. ${row.cells.join(' | ')}`));
    lines.push('Enter a number for full details. :filter words searches loaded records.');
    if (panel.next) lines.push(':next loads the next page.');
  } else if (panel.kind === 'form') {
    const field = panel.fields[panel.index];
    lines.push(`Field ${panel.index + 1} of ${panel.fields.length}: ${field.label}`);
    if (field.secret) lines.push('Current value: hidden');
    else if (panel.values[field.key]) lines.push(`Current value: ${panel.values[field.key]}`);
    lines.push(
      'Type a value, or :next to keep the current value. Use \\n for message line breaks.',
    );
  } else if (panel.kind === 'preview') {
    lines.push(panel.outcome ? `Send outcome: ${panel.outcome}` : 'Nothing has been sent.');
    lines.push(...panel.context.map(([name, value]) => `${name}: ${value || '—'}`));
    lines.push('Message:', panel.form.message || '');
    if (!panel.outcome) lines.push('Type SEND to submit this text once.');
  } else if (panel.kind === 'reader') lines.push(...panel.lines);
  else if (panel.kind === 'appearance') {
    lines.push(
      `1. Wordmark: ${state.logo}`,
      `2. Motion: ${state.motion}`,
      `3. Effect: ${state.effect}`,
      `4. Theme: ${state.theme}`,
      'Enter 1–4 to change a setting. :save stores the choices.',
    );
  } else if (panel.kind === 'help') lines.push(...panel.lines.map((item) => item.join('  ')));
  if (state.error) lines.push(`Error: ${state.error}`);
  if (state.notice) lines.push(state.notice);
  lines.push(':back returns one step. :quit exits.');
  return lines.join('\n');
}

export async function launchLinear({
  input = process.stdin,
  output = process.stdout,
  services,
  account,
  settings,
} = {}) {
  const app = new Workspace({ services, account, settings, onExit: () => {} });
  if (!account) await app.connect();
  const rl = createInterface({ input, output, terminal: false });
  say(output, describeLinear(app.state));
  output.write('> ');
  try {
    for await (const raw of rl) {
      const line = raw.trim();
      if (line === ':quit') break;
      if (line === ':back') app.back();
      else if (app.state.panel.kind === 'form') {
        const panel = app.state.panel;
        const field = panel.fields[panel.index];
        if (field.secret) {
          say(
            output,
            'Use alive5 auth login --key-stdin to save a key, then restart alive5 --linear.',
          );
          continue;
        }
        if (line !== ':next') {
          panel.values[field.key] = raw.replaceAll('\\n', '\n');
          panel.carets[field.key] = [...panel.values[field.key]].length;
        }
        await app.submitForm();
      } else if (app.state.panel.kind === 'preview') {
        if (raw === 'SEND' && !app.state.panel.outcome) await app.sendPreview();
      } else if (
        app.state.panel.kind === 'list' &&
        (line === ':filter' || line.startsWith(':filter '))
      ) {
        app.state.panel.filter = line === ':filter' ? '' : line.slice(8);
        app.state.panel.index = 0;
      } else if (line === ':next' && app.state.panel.next) await app.state.panel.next();
      else if (line === ':save' && app.state.panel.kind === 'appearance')
        await app.saveAppearance();
      else if (/^\d+$/.test(line)) {
        const number = Number(line) - 1;
        const panel = app.state.panel;
        if (panel.kind === 'home' && navigation[number]) {
          app.state.nav = number;
          await app.activate();
        } else if (panel.kind === 'select' && panel.options[number]) {
          panel.index = number;
          await app.choose(panel.options[number].value);
        } else if (panel.kind === 'list' && visibleRows(panel)[number]) {
          panel.index = number;
          app.openRecord(visibleRows(panel)[number].record);
        } else if (panel.kind === 'appearance' && number >= 0 && number < 4) {
          panel.index = number;
          await app.cycleAppearance(1);
        }
      }
      say(output, describeLinear(app.state));
      output.write('> ');
    }
  } finally {
    rl.close();
  }
}
