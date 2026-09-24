// Helpers every command group uses: subcommand groups that fail usefully,
// the shared date-range options, and stdin reading.

import { Option } from 'commander';
import { CliError, EXIT, usage } from '../errors.js';

/**
 * Commander's default for a command with subcommands and no action is to print
 * help and throw `(outputHelp)`. Name the missing subcommand instead.
 */
export function group(parent, name, description) {
  const cmd = parent.command(name).description(description);
  cmd.action(() => {
    const names = cmd.commands.map((c) => c.name()).join(', ');
    throw new CliError(
      'SUBCOMMAND_REQUIRED',
      `alive5 ${cmd.name()} needs a subcommand: ${names}. Run alive5 ${cmd.name()} --help.`,
      EXIT.usage,
      { details: { command: cmd.name(), subcommands: cmd.commands.map((c) => c.name()) } },
    );
  });
  return cmd;
}

/** The documented `--since`/`--until` pair, shared so the wording cannot drift. */
export const dateOptions = (cmd) =>
  cmd
    .requiredOption('--since <date>', 'start date, YYYY-MM-DD')
    .requiredOption(
      '--until <date>',
      'upper date boundary, YYYY-MM-DD; use the next day to include a full day',
    );

export const pageOption = (cmd) => cmd.option('--page <number>', 'page number', '1');

export const choice = (flags, description, choices, fallback) => {
  const option = new Option(flags, description).choices(choices);
  return fallback === undefined ? option : option.default(fallback);
};

/** Adds an "Examples" block to a command's help. */
export const examples = (cmd, lines) =>
  cmd.addHelpText('after', '\nExamples:\n' + lines.map((l) => '  ' + l).join('\n') + '\n');

export async function stdinText(max = 65536) {
  let text = '';
  for await (const chunk of process.stdin) {
    text += chunk;
    if (Buffer.byteLength(text) > max)
      throw new CliError(
        'INPUT_TOO_LARGE',
        `Standard input must be at most ${max} bytes.`,
        EXIT.usage,
      );
  }
  return text;
}

export const requirePipe = (flag) => {
  if (process.stdin.isTTY) throw usage(`Pipe input into ${flag}.`);
};
