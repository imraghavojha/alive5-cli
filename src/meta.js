import { createRequire } from 'node:module';

export const { version: VERSION, description: DESCRIPTION } = createRequire(import.meta.url)(
  '../package.json',
);

export const DOCS = 'https://documenter.getpostman.com/view/12135254/UVsQr3zh';

export const USER_AGENT = `alive5-cli/${VERSION}`;
