// Documented public Alive5 endpoints. Each function builds the request, then
// hands the body to ./normalize.js unless --raw asked for the untouched shape.

import { request, items, pagination, query } from './http.js';
import * as shape from './normalize.js';
import { dateRange, phone, integer, messageText, timezoneOffset } from './validate.js';
import { usage } from './errors.js';

const V1 = 'https://api.alive5.com/public/1.0';
const V2 = 'https://api-v2.alive5.com/public';

export const CONVERSATION_TYPES = ['sms', 'livechat', 'fbm'];
export const SEND_PATH = `${V1}/conversations/sms/send`;

export const account = (options) => request(`${V1}/account`, options);

export async function channels(options) {
  const d = await request(`${V2}/1.0/objects/channels-and-users/list`, options);
  return options?.raw ? d : items(d).map(shape.channel);
}

export async function tags(options) {
  const d = await request(`${V2}/1.0/objects/tags/list`, options);
  return options?.raw ? d : items(d).map(shape.tag);
}

/** Users are derived from channel membership; the API has no separate user list. */
export async function users(options) {
  const list = await channels({ ...options, raw: false });
  const byId = new Map();
  for (const ch of list)
    for (const u of ch.users) {
      if (!byId.has(u.id)) byId.set(u.id, { ...u, channelIds: [] });
      byId.get(u.id).channelIds.push(ch.id);
    }
  return [...byId.values()];
}

export async function contacts(options = {}) {
  const page = integer(options.page || 1, 'page');
  const limit = integer(options.limit || 25, 'limit', 100);
  const d = await request(query(`${V2}/1.0/objects/contact/get-all`, { page, limit }), options);
  return { data: options.raw ? d : items(d).map(shape.contact), meta: pagination(d, page) };
}

export async function conversations(type, options = {}) {
  if (!CONVERSATION_TYPES.includes(type)) throw usage('Choose sms, livechat, or fbm.');
  const [start, end] = dateRange(options.since, options.until);
  const page = integer(options.page || 1, 'page');
  const live = type === 'livechat';
  if (live && (options.channel || options.thread))
    throw usage('--channel and --thread are documented for sms and fbm only.');
  // Live chat pages are zero-indexed upstream; the CLI is one-indexed everywhere.
  const params = live
    ? {
        datetime_from: start,
        datetime_to: end,
        page: page - 1,
        timezone_offset: timezoneOffset(options.timezone || '+0:00'),
      }
    : {
        date_start: start,
        date_end: end,
        page,
        channel_id: options.channel,
        alive5_sessionID: options.thread,
      };
  const d = await request(
    query(`${V2}/${live ? '2.0' : '1.0'}/conversations/${type}`, params),
    options,
  );
  return {
    data: options.raw ? d : items(d).map((c) => shape.conversation(c, type)),
    meta: live ? livePagination(d, page) : pagination(d, page),
  };
}

function livePagination(d, page) {
  const upstream = Number(d.page ?? page - 1);
  const total = d.pages == null ? null : Number(d.pages);
  return {
    ...pagination(d, page - 1),
    page: upstream + 1,
    totalPages: total == null ? null : total + 1,
    nextPage: total != null && upstream < total ? page + 1 : null,
  };
}

export async function summary(options) {
  const [start, end] = dateRange(options.since, options.until);
  return request(
    query(`${V2}/1.0/conversations/summary`, { from_datetime: start, date_end: end }),
    options,
  );
}

export async function messages(options) {
  const [start, end] = dateRange(options.since, options.until);
  const d = await request(
    query(`${V2}/1.2/conversations/sms`, { date_start: start, date_end: end }),
    options,
  );
  return options.raw ? d : items(d).map(shape.smsRow);
}

/** Validates a send locally and returns the exact multipart fields that would be posted. */
export function sendForm(options) {
  if (!options.channel || !options.user)
    throw usage('--channel and --user are required. Find IDs with alive5 channels list.');
  return {
    phone_number_from: phone(options.from, 'from'),
    phone_number_to: phone(options.to, 'to'),
    message: messageText(options.message),
    channel_id: options.channel,
    user_id: options.user,
  };
}

export async function send(options) {
  const form = sendForm(options);
  if (options.dryRun)
    return { preview: true, validated: 'locally', method: 'POST', url: SEND_PATH, form };
  const d = await request(SEND_PATH, { ...options, method: 'POST', form });
  return options.raw
    ? d
    : {
        id: d?.message_id || null,
        threadId: d?.thread_id || null,
        status: d?.message_status || 'accepted',
        from: d?.From || form.phone_number_from,
        to: d?.To || form.phone_number_to,
        text: d?.message_content || form.message,
        deliveryConfirmed: false,
      };
}
