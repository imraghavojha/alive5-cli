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

export function drawMascot({ screen, x, y, width, height, artWidth, t }, mascot) {
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
}
