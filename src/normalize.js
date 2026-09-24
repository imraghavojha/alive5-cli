// API shape to CLI record. Every command and the workspace read these field
// names, so renaming a record field is a change in exactly one place.

import { timestamp } from './validate.js';

export const channel = (c) => ({
  id: c.channel_id,
  name: c.channel_label,
  users: (c.agents || []).map((u) => ({
    id: u.user_id,
    name: u.screen_name || null,
    email: u.email || null,
    role: u.user_role || null,
  })),
});

export const tag = (t) => ({ id: t.tag_id, name: t.tag_label });

export const contact = (c) => ({
  id: c.crm_id,
  firstName: c.first_name || null,
  lastName: c.last_name || null,
  email: c.email || null,
  phone: c.phone_mobile || null,
  company: c.company || null,
  tags: c.tags || [],
  updatedAt: timestamp(c.updated_at),
});

export const account = (d) => ({
  organization: d.org_name,
  email: d.email || null,
  role: d.user_role || null,
  botUserId: d.bot_user_id || null,
});

export const message = (m) => ({
  id: m.message_id || null,
  at: timestamp(m.created_at),
  sender: m.created_by || null,
  text: m.message_content ?? null,
  ...(m.media_url && { media: m.media_url }),
});

export const smsRow = (m) => ({
  threadId: m.thread_id || null,
  channelId: m.channel_id || null,
  at: timestamp(m.created_at),
  sender: m.created_by || null,
  text: m.message_content ?? null,
  ...(m.media_url && { media: m.media_url }),
});

/** Handles both documented transcript shapes: flat SMS/FBM rows and nested live chat. */
export function conversation(c, type) {
  const t = c.threadData || c;
  const crm = t.crmData || {};
  const ended = Number(t.thread_end_chat || t.end_time);
  return {
    id: t.thread_id || t.alive5_sessionID,
    type,
    channel: { id: t.channel_id || null, name: t.channel_name || null },
    assignedTo: t.assignedTo || t.agent_id || null,
    startedAt: timestamp(t.thread_start_chat || t.start_time),
    endedAt: ended > 0 ? timestamp(t.thread_end_chat || t.end_time) : null,
    contact: {
      id: t.crm_id || null,
      firstName: t.first_name || t.contacts_first_name || crm.first_name || null,
      lastName: t.last_name || t.contacts_last_name || crm.last_name || null,
      email: t.email || t.contacts_email || crm.email || null,
      phone: t.phone || t.contacts_phone_mobile || t.contacts_phone || crm.phone_mobile || null,
    },
    tags: t.tags || crm.tags || [],
    messages: (c.threadConversation || c.chat_conversation || []).map((entry) =>
      message(entry._source || entry),
    ),
  };
}

/** A person's display name, used by lists, previews, and transcripts alike. */
export const displayName = (r = {}) =>
  r.name ||
  [r.firstName, r.lastName].filter(Boolean).join(' ') ||
  r.phone ||
  r.email ||
  r.id ||
  'Unknown';
