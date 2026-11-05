import { group, examples } from './shared.js';
import { phone, integer } from '../validate.js';
import { usage } from '../errors.js';
import { addLine, removeLine, listLines, registeredClient } from '../relay.js';
import { receive, writeText } from '../inbox.js';
import { notifier } from '../notify.js';

export function register(program, { write, opts }) {
  const inbox = group(program, 'inbox', 'Receive inbound texts through the Alive5 relay');
  const channels = group(inbox, 'channels', 'Manage lines subscribed to this client');
  channels
    .command('add')
    .argument('<line>', 'Alive5 number in E.164 format')
    .description('Create a WebSocket subscription for a line')
    .action(async (line, o, cmd) => write(await addLine(phone(line, 'line'), opts(cmd))));
  channels
    .command('remove')
    .argument('<line>', 'Alive5 number in E.164 format')
    .description('Remove a line subscription')
    .action(async (line, o, cmd) => write(await removeLine(phone(line, 'line'), opts(cmd))));
  channels
    .command('list')
    .description('List locally saved line subscriptions')
    .action(async (o, cmd) => write(await listLines(opts(cmd))));

  for (const name of ['listen', 'wait']) {
    const command = inbox
      .command(name)
      .description(
        name === 'wait'
          ? 'Print exactly one inbound text, then exit'
          : 'Stream inbound texts until stopped',
      )
      .option('--line <e164>', 'connect only this subscribed line')
      .option('--notify', 'show macOS Notification Center alerts')
      .option('--json', 'write one JSON envelope per text (NDJSON)');
    if (name === 'wait')
      command.option('--timeout <seconds>', 'exit 124 if no text arrives within this many seconds');
    command.action(async (o, cmd) => {
      const all = cmd.optsWithGlobals();
      if (all.fields || all.raw) throw usage('Inbox streams do not support --fields or --raw.');
      const line = o.line === undefined ? undefined : phone(o.line, 'line');
      const timeoutValue =
        o.timeout ??
        (program.getOptionValueSource('timeout') === 'cli' ? program.opts().timeout : undefined);
      const timeout =
        name !== 'wait' || timeoutValue === undefined
          ? undefined
          : integer(timeoutValue, 'timeout', 2147483);
      const json = Boolean(all.json || all.output === 'json' || !process.stdout.isTTY);
      const client = await registeredClient();
      await receive(client, {
        once: name === 'wait',
        line,
        timeout,
        write: (event) => writeText(event, { json }),
        notify: o.notify ? notifier() : undefined,
      });
    });
    examples(command, [
      `alive5 inbox ${name} --line +15555550100 --json${name === 'wait' ? ' --timeout 60' : ''}`,
    ]);
  }
}
