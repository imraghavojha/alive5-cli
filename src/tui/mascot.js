import { mix } from './screen.js';

const BLOCKS = { '..': ' ', '#.': '▀', '.#': '▄', '##': '█' };

function frame(mask, ms) {
  // The half-cell margins center the eight-pixel-tall silhouettes.
  const blank = '.'.repeat(mask[0].length);
  const pixels = [blank, ...mask, blank];
  const rows = [];
  for (let i = 0; i < pixels.length; i += 2)
    rows.push([...pixels[i]].map((pixel, x) => BLOCKS[pixel + pixels[i + 1][x]]).join(''));
  return { rows, ms };
}

const wave = [
  '.###..###.....',
  '###########...',
  '##.####.###...',
  '#.#.##.#.##.##',
  '.##########.##',
  '....##.....##.',
  '..##########..',
  '.####..####...',
];

const raisedHand = [
  wave[0],
  wave[1],
  '##.####.###.##',
  wave[3],
  '.############.',
  '....##.....#..',
  wave[6],
  wave[7],
];

const classic = [
  '..###..###..',
  '.#...##...#.',
  '##.#.##.#.##',
  '.#...##...#.',
  '..########..',
  '.....##.....',
  '...######...',
  '..###..###..',
];

const waveBlink = [...wave];
waveBlink[2] = '###########...';
waveBlink[3] = '#...##...##.##';

const classicBlink = [...classic];
classicBlink[2] = '##...##...##';

export const mascots = [
  {
    id: 'wave',
    name: 'Wave',
    description: 'A monochrome robot that waves and blinks.',
    width: wave[0].length,
    height: (wave.length + 2) / 2,
    frames: [
      frame(wave, 520),
      frame(raisedHand, 260),
      frame(wave, 1560),
      frame(raisedHand, 300),
      frame(wave, 1100),
      frame(waveBlink, 220),
      frame(wave, 840),
    ],
  },
  {
    id: 'classic',
    name: 'Classic',
    description: 'A monochrome robot with a quiet blink.',
    width: classic[0].length,
    height: (classic.length + 2) / 2,
    frames: [
      frame(classic, 580),
      frame(classicBlink, 220),
      frame(classic, 1540),
      frame(classicBlink, 220),
      frame(classic, 2240),
    ],
  },
];

function mascotFrame(mascot, time) {
  const duration = mascot.frames.reduce((sum, frame) => sum + frame.ms, 0);
  let elapsed = (Math.max(0, time) * 1000) % duration;
  for (const frame of mascot.frames) {
    if (elapsed < frame.ms) return frame;
    elapsed -= frame.ms;
  }
  return mascot.frames[0];
}

export const mascotById = (id) => mascots.find((item) => item.id === id) || mascots[0];

// Center both silhouettes on the same axis.
export const mascotLeft = (width, mascot) => width - 9 - Math.floor(mascot.width / 2);

export function drawMascot({ screen, x, y, width, height, artWidth, t, section }, mascot) {
  const left = mascotLeft(width, mascot);
  const top = Math.floor((height - mascot.height) / 2);
  if (left < artWidth + 2 || top < 0) return;
  const { rows } = mascotFrame(mascot, t);
  rows.forEach((row, py) => screen.put(x + left, y + top + py, row));
  if (section) drawSectionDetail(screen, x + left, y + top, section, t, left - artWidth < 9);
}

function drawSectionDetail(screen, left, top, section, time, compact) {
  const { bg, ink, muted } = screen.theme;
  const phase = Math.floor(time / 0.34) % 16;
  const cardX = left - (compact ? 4 : 9);
  const put = (x, y, text, fg = ink) => screen.put(x, y, text, fg);
  const bubble = (text, y) => {
    if (compact) return put(cardX, y + 1, text);
    put(cardX, y, '╭─────╮');
    put(cardX, y + 1, `│${text.padStart(Math.floor((5 + text.length) / 2)).padEnd(5)}│`);
    put(cardX, y + 2, '╰───┬─╯');
  };
  if (section === 'inbox') {
    const pulse = (Math.sin(time * 2.2) + 1) / 2;
    const waveX = left - (compact ? 2 : 4);
    put(waveX, top + 1, '))', mix(bg, muted, 0.3 + pulse * 0.7));
    put(waveX - (compact ? 2 : 3), top + 1, ')', mix(bg, muted, 0.25 + (1 - pulse) * 0.6));
  }
  if (section === 'messages' && phase >= 2 && phase <= 11)
    bubble(phase < 4 ? '·' : phase < 6 ? '··' : '···', top);
  if (section === 'conversations' && phase >= 2 && phase <= 12)
    bubble(phase < 7 ? 'hi' : 'ok', top + (phase < 7 ? 0 : 1));
  if (section === 'contacts' && phase >= 2 && phase <= 12) {
    const slide = phase < 4 ? 2 : phase > 10 ? 1 : 0;
    if (compact) put(cardX + slide, top + 1, 'o=');
    else {
      put(cardX + slide, top, '┌─────┐');
      put(cardX + slide, top + 1, '│ o = │');
      put(cardX + slide, top + 2, '└─────┘');
    }
  }
  if (section === 'compose' && phase >= 3 && phase <= 10) {
    const prompt = phase < 5 ? '>_ ' : phase < 7 ? '>h_' : '>hi';
    put(cardX + (compact ? 0 : 2), top + 1, prompt);
    if (!compact && phase <= 9) put(cardX + 1, top + 2, phase % 2 ? '[   ]' : '[ _ ]', muted);
  }
}
