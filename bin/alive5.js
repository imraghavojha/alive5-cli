#!/usr/bin/env node
if (process.argv.includes('--no-color')) process.env.NO_COLOR = '1';
const { main } = await import('../src/cli.js');
await main();
