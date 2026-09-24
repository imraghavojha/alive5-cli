// Reading and sending messages: sms list, sms send, conversations, and reports.
import { readFile } from 'node:fs/promises';
import * as p from '@clack/prompts';
import * as api from '../api.js';
import { CliError, EXIT, usage } from '../errors.js';
import { render, safe } from '../output.js';
import { unwrapPrompt } from '../prompts.js';
import {
  group,
  examples,
  dateOptions,
  pageOption,
  choice,
  stdinText,
  requirePipe,
} from './shared.js';

export function register(program, { write, opts, canPrompt }) {
  const conversations = group(program, 'conversations', 'Read conversation transcripts');
  examples(conversations, ['alive5 conversations list --help']);
  const conversationList = dateOptions(
    conversations.command('list').description('Read one page of conversations'),
  );
  examples(conversationList, [
    'alive5 conversations list --since 2026-09-01 --until 2026-09-08',
    'alive5 conversations list --type livechat --timezone -5:00 --since 2026-09-01 --until 2026-09-02',
    'alive5 conversations list --channel C --page 2 --since 2026-09-01 --until 2026-09-08',
  ]);
  pageOption(conversationList)
    .addOption(choice('--type <type>', 'conversation type', api.CONVERSATION_TYPES, 'sms'))
    .option('--channel <id>', 'channel ID filter, sms/fbm')
    .option('--thread <id>', 'conversation ID filter, sms/fbm')
    .option('--timezone <offset>', 'live chat UTC offset, e.g. -5:00', '+0:00')
    .action(async (o, cmd) => {
      const r = await api.conversations(o.type, opts(cmd));
      write(r.data, r.meta);
    });

  dateOptions(
    group(program, 'reports', 'Read public API reports')
      .command('summary')
      .description('Read the documented conversation summary'),
  ).action(async (o, cmd) => write(await api.summary(opts(cmd))));

  const sms = group(program, 'sms', 'Send and read text messages');
  examples(sms, ['alive5 sms list --help', 'alive5 sms send --help']);

  examples(
    dateOptions(
      sms.command('list').description('Read messages sent within a date range, across all threads'),
    ).action(async (o, cmd) => write(await api.messages(opts(cmd)))),
    ['alive5 sms list --since 2026-09-01 --until 2026-09-08', 'alive5 sms list --json | jq .data'],
  );

  const send = sms
    .command('send')
    .description('Send one SMS. Use --dry-run to preview; --yes to send without a prompt.')
    .requiredOption('--from <number>', 'Alive5 number, including country code')
    .requiredOption('--to <number>', 'recipient number, including country code')
    .requiredOption('--channel <id>', 'channel ID from channels list')
    .requiredOption('--user <id>', 'user ID in that channel')
    .option('--message <text>', 'message text')
    .option('--message-file <path>', 'UTF-8 text file, or - for stdin')
    .option('--dry-run', 'validate locally and preview without an API request')
    .option('--yes', 'send without confirmation')
    .action(async (o, cmd) => {
      const options = { ...opts(cmd), message: await messageBody(o) };
      const preview = await api.send({ ...options, dryRun: true });
      if (o.dryRun) return write(preview);
      if (!o.yes) {
        if (!canPrompt())
          throw new CliError(
            'CONFIRMATION_REQUIRED',
            'Preview with --dry-run, then add --yes to send.',
            EXIT.usage,
          );
        render(preview);
        const confirmed = unwrapPrompt(
          await p.confirm({ message: `Send to ${safe(o.to)}?`, initialValue: false }),
        );
        if (!confirmed) throw new CliError('CANCELLED', 'Nothing sent.', EXIT.cancelled);
      }
      write(await api.send(options));
    });
  examples(send, [
    'alive5 sms send --from +15555550100 --to +15555550101 --channel C --user U --message "Hi" --dry-run',
    'alive5 sms send --from +15555550100 --to +15555550101 --channel C --user U --message-file note.txt --yes',
    'echo "Hi" | alive5 sms send --from +1... --to +1... --channel C --user U --message-file - --yes',
  ]);
}

/** Exactly one of --message or --message-file, with `-` meaning standard input. */
async function messageBody(o) {
  if ((o.message === undefined) === (o.messageFile === undefined))
    throw usage('Provide exactly one of --message or --message-file.');
  if (!o.messageFile) return o.message;
  if (o.messageFile === '-') {
    requirePipe('--message-file -');
    return stdinText();
  }
  return readFile(o.messageFile, 'utf8');
}
