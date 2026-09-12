import { Command, Option, CommanderError } from 'commander';
import { readFile } from 'node:fs/promises';
import * as p from '@clack/prompts';
import * as api from './api.js';
import {
  VERSION,
  DOCS,
  CliError,
  envelope,
  failure,
  validateKey,
  saveConfig,
  logout,
  integer,
} from './core.js';
import { interactive, dashboard, banner, login, render, safe, unwrapPrompt } from './ui.js';

export async function stdinText(max = 65536) {
  let text = '';
  for await (const chunk of process.stdin) {
    text += chunk;
    if (Buffer.byteLength(text) > max)
      throw new CliError('INPUT_TOO_LARGE', `Standard input must be at most ${max} bytes.`, 2);
  }
  return text;
}
export async function main(argv = process.argv) {
  const program = new Command();
  const jsonMode = () =>
    program.opts().json ||
    program.opts().output === 'json' ||
    (!process.stdout.isTTY && program.opts().output !== 'text');
  const write = (data, meta = {}) => {
    const fields = program.opts().fields;
    if (fields) {
      const names = fields.split(',');
      const project = (row) => {
        if (!row || typeof row !== 'object' || names.some((n) => !Object.hasOwn(row, n)))
          throw new CliError(
            'INVALID_FIELDS',
            'Unknown field. Inspect the output without --fields first.',
            2,
          );
        return Object.fromEntries(names.map((n) => [n, row[n]]));
      };
      data = Array.isArray(data) ? data.map(project) : project(data);
    }
    if (jsonMode()) console.log(JSON.stringify(envelope(data, meta)));
    else render(data, meta);
  };
  const opts = (cmd) => {
    const o = cmd.optsWithGlobals();
    return { ...o, timeout: integer(o.timeout, 'timeout', 120000) };
  };
  program
    .name('alive5')
    .description(
      'Conversations, from your terminal.\n\nRun alive5 with no arguments for the interactive workspace.\nAgents: start with alive5 schema. Piped output defaults to JSON.',
    )
    .version(VERSION)
    .option('--json', 'return a stable JSON envelope')
    .addOption(new Option('--output <format>', 'output format').choices(['json', 'text']))
    .option('--raw', 'return unwrapped API data, with secrets removed')
    .option('--fields <names>', 'select top-level result fields, comma-separated')
    .option('--timeout <ms>', 'request timeout in milliseconds', '30000')
    .option('--no-color', 'disable color')
    .option('--no-animation', 'disable logo animation')
    .option('--no-input', 'never prompt')
    .exitOverride()
    .configureOutput({ writeErr: () => {}, outputError: () => {} });
  program.hook('preAction', (_, action) => {
    if (program.opts().fields && ['send', 'login', 'logout'].includes(action.name()))
      throw new CliError('INVALID_ARGUMENT', '--fields is available on read commands only.', 2);
    if (program.opts().color === false) process.env.NO_COLOR = '1';
    if (program.opts().animation === false) process.env.ALIVE5_NO_ANIMATION = '1';
  });
  const canPrompt = () => interactive() && !jsonMode() && program.opts().input !== false;
  const auth = program.command('auth').description('Connect your Alive5 account');
  auth
    .command('login')
    .description('Paste and validate an API key')
    .option('--key-stdin', 'read the key from standard input')
    .action(async (o, cmd) => {
      if (o.keyStdin) {
        if (process.stdin.isTTY)
          throw new CliError('INVALID_ARGUMENT', 'Pipe the API key into --key-stdin.', 2);
        const apiKey = validateKey((await stdinText(8192)).trim());
        const data = await api.account({ ...opts(cmd), apiKey });
        await saveConfig({ apiKey });
        write({ connected: true, organization: data.org_name });
      } else {
        if (!canPrompt())
          throw new CliError(
            'AUTH_REQUIRED',
            'Use --key-stdin or ALIVE5_API_KEY for noninteractive authentication.',
            3,
          );
        await banner();
        const data = await login(opts(cmd));
        write({ connected: true, organization: data.org_name });
      }
    });
  auth
    .command('status')
    .description('Check your key with the account API')
    .action(async (o, cmd) => {
      const d = await api.account(opts(cmd));
      write({
        connected: true,
        organization: d.org_name,
        role: d.user_role,
        source: process.env.ALIVE5_API_KEY ? 'environment' : 'saved key',
      });
    });
  auth
    .command('logout')
    .description('Remove the saved key from this computer')
    .action(async () => {
      await logout();
      write({ loggedOut: true, environmentKeyActive: Boolean(process.env.ALIVE5_API_KEY) });
    });
  program
    .command('account')
    .description('Show account details with the API key removed')
    .action(async (o, cmd) => {
      const options = opts(cmd);
      const d = await api.account(options);
      write(
        options.raw
          ? d
          : {
              organization: d.org_name,
              email: d.email || null,
              role: d.user_role || null,
              botUserId: d.bot_user_id || null,
            },
      );
    });
  program
    .command('channels')
    .description('Discover channel and user IDs')
    .command('list')
    .description('List channels with their users')
    .action(async (o, cmd) => write(await api.channels(opts(cmd))));
  program
    .command('users')
    .description('Discover users across channels')
    .command('list')
    .description('List users and channel memberships')
    .action(async (o, cmd) => {
      const cs = await api.channels({ ...opts(cmd), raw: false });
      const users = new Map();
      for (const ch of cs)
        for (const u of ch.users) {
          if (!users.has(u.id)) users.set(u.id, { ...u, channelIds: [] });
          users.get(u.id).channelIds.push(ch.id);
        }
      write([...users.values()]);
    });
  program
    .command('tags')
    .description('Discover tags')
    .command('list')
    .description('List tag IDs and names')
    .action(async (o, cmd) => write(await api.tags(opts(cmd))));
  program
    .command('contacts')
    .description('Read your contact directory')
    .command('list')
    .description('Read one page of contacts')
    .option('--page <number>', 'page number', '1')
    .option('--limit <number>', 'contacts per page, 1–100', '25')
    .action(async (o, cmd) => {
      const r = await api.contacts(opts(cmd));
      write(r.data, r.meta);
    });
  const conv = program.command('conversations').description('Read conversation transcripts');
  const range = (cmd) =>
    cmd
      .requiredOption('--since <date>', 'start date, YYYY-MM-DD')
      .requiredOption(
        '--until <date>',
        'upper date boundary, YYYY-MM-DD; use the next day to include a full day',
      );
  range(conv.command('list').description('Read one page of conversations'))
    .addOption(
      new Option('--type <type>', 'conversation type')
        .choices(['sms', 'livechat', 'fbm'])
        .default('sms'),
    )
    .option('--page <number>', 'page number', '1')
    .option('--channel <id>', 'channel ID filter, sms/fbm')
    .option('--thread <id>', 'conversation ID filter, sms/fbm')
    .option('--timezone <offset>', 'live chat UTC offset, e.g. -5:00', '+0:00')
    .action(async (o, cmd) => {
      const r = await api.conversations(o.type, opts(cmd));
      write(r.data, r.meta);
    });
  range(
    program
      .command('reports')
      .description('Read public API reports')
      .command('summary')
      .description('Read the documented conversation summary'),
  ).action(async (o, cmd) => write(await api.summary(opts(cmd))));
  const sms = program.command('sms').description('Send and read text messages');
  range(
    sms.command('list').description('Read messages sent within a date range, across all threads'),
  ).action(async (o, cmd) => write(await api.messages(opts(cmd))));
  sms
    .command('send')
    .description('Send one SMS. Use --dry-run to preview; --yes to send without a prompt.')
    .requiredOption('--from <number>', 'Alive5 number, including country code')
    .requiredOption('--to <number>', 'recipient number, including country code')
    .requiredOption('--channel <id>', 'channel ID from channels list')
    .requiredOption('--user <id>', 'user ID in that channel')
    .option('--message <text>', 'message text')
    .option('--message-file <path>', 'UTF-8 text file, or - for stdin')
    .option('--dry-run', 'validate and preview without an API request')
    .option('--yes', 'send without confirmation')
    .action(async (o, cmd) => {
      const options = opts(cmd);
      if ((o.message === undefined) === (o.messageFile === undefined))
        throw new CliError(
          'INVALID_ARGUMENT',
          'Provide exactly one of --message or --message-file.',
          2,
        );
      if (o.messageFile) {
        if (o.messageFile === '-' && process.stdin.isTTY)
          throw new CliError('INVALID_ARGUMENT', 'Pipe message text into --message-file -.', 2);
        options.message =
          o.messageFile === '-' ? await stdinText() : await readFile(o.messageFile, 'utf8');
      }
      const preview = await api.send({ ...options, dryRun: true });
      if (o.dryRun) {
        write(preview);
        return;
      }
      if (!o.yes) {
        if (!canPrompt())
          throw new CliError(
            'CONFIRMATION_REQUIRED',
            'Preview with --dry-run, then add --yes to send.',
            2,
          );
        render(preview);
        if (
          !unwrapPrompt(await p.confirm({ message: `Send to ${safe(o.to)}?`, initialValue: false }))
        )
          throw new CliError('CANCELLED', 'Nothing sent.', 130);
      }
      write(await api.send(options));
    });
  function describe(cmd) {
    return {
      name: cmd.name(),
      description: cmd.description(),
      options: cmd.options.map((o) => ({
        flag: o.flags,
        description: o.description,
        required: Boolean(o.mandatory),
        ...(o.defaultValue !== undefined && { default: o.defaultValue }),
        ...(o.argChoices && { choices: o.argChoices }),
      })),
      commands: cmd.commands.map(describe),
    };
  }
  program
    .command('schema')
    .argument('[path...]', 'optional command path, e.g. sms send')
    .description('Print machine-readable command discovery')
    .action((path) => {
      let target = program;
      for (const part of path) {
        target = target.commands.find((c) => c.name() === part);
        if (!target)
          throw new CliError('INVALID_ARGUMENT', 'Unknown command path. Run alive5 schema.', 2);
      }
      console.log(
        JSON.stringify(
          envelope({
            name: 'alive5',
            version: VERSION,
            docs: DOCS,
            commands: describe(target),
            globalOptions: target === program ? undefined : describe(program).options,
            output: {
              success: '{ok:true,data,error:null,meta:{schemaVersion:1}}',
              failure: '{ok:false,data:null,error:{code,message,retryable},meta:{schemaVersion:1}}',
            },
            exitCodes: {
              0: 'success',
              1: 'local error',
              2: 'invalid arguments or confirmation required',
              3: 'authentication',
              4: 'API or network error',
              5: 'rate limited',
              130: 'cancelled',
            },
            notes: [
              'No automatic retries. A failed send can have an unknown delivery result.',
              'One page per list call. Follow meta.nextPage explicitly.',
              'Use ISO dates and international phone numbers.',
              '--raw still strips secrets.',
              'sms send requires --yes in noninteractive mode.',
            ],
          }),
        ),
      );
    });
  program.action(async () => {
    if (canPrompt()) await dashboard();
    else write({ name: 'alive5', version: VERSION, next: 'alive5 schema', help: 'alive5 --help' });
  });
  try {
    await program.parseAsync(argv);
  } catch (e) {
    if (e instanceof CommanderError && e.exitCode === 0) return;
    if (e instanceof CommanderError)
      e = new CliError('INVALID_ARGUMENT', e.message.replace(/^error: /, ''), 2);
    if (!(e instanceof CliError))
      e = new CliError(
        'LOCAL_ERROR',
        e.code === 'ENOENT'
          ? 'Input file not found. Check the path.'
          : 'The command could not finish. Check your inputs and local configuration.',
        1,
      );
    if (jsonMode()) console.log(JSON.stringify(failure(e)));
    else if (e.code !== 'CANCELLED') console.error(`\n  Error: ${safe(e.message)}\n`);
    process.exitCode = e.exitCode;
  }
}
