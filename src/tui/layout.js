import { logoById } from './logo.js';

export const navigation = [
  {
    id: 'send',
    label: 'Compose a text',
    description: 'Write a message and review before sending.',
    code: 'alive5 sms send --help',
  },
  {
    id: 'messages',
    label: 'Recent messages',
    description: 'Read incoming and outgoing SMS.',
    code: 'alive5 sms list --help',
  },
  {
    id: 'history',
    label: 'Conversations',
    description: 'Browse SMS, chat, and Messenger transcripts.',
    code: 'alive5 conversations list --help',
  },
  {
    id: 'directory',
    label: 'Contacts & workspace',
    description: 'Find contacts, channels, teammates, and tags.',
    code: 'alive5 contacts list',
  },
  {
    id: 'agents',
    label: 'Agent quick start',
    description: 'Command discovery, previews, and JSON output.',
    code: 'alive5 schema',
  },
  {
    id: 'appearance',
    label: 'Appearance',
    description: 'Choose from eight wordmarks and preview their motion.',
    code: 'alive5 --no-animation',
  },
];

export const MIN_WIDTH = 40;
const HOME_MENU = 38;
export const MIN_HEIGHT = 24;

export const BANNER_PANELS = ['home', 'appearance'];

export const showsBanner = (kind) => BANNER_PANELS.includes(kind);

const headerRows = (logo) => (logo ? Math.min(10, logoById(logo).lines.length + 5) : 3);

export function layout(width, height, kind = 'home', logo = null) {
  const left = 3;
  const splitList = kind === 'list' && width >= 100;

  const splitHome = kind === 'home' && width >= 110;
  const w = Math.min(splitList || splitHome ? 154 : 78, width - left * 2);
  const listWidth = Math.floor(w * 0.58);
  const header = headerRows(showsBanner(kind) ? logo : null);
  const top = header + 1;

  const bottom = height - 3;
  return {
    narrow: w < 60,
    tooSmall: width < MIN_WIDTH || height < MIN_HEIGHT,
    logoWidth: Math.min(w, 78),
    logoHeight: header - 3,
    x: left,
    left,
    top,
    bottom,
    w,
    h: bottom - top,
    list: splitList ? { x: left, w: listWidth } : null,
    detail: splitList ? { x: left + listWidth + 2, w: w - listWidth - 2 } : null,
    recent: splitHome ? { x: left + HOME_MENU + 2, w: w - HOME_MENU - 2 } : null,
  };
}
