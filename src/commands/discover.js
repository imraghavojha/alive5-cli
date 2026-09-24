// Discovery for agents and for people: the machine-readable schema, shell
// completions, and local diagnostics. Nothing here needs credentials.

import { platform, release, homedir } from 'node:os';
import { access, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { VERSION, DOCS } from '../meta.js';
import { EXIT_CODES, envelope, usage } from '../errors.js';
import { configDir } from '../storage.js';
import { SEND_PATH } from '../api.js';
import { examples } from './shared.js';

/** One command as plain data: the same shape at every level of the tree. */
export function describe(cmd) {
  return {
    name: cmd.name(),
    description: cmd.description(),
    usage: cmd.usage(),
    arguments: cmd.registeredArguments.map((a) => ({
      name: a.name(),
      required: a.required,
      variadic: a.variadic,
      description: a.description || null,
    })),
    options: cmd.options.map((o) => ({
      flag: o.flags,
      description: o.description,
      required: Boolean(o.mandatory),
      takesValue: Boolean(o.required || o.optional),
      ...(o.defaultValue !== undefined && { default: o.defaultValue }),
      ...(o.argChoices && { choices: o.argChoices }),
    })),
    commands: cmd.commands.map(describe),
  };
}

const NOTES = [
  'No automatic retries. A failed send can have an unknown delivery result.',
  'One page per list call. Follow meta.nextPage explicitly.',
  'Use ISO dates (YYYY-MM-DD) and international phone numbers (+15555550100).',
  '--raw returns the API body with secret-looking fields removed.',
  '--fields works on read commands only and requires existing top-level field names.',
  'sms send requires --yes in noninteractive mode.',
  '--dry-run on sms send validates locally only; it makes no API request.',
  'Errors use the same envelope with ok:false and a nonzero exit code.',
];

const AUTH = {
  header: 'X-A5-APIKEY',
  environment: 'ALIVE5_API_KEY',
  stdin: 'alive5 auth login --key-stdin',
  storedAt: 'credentials.json in the config directory, mode 0600',
};

export function register(program, { write }) {
  const schema = program
    .command('schema')
    .argument('[path...]', 'optional command path, e.g. sms send')
    .description('Print machine-readable command discovery')
    .action((path) => {
      const target = resolve(program, path);
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
              failure:
                '{ok:false,data:null,error:{code,message,retryable,status?,field?,details?},meta:{schemaVersion:1}}',
              defaults: 'JSON when piped or given --json; text on a terminal',
            },
            authentication: AUTH,
            sideEffects: {
              writes: ['sms send'],
              localWrites: ['auth login', 'auth logout', 'appearance set'],
              endpoint: SEND_PATH,
            },
            exitCodes: EXIT_CODES,
            notes: NOTES,
          }),
        ),
      );
    });
  examples(schema, [
    'alive5 schema',
    'alive5 schema sms send',
    'alive5 schema | jq .data.commands',
  ]);

  const completion = program
    .command('completion')
    .argument('<shell>', 'bash, zsh, or fish')
    .description('Print a shell completion script')
    .action((shell) => {
      const generate = GENERATORS[shell];
      if (!generate) throw usage('Choose bash, zsh, or fish.');
      console.log(generate(program));
    });
  examples(completion, [
    'alive5 completion bash >> ~/.bashrc',
    'alive5 completion zsh > "${fpath[1]}/_alive5"',
    'alive5 completion fish > ~/.config/fish/completions/alive5.fish',
  ]);

  program
    .command('doctor')
    .description('Report local runtime, PATH, and configuration state; no network access')
    .action(async () => write(await diagnostics()));
}

function resolve(program, path) {
  let target = program;
  for (const part of path) {
    target = target.commands.find((c) => c.name() === part);
    if (!target) throw usage('Unknown command path. Run alive5 schema.');
  }
  return target;
}

async function diagnostics() {
  const dir = configDir();
  const present = async (name) => {
    try {
      const s = await stat(join(dir, name));
      return { present: true, mode: '0' + (s.mode & 0o777).toString(8) };
    } catch {
      return { present: false, mode: null };
    }
  };
  const onPath = (process.env.PATH || '').split(':').filter(Boolean);
  const found = [];
  for (const entry of onPath) {
    try {
      await access(join(entry, 'alive5'));
      found.push(join(entry, 'alive5'));
    } catch {
      /* not in this directory */
    }
  }
  return {
    version: VERSION,
    node: process.version,
    nodeSupported: Number(process.versions.node.split('.')[0]) >= 22,
    platform: `${platform()} ${release()}`,
    terminal: {
      isTTY: Boolean(process.stdout.isTTY),
      columns: process.stdout.columns || null,
      rows: process.stdout.rows || null,
      term: process.env.TERM || null,
      colorDepth: process.env.COLORTERM || null,
      noColor: 'NO_COLOR' in process.env,
    },
    // Only whether a key exists, never any part of its value.
    authentication: {
      environmentKey: Boolean(process.env.ALIVE5_API_KEY),
      credentials: await present('credentials.json'),
      appearance: await present('appearance.json'),
    },
    configDir: dir.replace(homedir(), '~'),
    executablesOnPath: found,
    networkChecked: false,
    next: found.length ? 'alive5 auth status' : 'Add the install directory to PATH',
  };
}

// Completion scripts are generated from the live command tree, so a new command
// is completable without touching these templates.
const names = (cmd) => cmd.commands.filter((c) => !c.hidden).map((c) => c.name());

const flagsOf = (cmd) => cmd.options.filter((o) => !o.hidden).map((o) => o.long || o.short);

function flatten(cmd, prefix = []) {
  const rows = [];
  for (const child of cmd.commands.filter((c) => !c.hidden)) {
    const path = [...prefix, child.name()];
    rows.push({ path, words: names(child), flags: flagsOf(child) });
    rows.push(...flatten(child, path));
  }
  return rows;
}

const GENERATORS = {
  bash: (program) => {
    const cases = flatten(program)
      .map((r) => `    "${r.path.join(' ')}") words="${[...r.words, ...r.flags].join(' ')}" ;;`)
      .join('\n');
    return `# alive5 bash completion. Source this file or append it to ~/.bashrc.
_alive5() {
  local cur path words
  cur="\${COMP_WORDS[COMP_CWORD]}"
  path="\${COMP_WORDS[*]:1:COMP_CWORD-1}"
  case "\$path" in
${cases}
    *) words="${[...names(program), ...flagsOf(program)].join(' ')}" ;;
  esac
  COMPREPLY=( \$(compgen -W "\$words" -- "\$cur") )
}
complete -F _alive5 alive5`;
  },
  zsh: (program) => {
    const cases = flatten(program)
      .map(
        (r) => `    "${r.path.join(' ')}") candidates=(${[...r.words, ...r.flags].join(' ')}) ;;`,
      )
      .join('\n');
    return `#compdef alive5
# alive5 zsh completion. Install as _alive5 on your fpath, then run compinit.
# \$words is zsh's current command line; candidates holds what we offer.
_alive5() {
  local seen candidates
  seen="\${words[2,CURRENT-1]}"
  case "\$seen" in
${cases}
    *) candidates=(${[...names(program), ...flagsOf(program)].join(' ')}) ;;
  esac
  compadd -a candidates
}
_alive5 "\$@"`;
  },
  fish: (program) => {
    const lines = flatten(program).flatMap((r) => {
      const condition = `__fish_seen_subcommand_from ${r.path.join(' ')}`;
      return [
        ...r.words.map((w) => `complete -c alive5 -n '${condition}' -a '${w}'`),
        ...r.flags.map((f) => `complete -c alive5 -n '${condition}' -l '${f.replace(/^--/, '')}'`),
      ];
    });
    const top = names(program).map(
      (n) => `complete -c alive5 -n '__fish_use_subcommand' -a '${n}'`,
    );
    return [
      '# alive5 fish completion. Save as ~/.config/fish/completions/alive5.fish.',
      ...top,
      ...lines,
    ].join('\n');
  },
};
