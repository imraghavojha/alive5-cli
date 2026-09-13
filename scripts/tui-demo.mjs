// Offline UI fixture. Never calls the network or reads Alive5 credentials.
import { launchTui } from '../src/tui/app.js';
import { sendForm } from '../src/api.js';
const contacts = Array.from({ length: 30 }, (_, i) => ({
  id: `contact-${i + 1}`,
  firstName: ['Avery', 'Sam', 'Jordan'][i % 3],
  lastName: 'Example',
  phone: '+15555550101',
  email: 'hello@example.com',
}));
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
    messages: async () => [
      {
        threadId: 'thread-demo',
        sender: 'Avery',
        at: '2026-09-13T10:30:00Z',
        text: 'Your appointment is confirmed for tomorrow at 10. We look forward to seeing you.',
      },
      {
        threadId: 'thread-demo',
        sender: '+15555550101',
        at: '2026-09-13T10:32:00Z',
        text: 'Perfect, thank you. See you then!',
      },
    ],
    conversations: async () => ({ data: [], meta: { page: 1, nextPage: null } }),
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
