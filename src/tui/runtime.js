// Terminal lifecycle for the workspace: raw mode, signals, the animation timer,
// and guaranteed restoration. The Workspace itself stays free of process state.

import { emitKeypressEvents } from 'node:readline';
import { PassThrough } from 'node:stream';
import { Terminal } from './terminal.js';
import { Workspace } from './workspace.js';
import { createDecoder } from './input.js';
import { showsBanner } from './layout.js';
import { appearance } from '../storage.js';

const FRAME_INTERVAL_MS = 1000 / 20;
const ANIMATION_INTERVAL_MS = 160;
const ENTRANCE_WINDOW_MS = 900;

export async function launchTui(options = {}) {
  const terminal = new Terminal();
  const settings = options.settings || (await appearance());
  const input = new PassThrough();
  emitKeypressEvents(input);

  let resolveExit;
  let rejectExit;
  const exited = new Promise((resolve, reject) => {
    resolveExit = resolve;
    rejectExit = reject;
  });

  let workspace;
  let finished = false;
  let scheduled = false;
  let timer;

  const draw = () => {
    if (finished) return;
    scheduled = false;
    terminal.render(workspace.frame(process.stdout.columns || 80, process.stdout.rows || 24));
  };
  // Many state changes can land in one tick; only one render follows them.
  const change = () => {
    if (scheduled) return;
    scheduled = true;
    setImmediate(draw);
  };

  const onError = (e) => {
    restore();
    rejectExit(e);
  };
  const onTerminate = () => {
    restore();
    process.exitCode = 130;
    resolveExit();
  };
  const onResize = () => {
    terminal.previous = [];
    change();
  };
  const decoder = createDecoder({
    onKeys: (value) => input.write(value),
    onPaste: (text) => workspace.insert(text),
    onEscape: () => workspace.handleKey('', { name: 'escape' }).catch(onError),
  });
  const onData = (chunk) => decoder.feed(chunk);

  function restore() {
    if (finished) return;
    finished = true;
    clearInterval(timer);
    decoder.stop();
    process.stdin.removeListener('data', onData);
    input.removeAllListeners();
    process.stdout.removeListener('resize', onResize);
    process.removeListener('SIGTERM', onTerminate);
    process.removeListener('SIGINT', onTerminate);
    process.removeListener('uncaughtException', onError);
    process.removeListener('unhandledRejection', onError);
    process.stdin.setRawMode?.(false);
    process.stdin.pause();
    terminal.close();
  }

  workspace = new Workspace({
    ...options,
    settings,
    onChange: change,
    onExit: (code = 0) => {
      restore();
      process.exitCode = code;
      resolveExit();
    },
  });
  input.on('keypress', (s, k) => {
    Promise.resolve(workspace.handleKey(s, k)).catch(onError);
  });

  terminal.open();
  process.stdin.setRawMode?.(true);
  process.stdin.setEncoding('utf8');
  process.stdin.resume();
  process.stdin.on('data', onData);
  process.stdout.on('resize', onResize);
  process.on('SIGTERM', onTerminate);
  process.on('SIGINT', onTerminate);
  process.on('uncaughtException', onError);
  process.on('unhandledRejection', onError);
  draw();

  // One capped scheduler. Static screens and task panels perform no render work.
  let lastAnimation = 0;
  timer = setInterval(() => {
    if (finished || !showsBanner(workspace.state.panel.kind)) return;
    const now = performance.now();
    const settling = now - workspace.replayAt < ENTRANCE_WINDOW_MS;
    if (!settling && now - lastAnimation < ANIMATION_INTERVAL_MS) return;
    lastAnimation = now;
    if (workspace.state.motion === 'full' || (workspace.state.motion === 'subtle' && settling))
      draw();
  }, FRAME_INTERVAL_MS);

  if (!options.account) workspace.connect().catch(onError);
  await exited;
}
