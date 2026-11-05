import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { conversations } from '../src/api.js';

const SINCE = Date.parse('2026-11-01');
const UNTIL = Date.parse('2026-11-06');
const row = (overrides = {}) => ({
  thread_id: 'active',
  channel_id: 'channel',
  channel_name: '+15555550100',
  created_by: '+15555550101',
  created_at: SINCE,
  message_content: 'Hello',
  ...overrides,
});
const response = (data) => new Response(JSON.stringify({ code: 200, data, error: null }));
const options = { since: '2026-11-01', until: '2026-11-06', apiKey: 'test-key' };

function feed(pages) {
  const calls = [];
  return {
    calls,
    fetchFn: async (url, init) => {
      const u = new URL(url);
      // v1.0 would return body code 404 for a thread started before --since.
      assert.equal(u.origin, 'https://api-v2.alive5.com');
      assert.equal(u.pathname, '/public/1.2/conversations/sms');
      assert.equal(init.method, 'GET');
      assert.equal(u.searchParams.get('limit'), '50');
      assert.equal(u.searchParams.has('date_start'), false);
      assert.equal(u.searchParams.has('date_end'), false);
      const page = Number(u.searchParams.get('page'));
      calls.push(page);
      assert.equal(page, calls.length);
      assert.ok(pages[page - 1], `Unexpected upstream page ${page}`);
      return response(pages[page - 1]);
    },
  };
}

test('SMS conversations scan past old pages and include all matching activity in an existing thread', async () => {
  const old = Array.from({ length: 50 }, (_, i) => row({ created_at: SINCE - i - 1 }));
  const messages = Array.from({ length: 60 }, (_, i) =>
    row({ message_id: `m${i}`, created_at: SINCE + i, message_content: `Message ${i}` }),
  );
  const f = feed([
    old,
    messages.slice(0, 50).reverse(),
    [
      ...messages.slice(50).reverse(),
      row({ created_at: UNTIL }),
      row({ created_at: UNTIL + 1 }),
      row({ channel_id: 'other' }),
    ],
  ]);
  const result = await conversations('sms', { ...options, ...f, channel: 'channel' });
  assert.deepEqual(f.calls, [1, 2, 3]);
  assert.deepEqual(result.meta, { page: 1, totalPages: 1, nextPage: null, totalRecords: 1 });
  assert.deepEqual(result.data, [
    {
      id: 'active',
      type: 'sms',
      channel: { id: 'channel', name: '+15555550100' },
      assignedTo: null,
      startedAt: null,
      endedAt: null,
      contact: { id: null, firstName: null, lastName: null, email: null, phone: null },
      tags: [],
      messages: messages.map((m) => ({
        id: m.message_id,
        at: new Date(m.created_at).toISOString(),
        sender: m.created_by,
        text: m.message_content,
      })),
    },
  ]);
});

test('SMS date boundaries are UTC and channel/thread filters apply locally', async () => {
  const f = feed([
    [
      row({ created_at: SINCE - 1 }),
      row({ created_at: new Date(SINCE).toISOString() }),
      row({ created_at: UNTIL - 1 }),
      row({ created_at: UNTIL }),
      row({ thread_id: 'other' }),
      row({ channel_id: 'other' }),
    ],
  ]);
  const result = await conversations('sms', {
    ...options,
    ...f,
    channel: 'channel',
    thread: 'active',
  });
  assert.equal(result.data.length, 1);
  assert.deepEqual(
    result.data[0].messages.map((m) => m.at),
    ['2026-11-01T00:00:00.000Z', '2026-11-05T23:59:59.999Z'],
  );
});

test('SMS grouping preserves available metadata and media without merging channels', async () => {
  const f = feed([
    [
      row({ created_at: SINCE + 1, created_by: 'Agent', agent_id: 'agent' }),
      row({
        crm_id: 'contact',
        contacts_first_name: 'Jane',
        contacts_phone: '+15555550101',
        media_url: 'https://example.com/image.png',
      }),
      row({ channel_id: 'other', created_at: SINCE + 2 }),
    ],
  ]);
  const { data } = await conversations('sms', { ...options, ...f });
  assert.equal(data.length, 2);
  assert.equal(data[0].channel.id, 'other');
  assert.equal(data[0].messages.length, 1);
  assert.equal(data[1].assignedTo, 'agent');
  assert.equal(data[1].contact.id, 'contact');
  assert.equal(data[1].contact.firstName, 'Jane');
  assert.equal(data[1].contact.phone, '+15555550101');
  assert.equal(data[1].messages[0].media, 'https://example.com/image.png');
  assert.equal(data[1].messages[1].sender, 'Agent');
});

test('SMS pages contain whole conversations with counts after filtering and grouping', async () => {
  const rows = Array.from({ length: 27 }, (_, i) =>
    row({ thread_id: `thread-${i}`, created_at: SINCE + i }),
  );
  // Every thread spans upstream pages; the CLI page must not split transcripts.
  const all = [...rows, ...rows.map((r) => ({ ...r, created_at: r.created_at + 100 }))];
  for (const page of [1, 2, 3]) {
    const f = feed([all.slice(0, 50), all.slice(50)]);
    const result = await conversations('sms', { ...options, ...f, page });
    assert.deepEqual(result.meta, {
      page,
      totalPages: 2,
      nextPage: page === 1 ? 2 : null,
      totalRecords: 27,
    });
    assert.equal(result.data.length, page === 1 ? 25 : page === 2 ? 2 : 0);
    assert.ok(result.data.every((c) => c.messages.length === 2));
    if (page === 1) assert.equal(result.data[0].id, 'thread-26');
    if (page === 2)
      assert.deepEqual(
        result.data.map((c) => c.id),
        ['thread-1', 'thread-0'],
      );
    assert.deepEqual(f.calls, [1, 2]);
  }
});

test('SMS raw output keeps its transcript/page shape and sanitized original message rows', async () => {
  const original = row({ api_key: 'hidden', message_content: 'test-key', custom_field: 'kept' });
  const f = feed([[original]]);
  const result = await conversations('sms', { ...options, ...f, raw: true });
  assert.equal(result.data.page, 1);
  assert.equal(result.data.pages, 1);
  assert.equal(result.data.Items[0].alive5_sessionID, 'active');
  const [message] = result.data.Items[0].chat_conversation;
  assert.equal(message.custom_field, 'kept');
  assert.equal(message.api_key, undefined);
  assert.equal(message.message_content, '[redacted]');
});

test('SMS empty feeds, unmatched filters and equal date boundaries return successful empty lists', async () => {
  for (const [rows, filters] of [
    [[], {}],
    [[row()], { channel: 'missing' }],
    [[row()], { thread: 'missing' }],
    [[row()], { until: options.since }],
  ]) {
    const f = feed([rows]);
    const result = await conversations('sms', { ...options, ...filters, ...f });
    assert.deepEqual(result, {
      data: [],
      meta: { page: 1, totalPages: 0, nextPage: null, totalRecords: 0 },
    });
  }
});

test('SMS scans preserve real authentication, not-found, rate-limit and server errors', async () => {
  for (const status of [401, 404, 429, 500]) {
    for (const httpStatus of [200, status]) {
      await assert.rejects(
        conversations('sms', {
          ...options,
          fetchFn: async () =>
            new Response(JSON.stringify({ code: status, data: null, error: 'API failure' }), {
              status: httpStatus,
            }),
        }),
        (e) => e.status === status && e.message === 'API failure',
      );
    }
  }
});

test('SMS scans report malformed rows, repeated pages and exhausted scan limits as incomplete', async () => {
  for (const invalid of [
    row({ created_at: null }),
    row({ created_at: 'invalid' }),
    row({ thread_id: null }),
    row({ channel_id: null }),
  ]) {
    const f = feed([[invalid]]);
    await assert.rejects(conversations('sms', { ...options, ...f }), {
      code: 'CONVERSATIONS_INCOMPLETE',
      exitCode: 4,
    });
  }
  const full = Array.from({ length: 50 }, (_, i) => row({ created_at: SINCE + i }));
  const f = feed([full, full]);
  await assert.rejects(conversations('sms', { ...options, ...f }), {
    code: 'CONVERSATIONS_INCOMPLETE',
  });
  assert.deepEqual(f.calls, [1, 2]);
  let calls = 0;
  await assert.rejects(
    conversations('sms', {
      ...options,
      fetchFn: async () => {
        calls++;
        return response(full.map((r) => ({ ...r, created_at: SINCE - calls })));
      },
    }),
    { code: 'CONVERSATIONS_INCOMPLETE' },
  );
  assert.equal(calls, 100);
});

test('SMS validation and cancellation stop before making requests', async () => {
  const fetchFn = async () => assert.fail('Must not request invalid or aborted queries');
  for (const invalid of [
    { since: '2026-02-30' },
    { until: '2026-10-31' },
    { page: 'bad' },
    { page: '0' },
  ]) {
    await assert.rejects(conversations('sms', { ...options, ...invalid, fetchFn }));
  }
  await assert.rejects(conversations('sms', { ...options, fetchFn, signal: AbortSignal.abort() }), {
    name: 'AbortError',
  });
});

test('conversations list CLI emits successful JSON for active SMS threads and empty ranges', () => {
  for (const rows of [[row()], []]) {
    // Run the actual parser/output path with fetch replaced; never use production credentials.
    const preload = `globalThis.fetch = async (url, init) => {
      if (init.method !== 'GET' || !String(url).includes('/public/1.2/conversations/sms?'))
        throw new Error('Unexpected request');
      return new Response(${JSON.stringify(JSON.stringify({ code: 200, data: rows, error: null }))});
    };`;
    const result = spawnSync(
      process.execPath,
      [
        '--import',
        `data:text/javascript,${encodeURIComponent(preload)}`,
        'bin/alive5.js',
        'conversations',
        'list',
        '--channel',
        'channel',
        '--since',
        options.since,
        '--until',
        options.until,
      ],
      { encoding: 'utf8', env: { ...process.env, ALIVE5_API_KEY: 'test-key' } },
    );
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.equal(result.stderr, '');
    const body = JSON.parse(result.stdout);
    assert.equal(body.ok, true);
    assert.equal(body.error, null);
    assert.equal(body.meta.schemaVersion, 1);
    assert.equal(body.data.length, rows.length);
    if (rows.length) assert.equal(body.data[0].messages[0].text, 'Hello');
  }
});
