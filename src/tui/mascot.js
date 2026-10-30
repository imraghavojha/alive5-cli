import isometric from './mascots/isometric-desktop.js';
import macintosh from './mascots/pocket-macintosh.js';
import { mix } from './screen.js';

export const mascots = [
  {
    ...isometric,
    id: 'isometric-desktop',
    name: 'Isometric Desktop',
    shortName: 'Isometric',
    description: 'A shaded desktop with a travelling highlight and a friendly blink.',
  },
  {
    ...macintosh,
    id: 'pocket-macintosh',
    shortName: 'Pocket Mac',
    description: 'A little Macintosh with a blinking face and a flickering floppy slot.',
  },
];

export const mascotById = (id) => mascots.find((item) => item.id === id) || mascots[0];

export function mascotFrame(mascot, time) {
  let elapsed = Math.max(0, time) * 1000;
  const duration = mascot.frames.reduce((sum, frame) => sum + (frame.ms || mascot.frameMs), 0);
  elapsed %= duration;
  for (const frame of mascot.frames) {
    const ms = frame.ms || mascot.frameMs;
    if (elapsed < ms) return frame;
    elapsed -= ms;
  }
  return mascot.frames[mascot.still || 0];
}

export function drawMascot({ screen, x, y, width, height, artWidth, t, section }, mascot) {
  const left = width - mascot.width - 1;
  const top = Math.floor((height - mascot.height) / 2);
  if (left < artWidth + 2 || top < 0) return;
  const theme = screen.theme;
  const palette = {
    i: theme.ink,
    m: theme.muted,
    f: theme.faint,
    1: mix(theme.bg, theme.ink, 0.1),
    2: mix(theme.bg, theme.ink, 0.22),
  };
  const frame = mascotFrame(mascot, t);
  frame.rows.forEach((row, py) =>
    [...row].forEach((ch, px) => {
      const fg = palette[frame.fg[py][px]] || theme.ink;
      const bg = palette[frame.bg[py][px]] || theme.bg;
      screen.put(x + left + px, y + top + py, ch, fg, bg);
    }),
  );
  if (section) drawSectionDetail(screen, x + left, y + top, mascot, section, t, palette);
}

function drawSectionDetail(screen, left, top, mascot, section, time, palette) {
  const phase = Math.floor(time / 0.34) % 16;
  const cardX = left - 9;
  const put = (x, y, text, fg = palette.i, bg = screen.theme.bg) => screen.put(x, y, text, fg, bg);
  const bubble = (text, y) => {
    put(cardX, y, '╭─────╮');
    put(cardX, y + 1, `│${text.padStart(Math.floor((5 + text.length) / 2)).padEnd(5)}│`);
    put(cardX, y + 2, '╰───┬─╯');
  };
  if (section === 'messages' && phase >= 2 && phase <= 11)
    bubble(phase < 4 ? '·' : phase < 6 ? '··' : '···', top);
  if (section === 'conversations' && phase >= 2 && phase <= 12)
    bubble(phase < 7 ? 'hi' : 'ok', top + (phase < 7 ? 0 : 1));
  if (section === 'contacts' && phase >= 2 && phase <= 12) {
    const slide = phase < 4 ? 2 : phase > 10 ? 1 : 0;
    put(cardX + slide, top, '┌─────┐');
    put(cardX + slide, top + 1, '│ o = │');
    put(cardX + slide, top + 2, '└─────┘');
  }
  if (section === 'compose' && phase >= 3 && phase <= 10) {
    const face = phase < 5 ? '>_ ' : phase < 7 ? '>h_' : '>hi';
    const isometric = mascot.id === 'isometric-desktop';
    put(left + 2, top + (isometric ? 2 : 1), face, palette.i, palette[isometric ? 1 : 2]);
    if (phase <= 9) put(cardX + 1, top + 2, phase % 2 ? '[   ]' : '[ _ ]', palette.m);
  }
}
