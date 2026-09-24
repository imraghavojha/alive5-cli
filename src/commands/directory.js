// Read-only discovery commands: channels, users, tags, and contacts.
import * as api from '../api.js';
import { group, examples, pageOption } from './shared.js';

export function register(program, { write, opts }) {
  const list = (parent, description, run) => {
    const cmd = parent.command('list').description(description);
    cmd.action(async (o, c) => run(o, c));
    return cmd;
  };

  list(
    group(program, 'channels', 'Discover channel and user IDs'),
    'List channels with their users',
    async (o, cmd) => write(await api.channels(opts(cmd))),
  );

  list(
    group(program, 'users', 'Discover users across channels'),
    'List users and channel memberships',
    async (o, cmd) => write(await api.users(opts(cmd))),
  );

  list(group(program, 'tags', 'Discover tags'), 'List tag IDs and names', async (o, cmd) =>
    write(await api.tags(opts(cmd))),
  );

  const contacts = group(program, 'contacts', 'Read your contact directory');
  examples(contacts, ['alive5 contacts list', 'alive5 contacts list --help']);
  pageOption(
    list(contacts, 'Read one page of contacts', async (o, cmd) => {
      const r = await api.contacts(opts(cmd));
      write(r.data, r.meta);
    }),
  ).option('--limit <number>', 'contacts per page, 1–100', '25');
}
