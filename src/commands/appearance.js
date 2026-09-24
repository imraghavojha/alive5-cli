// Local appearance preferences. No authentication and no network access.
import { Option } from 'commander';
import { appearance, saveAppearance, appearanceChoices } from '../storage.js';
import { usage } from '../errors.js';
import { group, examples } from './shared.js';

const DESCRIPTIONS = {
  logo: 'set logo; frame is Label, variation 8',
  motion: 'set motion; full is continuous, subtle is entrance only',
  effect: 'set animation effect',
  theme: 'set dark, light, terminal-native, or high-contrast colors',
};

export function register(program, { write }) {
  const style = group(
    program,
    'appearance',
    'Read or save local appearance settings; no authentication needed',
  );
  examples(style, [
    'alive5 appearance get',
    'alive5 appearance set --logo frame --motion subtle',
    'alive5 appearance set --motion off --dry-run',
  ]);

  style
    .command('get')
    .description('Read saved logo, motion, effect, and theme settings')
    .action(async () => write(await appearance()));

  const set = style.command('set').description('Save local appearance settings without prompts');
  for (const [key, choices] of Object.entries(appearanceChoices))
    set.addOption(new Option(`--${key} <value>`, DESCRIPTIONS[key]).choices(choices));

  set.option('--dry-run', 'preview settings without saving').action(async (options) => {
    const changes = Object.fromEntries(
      Object.keys(appearanceChoices)
        .filter((key) => options[key] !== undefined)
        .map((key) => [key, options[key]]),
    );
    if (!Object.keys(changes).length)
      throw usage(
        'Specify --logo, --motion, --effect, or --theme. Run alive5 appearance set --help.',
      );
    const settings = { ...(await appearance()), ...changes };
    if (!options.dryRun) await saveAppearance(settings);
    write({ ...settings, saved: !options.dryRun });
  });
}
