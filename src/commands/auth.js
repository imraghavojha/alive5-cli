import * as api from '../api.js';
import * as shape from '../normalize.js';
import { CliError, EXIT } from '../errors.js';
import { saveConfig, logout } from '../storage.js';
import { validateKey } from '../validate.js';
import { banner, login } from '../prompts.js';
import { group, examples, stdinText, requirePipe } from './shared.js';

export function register(program, { write, opts, canPrompt }) {
  const auth = group(program, 'auth', 'Connect your Alive5 account');
  examples(auth, [
    'alive5 auth login',
    'cat key.txt | alive5 auth login --key-stdin',
    'ALIVE5_API_KEY=... alive5 auth status',
  ]);

  auth
    .command('login')
    .description('Paste and validate an API key')
    .option('--key-stdin', 'read the key from standard input')
    .action(async (o, cmd) => {
      let apiKey;
      if (o.keyStdin) {
        requirePipe('--key-stdin');
        apiKey = validateKey((await stdinText(8192)).trim());
      } else if (!canPrompt()) {
        throw new CliError(
          'AUTH_REQUIRED',
          'Use --key-stdin or ALIVE5_API_KEY for noninteractive authentication.',
          EXIT.auth,
        );
      }
      if (apiKey) {
        const data = await api.account({ ...opts(cmd), apiKey });
        await saveConfig({ apiKey });
        write({ connected: true, organization: data.org_name });
        return;
      }
      await banner();
      const data = await login(opts(cmd));
      write({ connected: true, organization: data.org_name });
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
      write(options.raw ? d : shape.account(d));
    });
}
