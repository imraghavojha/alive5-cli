// Offline UI fixture. Never calls the network or reads Alive5 credentials.
import { launchTui } from '../src/tui/runtime.js';
import { sendForm } from '../src/api.js';
const FIRST = ['Avery', 'Sam', 'Jordan', 'Riley', 'Quinn', 'Noor'];
const LAST = ['Stone', 'Barros', 'Reed', 'Okafor', 'Lindqvist', 'Haddad'];
const COMPANY = ['Northwind Studio', 'Rivet & Co', 'Lumen Clinic', 'Harbour Bakery'];
const contacts = Array.from({ length: 30 }, (_, i) => ({
  id: `contact-${i + 1}`,
  firstName: FIRST[i % FIRST.length],
  lastName: LAST[(i * 3) % LAST.length],
  phone: `+1555555${String(100 + i).padStart(4, '0')}`,
  email: `${FIRST[i % FIRST.length].toLowerCase()}@example.test`,
  company: COMPANY[i % COMPANY.length],
  tags: i % 3 ? ['Follow up'] : [],
}));
const transcript = [
  {
    sender: 'Avery',
    at: '2026-09-13T10:30:00Z',
    text: 'Your appointment is confirmed for tomorrow at 10.',
  },
  { sender: '+15555550101', at: '2026-09-13T10:32:00Z', text: 'Perfect, thank you. See you then!' },
  { sender: 'Avery', at: '2026-09-13T10:33:00Z', text: 'Reply STOP at any time to opt out.' },
];
await launchTui({
  account: { org_name: 'Studio workspace' },
  settings: { motion: process.env.DEMO_MOTION || 'full', effect: 'cosmos', logo: 'frame' },
  services: {
    account: async () => ({ org_name: 'Studio workspace' }),
    channels: async () => [
      {
        id: 'demo-channel',
        name: '+15555550100',
        users: [{ id: 'demo-user', name: 'Avery', role: 'admin' }],
      },
    ],
    contacts: async () => ({ data: contacts, meta: { page: 1, totalPages: 1, nextPage: null } }),
    tags: async () => [
      { id: 'tag-1', name: 'Follow up' },
      { id: 'tag-2', name: 'Customer care' },
    ],
    messages: async () =>
      Array.from({ length: 9 }, (_, i) => ({
        threadId: `thread-${(i % 3) + 1}`,
        channelId: 'demo-channel',
        ...transcript[i % transcript.length],
      })),
    conversations: async () => ({
      data: contacts.slice(0, 6).map((c, i) => ({
        id: `thread-${i + 1}`,
        type: 'sms',
        channel: { id: 'demo-channel', name: 'Front desk' },
        assignedTo: 'demo-user',
        startedAt: '2026-09-13T10:30:00Z',
        endedAt: null,
        contact: c,
        tags: c.tags,
        messages: transcript,
      })),
      meta: { page: 1, totalPages: 1, nextPage: null },
    }),
    sendForm,
    send: async (o) => ({
      id: 'demo-message',
      status: 'demo only',
      to: o.to,
      text: o.message,
      deliveryConfirmed: false,
    }),
  },
});
