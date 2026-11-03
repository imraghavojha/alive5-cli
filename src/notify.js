import { execFile } from 'node:child_process';

const SCRIPT =
  'on run argv\n display notification (item 2 of argv) with title ("Alive5: " & item 1 of argv)\nend run';

export function notifier({
  platform = process.platform,
  run = execFile,
  warn = console.error,
} = {}) {
  if (platform !== 'darwin') {
    warn('Notifications are available on macOS only; continuing without notifications.');
    return () => {};
  }
  let warned = false;
  return ({ from, text }) => {
    run(
      '/usr/bin/osascript',
      ['-e', SCRIPT, '--', from.replaceAll('\0', ''), text.replaceAll('\0', '')],
      { timeout: 5000 },
      (error) => {
        if (error && !warned) {
          warned = true;
          warn('Could not show a macOS notification; continuing to receive texts.');
        }
      },
    );
  };
}
