// Command-line entry point: global options, the shared command context, and one
// place where every error becomes an envelope and an exit code. Command
// definitions live in ./commands/.

import { Command, Option, CommanderError } from 'commander';
import { CliError, EXIT, envelope, failure, usage } from './errors.js';
import { VERSION } from './meta.js';
import { writer, safe } from './output.js';
import { interactive, dashboard } from './prompts.js';
import { integer } from './validate.js';
import * as auth from './commands/auth.js';
import * as directory from './commands/directory.js';
import * as messages from './commands/messages.js';
import * as appearance from './commands/appearance.js';
import * as discover from './commands/discover.js';

const REGISTRARS = [auth, directory, messages, appearance, discover];

const WRITE_COMMANDS = ['send', 'login', 'logout', 'set'];

const DESCRIPTION = `Conversations, from your terminal.

Run alive5 with no arguments for the interactive workspace.
Agents: start with alive5 schema. Piped output defaults to JSON.
Authentication: alive5 auth login, or set ALIVE5_API_KEY.
Exit codes: 0 success, 2 usage, 3 authentication, 4 API, 5 rate limit, 130 cancelled.`;

function build() {
  const program = new Command();
  program
    .name('alive5')
    .description(DESCRIPTION)
    .version(VERSION)
    .option('--json', 'return a stable JSON envelope')
    .addOption(new Option('--output <format>', 'output format').choices(['json', 'text']))
    .option('--raw', 'return unwrapped API data, with secrets removed')
    .option('--fields <names>', 'select top-level result fields, comma-separated')
    .option('--timeout <ms>', 'request timeout in milliseconds', '30000')
    .option('--no-color', 'disable color')
    .option('--no-animation', 'disable logo animation')
    .option('--linear', 'use a line-by-line interactive workspace')
    .option('--no-input', 'never prompt')
    .exitOverride()
    .configureOutput({ writeErr: () => {}, outputError: () => {} })
    .addHelpText(
      'after',
      `\nExamples:\n  alive5\n  alive5 channels list\n  alive5 contacts list --limit 100\n  alive5 sms send --help\n  alive5 doctor\n  alive5 completion zsh\n\nMore: alive5 schema`,
    );

  const json = () =>
    program.opts().json ||
    program.opts().output === 'json' ||
    (!process.stdout.isTTY && program.opts().output !== 'text');

  const context = {
    write: writer({
      json,
      fields: () => program.opts().fields,
      envelope,
      invalidFields: () => usage('Unknown field. Inspect the output without --fields first.'),
    }),
    /** Global options merged with the command's own, with --timeout validated once. */
    opts: (cmd) => {
      const o = cmd.optsWithGlobals();
      return { ...o, timeout: integer(o.timeout, 'timeout', 120000) };
    },
    canPrompt: () => interactive() && !json() && program.opts().input !== false,
  };

  program.hook('preAction', (_, action) => {
    if (program.opts().fields && WRITE_COMMANDS.includes(action.name()))
      throw usage('--fields is available on read commands only.');
    if (program.opts().color === false) process.env.NO_COLOR = '1';
    if (program.opts().animation === false) process.env.ALIVE5_NO_ANIMATION = '1';
  });

  for (const registrar of REGISTRARS) registrar.register(program, context);

  program.action(async () => {
    if (context.canPrompt()) await dashboard({ linear: program.opts().linear });
    else
      context.write({
        name: 'alive5',
        version: VERSION,
        next: 'alive5 schema',
        help: 'alive5 --help',
      });
  });
  return { program, json };
}

/** Edit distance, for suggesting the command a typo was probably meant to be. */
function distance(a, b) {
  let row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const next = [i];
    for (let j = 1; j <= b.length; j++)
      next[j] = Math.min(row[j] + 1, next[j - 1] + 1, row[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    row = next;
  }
  return row[b.length];
}

/**
 * The root and every group have an action, so Commander reports a mistyped
 * command as "too many arguments". Name the unknown word and the likely command.
 */
function unknownCommand(program, message) {
  const [, owner, words] = message.match(/arguments(?: for '([^']+)')?\..*: (.+)\.$/) || [];
  const find = (cmd) =>
    cmd.commands.find((c) => c.name() === owner) || cmd.commands.map(find).find(Boolean);
  const parent = owner ? find(program) : program;
  const names = parent?.commands.map((c) => c.name()) || [];
  if (!words || !names.length) return null;
  const word = words.split(', ')[0];
  const suggestions = names.filter((n) => n.startsWith(word) || distance(word, n) <= 2);
  const path = owner ? `alive5 ${owner}` : 'alive5';
  return new CliError(
    'UNKNOWN_COMMAND',
    `Unknown command "${word}".${suggestions.length ? ` Did you mean ${path} ${suggestions[0]}?` : ''} Run ${path} --help.`,
    EXIT.usage,
    { details: { command: word, suggestions } },
  );
}

/** Anything thrown becomes a CliError so the reported code and exit status agree. */
function toCliError(e, program) {
  if (e instanceof CliError) return e;
  if (e instanceof CommanderError) {
    const message = e.message.replace(/^error: /, '');
    if (e.code === 'commander.excessArguments') {
      const unknown = unknownCommand(program, message);
      if (unknown) return unknown;
    }
    const missing = message.match(/required option '(--([\w-]+)[^']*)' not specified/);
    if (missing)
      return new CliError('MISSING_OPTION', `Add ${missing[1]}.`, EXIT.usage, {
        field: missing[2].replace(/-(\w)/g, (_, c) => c.toUpperCase()),
      });
    return new CliError(
      'INVALID_ARGUMENT',
      `${message[0].toUpperCase()}${message.slice(1).replace(/([^.])$/, '$1.')} Run alive5 --help or alive5 schema.`,
      EXIT.usage,
    );
  }
  return new CliError(
    'LOCAL_ERROR',
    e.code === 'ENOENT'
      ? 'Input file not found. Check the path.'
      : 'The command could not finish. Check your inputs and local configuration.',
    EXIT.local,
  );
}

export async function main(argv = process.argv) {
  const { program, json } = build();
  try {
    await program.parseAsync(argv);
  } catch (thrown) {
    // --help and --version exit successfully through the same throw path.
    if (thrown instanceof CommanderError && thrown.exitCode === 0) return;
    const e = toCliError(thrown, program);
    if (json()) console.log(JSON.stringify(failure(e)));
    else if (e.code !== 'CANCELLED') console.error(`\n  Error: ${safe(e.message)}\n`);
    process.exitCode = e.exitCode;
  }
}
