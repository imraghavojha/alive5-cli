import {
  request,
  items,
  pagination,
  timestamp,
  dateRange,
  phone,
  integer,
  CliError,
} from './core.js';
const V1 = 'https://api.alive5.com/public/1.0';
const V2 = 'https://api-v2.alive5.com/public';
const url = (path, params = {}) => {
  const u = new URL(path);
  for (const [k, v] of Object.entries(params))
    if (v !== undefined) u.searchParams.set(k, String(v));
  return u.toString();
};
export const account = (options) => request(`${V1}/account`, options);
export async function channels(options) {
  const data = await request(`${V2}/1.0/objects/channels-and-users/list`, options);
  return options?.raw
    ? data
    : items(data).map((c) => ({
        id: c.channel_id,
        name: c.channel_label,
        users: (c.agents || []).map((u) => ({
          id: u.user_id,
          name: u.screen_name || null,
          email: u.email || null,
          role: u.user_role || null,
        })),
      }));
}
export async function tags(options) {
  const d = await request(`${V2}/1.0/objects/tags/list`, options);
  return options?.raw ? d : items(d).map((t) => ({ id: t.tag_id, name: t.tag_label }));
}
export async function contacts(options = {}) {
  const page = integer(options.page || 1, 'page');
  const limit = integer(options.limit || 25, 'limit', 100);
  const d = await request(url(`${V2}/1.0/objects/contact/get-all`, { page, limit }), options);
  return {
    data: options.raw
      ? d
      : items(d).map((c) => ({
          id: c.crm_id,
          firstName: c.first_name || null,
          lastName: c.last_name || null,
          email: c.email || null,
          phone: c.phone_mobile || null,
          company: c.company || null,
          tags: c.tags || [],
          updatedAt: timestamp(c.updated_at),
        })),
    meta: pagination(d, page),
  };
}
export function conversation(c, type) {
  const t = c.threadData || c;
  const crm = t.crmData || {};
  return {
    id: t.thread_id || t.alive5_sessionID,
    type,
    channel: { id: t.channel_id || null, name: t.channel_name || null },
    assignedTo: t.assignedTo || t.agent_id || null,
    startedAt: timestamp(t.thread_start_chat || t.start_time),
    endedAt:
      Number(t.thread_end_chat || t.end_time) > 0
        ? timestamp(t.thread_end_chat || t.end_time)
        : null,
    contact: {
      id: t.crm_id || null,
      firstName: t.first_name || t.contacts_first_name || crm.first_name || null,
      lastName: t.last_name || t.contacts_last_name || crm.last_name || null,
      email: t.email || t.contacts_email || crm.email || null,
      phone: t.phone || t.contacts_phone_mobile || t.contacts_phone || crm.phone_mobile || null,
    },
    tags: t.tags || crm.tags || [],
    messages: (c.threadConversation || c.chat_conversation || []).map((entry) => {
      const m = entry._source || entry;
      return {
        id: m.message_id || null,
        at: timestamp(m.created_at),
        sender: m.created_by || null,
        text: m.message_content ?? null,
        ...(m.media_url && { media: m.media_url }),
      };
    }),
  };
}
export async function conversations(type, options = {}) {
  const [start, end] = dateRange(options.since, options.until);
  const page = integer(options.page || 1, 'page');
  const live = type === 'livechat';
  if (!['sms', 'livechat', 'fbm'].includes(type))
    throw new CliError('INVALID_ARGUMENT', 'Choose sms, livechat, or fbm.', 2);
  if (live && (options.channel || options.thread))
    throw new CliError(
      'INVALID_ARGUMENT',
      '--channel and --thread are documented for sms and fbm only.',
      2,
    );
  const params = live
    ? {
        datetime_from: start,
        datetime_to: end,
        page: page - 1,
        timezone_offset: options.timezone || '+0:00',
      }
    : {
        date_start: start,
        date_end: end,
        page,
        channel_id: options.channel,
        alive5_sessionID: options.thread,
      };
  if (live && !/^[+-](?:0?\d|1[0-4]):[0-5]\d$/.test(params.timezone_offset))
    throw new CliError('INVALID_ARGUMENT', '--timezone must look like -5:00 or +0:00.', 2);
  const d = await request(
    url(`${V2}/${live ? '2.0' : '1.0'}/conversations/${type}`, params),
    options,
  );
  return {
    data: options.raw ? d : items(d).map((c) => conversation(c, type)),
    meta: live
      ? {
          ...pagination(d, page - 1),
          page: Number(d.page ?? page - 1) + 1,
          totalPages: d.pages == null ? null : Number(d.pages) + 1,
          nextPage:
            d.pages != null && Number(d.page ?? page - 1) < Number(d.pages) ? page + 1 : null,
        }
      : pagination(d, page),
  };
}
export async function summary(options) {
  const [start, end] = dateRange(options.since, options.until);
  return request(
    url(`${V2}/1.0/conversations/summary`, { from_datetime: start, date_end: end }),
    options,
  );
}
export function sendForm(options) {
  const from = phone(options.from),
    to = phone(options.to);
  if (typeof options.message !== 'string' || !options.message.trim())
    throw new CliError('INVALID_MESSAGE', 'Provide a nonempty --message or --message-file.', 2);
  if (options.message.length > 1600)
    throw new CliError('INVALID_MESSAGE', 'Keep each message at or below 1600 characters.', 2);
  if (!options.channel || !options.user)
    throw new CliError(
      'INVALID_ARGUMENT',
      '--channel and --user are required. Find IDs with alive5 channels list.',
      2,
    );
  return {
    phone_number_from: from,
    phone_number_to: to,
    message: options.message,
    channel_id: options.channel,
    user_id: options.user,
  };
}
export async function send(options) {
  const form = sendForm(options);
  if (options.dryRun)
    return { preview: true, method: 'POST', url: `${V1}/conversations/sms/send`, form };
  const d = await request(`${V1}/conversations/sms/send`, { ...options, method: 'POST', form });
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

export async function messages(options) {
  const [start, end] = dateRange(options.since, options.until);
  const d = await request(
    url(`${V2}/1.2/conversations/sms`, { date_start: start, date_end: end }),
    options,
  );
  if (options.raw) return d;
  return items(d).map((m) => ({
    threadId: m.thread_id || null,
    channelId: m.channel_id || null,
    at: timestamp(m.created_at),
    sender: m.created_by || null,
    text: m.message_content ?? null,
    ...(m.media_url && { media: m.media_url }),
  }));
}
