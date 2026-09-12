#!/usr/bin/env node
if (process.argv.includes('--no-color')) process.env.NO_COLOR = '1';
const { main } = await import('../src/cli.js');
process.stdout.on('error', (e) => {
  if (e.code === 'EPIPE') process.exit(0);
  throw e;
});
await main();
