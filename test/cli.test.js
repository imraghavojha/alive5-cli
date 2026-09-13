import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, stat, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  request,
  unwrap,
  clean,
  dateRange,
  phone,
  saveConfig,
  config,
  logout,
  CliError,
} from '../src/core.js';
import { send, conversation, conversations, contacts, messages } from '../src/api.js';
import { safe } from '../src/ui.js';
const run = (args) =>
  spawnSync(process.execPath, ['bin/alive5.js', ...args], {
    encoding: 'utf8',
    env: {
      ...process.env,
      ALIVE5_API_KEY: '',
      ALIVE5_CONFIG_DIR: join(tmpdir(), 'alive5-test-no-credentials'),
    },
  });
const response = (body) => new Response(JSON.stringify(body));

test('agent discovery and parser errors emit exactly one JSON document', () => {
  for (const args of [
    [],
    ['schema'],
    ['channels', 'list', '--bogus'],
    ['contacts', 'list', '--limit', 'abc'],
    ['auth', 'login', '--no-input'],
  ]) {
    const r = run(args),
      j = JSON.parse(r.stdout);
    assert.equal(j.meta.schemaVersion, 1);
    assert.equal(r.stderr, '');
    assert.equal(r.stdout.includes('\x1b'), false);
  }
  assert.equal(run(['channels', 'list', '--bogus']).status, 2);
  assert.equal(run(['auth', 'status']).status, 3);
});
test('date and phone inputs reject ambiguous or impossible values', () => {
  assert.deepEqual(dateRange('2026-09-01', '2026-09-12'), ['09-01-2026', '09-12-2026']);
  for (const pair of [
    ['2026-02-30', '2026-03-01'],
    ['09-01-2026', '2026-09-12'],
    ['2026-09-13', '2026-09-12'],
  ])
    assert.throws(() => dateRange(...pair), CliError);
  assert.equal(phone('+1 (555) 555-0101'), '+15555550101');
  assert.throws(() => phone('5555550101'));
});
test('nested API errors cannot masquerade as successful sends', async () => {
  assert.throws(
    () => unwrap({ code: 200, data: { code: 400, error: 'invalid user' } }),
    /invalid user/,
  );
  const data = await request('https://api.alive5.com/public/1.0/account', {
    apiKey: 'secret',
    fetchFn: async () =>
      response({
        code: 200,
        data: { code: 200, data: { id: 'a', api_key: 'secret' }, error: null },
        error: null,
      }),
  });
  assert.deepEqual(data, { id: 'a' });
  assert.deepEqual(clean({ token: 'x', nested: { apiKey: 'x', text: 'secret' } }, 'secret'), {
    nested: { text: '[redacted]' },
  });
});
test('send uses documented multipart fields, does not retry, and marks uncertain delivery', async () => {
  const options = {
    from: '+15555550100',
    to: '+15555550101',
    message: 'A test',
    channel: 'channel',
    user: 'user',
    apiKey: 'secret',
  };
  let calls = 0;
  const d = await send({
    ...options,
    fetchFn: async (url, init) => {
      calls++;
      assert.equal(new URL(url).pathname, '/public/1.0/conversations/sms/send');
      assert.equal(init.method, 'POST');
      assert.equal(init.headers['X-A5-APIKEY'], 'secret');
      assert.equal(init.body.get('phone_number_to'), options.to);
      assert.equal(init.body.get('channel_id'), 'channel');
      assert.equal(init.redirect, 'error');
      return response({
        code: 200,
        data: { code: 200, data: { message_id: 'm', message_status: 'sent' }, error: null },
        error: null,
      });
    },
  });
  assert.equal(calls, 1);
  assert.equal(d.id, 'm');
  assert.equal(d.deliveryConfirmed, false);
  calls = 0;
  await assert.rejects(
    () =>
      send({
        ...options,
        fetchFn: async () => {
          calls++;
          throw new Error('timeout secret');
        },
      }),
    (e) => e.deliveryUnknown && !e.retryable && !e.message.includes('secret'),
  );
  assert.equal(calls, 1);
});
test('dry run works without credentials; sending requires explicit intent', () => {
  const args = [
    'sms',
    'send',
    '--from',
    '+15555550100',
    '--to',
    '+15555550101',
    '--channel',
    'c',
    '--user',
    'u',
    '--message',
    'hello',
  ];
  const preview = run([...args, '--dry-run']);
  assert.equal(preview.status, 0);
  assert.equal(JSON.parse(preview.stdout).data.preview, true);
  assert.equal(JSON.parse(run(args).stdout).error.code, 'CONFIRMATION_REQUIRED');
  assert.equal(run([...args, '--message-file', '-', '--dry-run']).status, 2);
  assert.equal(run([...args, '--yes', '--fields', 'bogus']).status, 2);
});
test('contact pagination preserves counts and API query names', async () => {
  const r = await contacts({
    page: 2,
    limit: 3,
    apiKey: 'secret',
    fetchFn: async (u) => {
      assert.equal(new URL(u).searchParams.get('page'), '2');
      assert.equal(new URL(u).searchParams.get('limit'), '3');
      return response({
        code: 200,
        data: {
          Items: [{ crm_id: 'c', first_name: 'Test' }],
          page: 2,
          totalPages: 4,
          totalRecord: 12,
        },
        error: null,
      });
    },
  });
  assert.equal(r.data[0].id, 'c');
  assert.deepEqual(r.meta, { page: 2, totalPages: 4, nextPage: 3, totalRecords: 12 });
});
test('transcript normalization handles both public API shapes and page indexing', async () => {
  const sms = conversation(
    {
      alive5_sessionID: 's',
      contacts_first_name: 'Jane',
      start_time: 0,
      chat_conversation: [{ created_at: 1000, created_by: 'Jane', message_content: 'Hi' }],
    },
    'sms',
  );
  assert.equal(sms.messages[0].at, '1970-01-01T00:00:01.000Z');
  assert.equal(sms.contact.firstName, 'Jane');
  const live = conversation(
    {
      threadData: { thread_id: 't', crmData: { first_name: 'J' } },
      threadConversation: [{ _source: { message_id: 'm', message_content: 'Hello' } }],
    },
    'livechat',
  );
  assert.equal(live.messages[0].id, 'm');
  const page = await conversations('livechat', {
    since: '2026-09-01',
    until: '2026-09-13',
    apiKey: 's',
    fetchFn: async (u) => {
      assert.equal(new URL(u).searchParams.get('page'), '0');
      return response({ code: 200, data: { Items: [], page: 0, pages: 2 }, error: null });
    },
  });
  assert.equal(page.meta.page, 1);
  assert.equal(page.meta.nextPage, 2);
  assert.equal(page.meta.totalPages, 3);
  const rows = await messages({
    since: '2026-09-12',
    until: '2026-09-13',
    apiKey: 's',
    fetchFn: async (u) => {
      assert.equal(new URL(u).protocol, 'https:');
      assert.equal(new URL(u).pathname, '/public/1.2/conversations/sms');
      return response({
        code: 200,
        data: [{ message_content: 'hello', thread_id: 't' }],
        error: null,
      });
    },
  });
  assert.equal(rows[0].text, 'hello');
});
test('HTTP rate limits and invalid responses remain structured', async () => {
  await assert.rejects(
    () =>
      request('https://api.alive5.com/public/1.0/account', {
        apiKey: 's',
        fetchFn: async () => new Response('{}', { status: 429, headers: { 'retry-after': '10' } }),
      }),
    (e) => e.exitCode === 5 && e.retryable && e.retryAfter === '10',
  );
  await assert.rejects(
    () =>
      request('https://api.alive5.com/public/1.0/account', {
        apiKey: 's',
        fetchFn: async () => new Response('<html>secret</html>'),
      }),
    (e) => e.code === 'INVALID_RESPONSE',
  );
  await assert.rejects(
    () => request('https://example.com', { apiKey: 's' }),
    (e) => e.code === 'INVALID_HOST',
  );
});
test('credentials are private, replace atomically, and logout removes only saved auth', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'alive5-config-'));
  const previous = process.env.ALIVE5_CONFIG_DIR;
  process.env.ALIVE5_CONFIG_DIR = dir;
  try {
    await saveConfig({ apiKey: 'test-key' });
    assert.equal((await stat(join(dir, 'credentials.json'))).mode & 0o777, 0o600);
    assert.equal((await config()).apiKey, 'test-key');
    await saveConfig({ apiKey: 'next' });
    assert.equal(JSON.parse(await readFile(join(dir, 'credentials.json'), 'utf8')).apiKey, 'next');
    await logout();
    assert.deepEqual(await config(), {});
  } finally {
    if (previous === undefined) delete process.env.ALIVE5_CONFIG_DIR;
    else process.env.ALIVE5_CONFIG_DIR = previous;
    await rm(dir, { recursive: true, force: true });
  }
});
test('terminal content cannot inject escape sequences', () => {
  assert.equal(safe('hello\x1b[2J\nworld').includes('\x1b'), false);
});

test('agents discover, preview, save, and read appearance without credentials or ANSI', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'alive5-agent-appearance-'));
  const command = (...args) =>
    spawnSync(process.execPath, ['bin/alive5.js', ...args], {
      encoding: 'utf8',
      env: { ...process.env, ALIVE5_CONFIG_DIR: dir, ALIVE5_API_KEY: '' },
    });
  try {
    const schema = JSON.parse(command('schema', 'appearance', 'set').stdout);
    assert.ok(
      schema.data.commands.options
        .find((o) => o.flag === '--effect <value>')
        .choices.includes('cosmos'),
    );
    const saved = command(
      'appearance',
      'set',
      '--logo',
      'frame',
      '--effect',
      'cosmos',
      '--motion',
      'full',
    );
    assert.equal(saved.status, 0);
    assert.equal(saved.stdout.includes('\x1b'), false);
    assert.deepEqual(JSON.parse(saved.stdout).data, {
      logo: 'frame',
      effect: 'cosmos',
      motion: 'full',
      saved: true,
    });
    const preview = command('appearance', 'set', '--motion', 'off', '--dry-run');
    assert.equal(JSON.parse(preview.stdout).data.saved, false);
    assert.equal(JSON.parse(command('appearance', 'get').stdout).data.motion, 'full');
    const before = await readFile(join(dir, 'appearance.json'), 'utf8');
    assert.equal(command('appearance', 'set', '--effect', 'invalid').status, 2);
    assert.equal(command('appearance', 'set').status, 2);
    assert.equal(await readFile(join(dir, 'appearance.json'), 'utf8'), before);
    assert.equal((await stat(join(dir, 'appearance.json'))).mode & 0o777, 0o600);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
