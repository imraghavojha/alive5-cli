// Offline UI fixture. Never calls the network or reads Alive5 credentials.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
// Local state such as the last sender goes to a scratch directory, not real config.
process.env.ALIVE5_CONFIG_DIR = mkdtempSync(join(tmpdir(), 'alive5-demo-'));
const { launchTui } = await import('../src/tui/runtime.js');
import { sendForm } from '../src/api.js';
const FIRST = [
  'Avery',
  'Sam',
  'Jordan',
  'Riley',
  'Quinn',
  'Noor',
  'Mateo',
  'Hana',
  'Ezra',
  'Leila',
];
const LAST = ['Stone', 'Barros', 'Reed', 'Okafor', 'Lindqvist', 'Haddad', 'Novak'];
const COMPANY = ['Northwind Studio', 'Rivet & Co', 'Lumen Clinic', 'Harbour Bakery'];
const contacts = Array.from({ length: 30 }, (_, i) => ({
  id: `contact-${i + 1}`,
  firstName: FIRST[i % FIRST.length],
  lastName: LAST[i % LAST.length],
  phone: `+1555555${String(100 + i).padStart(4, '0')}`,
  email: `${FIRST[i % FIRST.length].toLowerCase()}@example.test`,
  company: COMPANY[i % COMPANY.length],
  tags: i % 3 ? ['Follow up'] : [],
}));
// Timestamps are relative to now so lists read "5m ago" rather than a stale date.
const minutesAgo = (m) => new Date(Date.now() - m * 60000).toISOString();
const THREADS = [
  [
    ['+15555550101', 42, 'Hi! Is my cleaning still on for tomorrow?'],
    ['Morgan Lee', 40, 'Yes, you are booked for 10:00. Reply C to confirm.'],
    ['+15555550101', 38, 'C — see you then, thank you!'],
  ],
  [
    ['Morgan Lee', 190, 'Your order #2291 is ready for pickup at the front desk.'],
    ['+15555550104', 184, 'Great, can my partner pick it up instead?'],
    ['Morgan Lee', 181, 'Of course. They just need the order number.'],
  ],
  [
    ['+15555550108', 1500, 'Do you have any openings on Saturday morning?'],
    ['Morgan Lee', 1490, 'We have 9:30 and 11:00. Which works best?'],
  ],
].map((messages, i) =>
  messages.map(([sender, minutes, text]) => ({
    threadId: `thread-${i + 1}`,
    channelId: 'demo-channel',
    sender,
    at: minutesAgo(minutes),
    text,
  })),
);
await launchTui({
  account: { org_name: 'Studio workspace' },
  settings: {
    motion: process.env.DEMO_MOTION || 'subtle',
    effect: 'cosmos',
    logo: 'frame',
    theme: process.env.DEMO_THEME || 'dark',
  },
  services: {
    account: async () => ({ org_name: 'Studio workspace' }),
    channels: async () => [
      {
        id: 'demo-channel',
        name: '+15555550100',
        users: [
          { id: 'demo-user', name: 'Morgan Lee', role: 'admin' },
          { id: 'demo-user-2', name: 'Priya Shah', role: 'agent' },
        ],
      },
      {
        id: 'demo-channel-2',
        name: 'Front desk',
        users: [{ id: 'demo-user-3', name: 'Sam Ortiz' }],
      },
    ],
    contacts: async () => ({ data: contacts, meta: { page: 1, totalPages: 1, nextPage: null } }),
    tags: async () => [
      { id: 'tag-1', name: 'Follow up' },
      { id: 'tag-2', name: 'Customer care' },
    ],
    messages: async () => THREADS.flat(),
    conversations: async () => ({
      data: THREADS.map((messages, i) => ({
        id: `thread-${i + 1}`,
        type: 'sms',
        channel: { id: 'demo-channel', name: 'Front desk' },
        assignedTo: 'demo-user',
        startedAt: messages[0].at,
        endedAt: null,
        contact: contacts[[1, 4, 8][i]],
        tags: [],
        messages: messages.map(({ sender, at, text }) => ({ sender, at, text })),
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
