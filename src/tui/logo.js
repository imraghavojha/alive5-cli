import { theme, mix } from './screen.js';

// Cell-native lettering: no image masks, font downloads, or per-frame allocation of pixels.
// FIGlet letterforms rendered at development time with pyfiglet. See docs/design-v3.md.
const outline = [
  '   _   _ _           ___',
  '  /_\\ | (_)_ _____  | __|',
  ' / _ \\| | \\ V / -_) |__ \\',
  '/_/ \\_\\_|_|\\_/\\___| |___/',
];
const slash = [
  '   ___   ___            ____',
  '  / _ | / (_)  _____   / __/',
  ' / __ |/ / / |/ / -_) /__ \\',
  '/_/ |_/_/_/|___/\\__/ /____/',
];
const wire = [' _                 __', '|_| |  o     _    |_', '| | |  | \\_/(/_   __)'];
const script = [
  ' _____ _ _            ___',
  '|  _  | |_|_ _ ___   |  _|',
  '|     | | | | | -_|  |_  |',
  '|__|__|_|_|\\_/|___|  |___|',
];
const alphabet = {
  A: ['  ##  ', ' #  # ', '######', '#    #', '#    #'],
  l: ['# ', '# ', '# ', '# ', '##'],
  i: ['#', ' ', '#', '#', '#'],
  v: ['     ', '#   #', '#   #', ' # # ', '  #  '],
  e: [' ### ', '#   #', '#####', '#    ', ' ####'],
  ' ': ['  ', '  ', '  ', '  ', '  '],
  5: ['#####', '#    ', '#### ', '    #', '#### '],
};
const matrix = Array.from({ length: 5 }, (_, row) =>
  [...'Alive 5'].map((letter) => alphabet[letter][row]).join(' '),
);
export const logos = [
  {
    id: 'type',
    name: 'Wordmark',
    description: 'Simple type with an orange 5.',
    lines: ['Alive 5'],
  },
  {
    id: 'slash',
    name: 'Slash',
    description: 'Forward slashes with open, slanted letterforms.',
    lines: slash,
  },
  {
    id: 'outline',
    name: 'Outline',
    description: 'A compact, classic ASCII wordmark.',
    lines: outline,
  },
  {
    id: 'pixel',
    name: 'Pixel',
    description: 'Solid lettering, five terminal cells high.',
    lines: matrix.map((line) => line.replaceAll('#', '█')),
  },
  {
    id: 'stipple',
    name: 'Dots',
    description: 'ASCII dots form each letter without extra fonts.',
    lines: matrix.map((line) => line.replaceAll('#', ':')),
  },
  { id: 'wire', name: 'Wire', description: 'Fine strokes and a light outline.', lines: wire },
  {
    id: 'lean',
    name: 'Slab',
    description: 'Squared ASCII lettering with a heavier outline.',
    lines: script,
  },
  {
    id: 'frame',
    name: 'Label',
    description: 'A small terminal label with a fine border.',
    lines: ['╭─────────────╮', '│   Alive 5   │', '╰─────────────╯'],
  },
];
export const logoSizes = [28, 38, 48, 52, 62];
export const logoHeight = () => 7;

export function drawLogo(
  screen,
  { x, y, width = 48, height = 7, time = 0, motion = 'full', effect = 'cosmos', variant = 'frame' },
) {
  const logo = logos.find((item) => item.id === variant) || logos[0];
  let lines = logo.lines;
  // Even the smallest supported terminal fits every five-line variant. If used
  // by a smaller command banner, retain readable text instead of clipping letters.
  if (Math.max(...lines.map((line) => line.length)) > width - 2) lines = ['Alive 5'];
  const artWidth = Math.max(...lines.map((line) => line.length));
  const left = x;
  const top = y + Math.floor((height - lines.length) / 2);
  const animated = motion === 'full' || (motion === 'subtle' && time < 0.85);
  const t = animated ? time : 0;
  if ((animated && effect === 'orbit') || effect === 'cosmos') {
    // Deterministic stars. Confined to the banner; never cross lettering.
    const stars = effect === 'cosmos' && width < 50 ? 6 : 8;
    for (let i = 0; i < stars; i++) {
      const px = Math.floor(((i * width) / stars + t * (i % 2 ? 1 : 0.6)) % width);
      const py = i % 2 ? height - 1 : 0;
      const bright = (Math.sin(t * 1.2 + i * 2) + 1) / 2;
      screen.put(
        x + px,
        y + py,
        i % 3 ? '·' : '+',
        mix(theme.bg, theme.muted, 0.3 + bright * 0.28),
      );
    }
  }
  if (effect === 'cosmos') {
    // Decorations own only empty banner cells. Even at 40 columns, none can
    // overwrite the label, controls, or another screen region.
    const paint = (px, py, glyph, color) => {
      if (px < 0 || px >= width || py < 0 || py >= height) return;
      if (px <= artWidth && py >= top - y && py < top - y + lines.length) return;
      screen.put(x + px, y + py, glyph, color);
    };
    const planetX = Math.max(artWidth + 3, width - 11);
    if (planetX + 9 <= width) {
      const planetY = Math.floor((height - 3) / 2);
      // A tiny moon orbits the planet, which stays recognizable and stationary.
      const moonX = planetX + 4 + Math.round(Math.cos(t * 0.45) * 5);
      const moonY = planetY + 1 + Math.round(Math.sin(t * 0.45));
      if (width >= 50) paint(moonX, moonY, 'o', mix(theme.bg, theme.muted, 0.8));
      ['   .-.  /', ' /(___)/ ', "/  '-'   "].forEach((line, row) => {
        [...line].forEach((glyph, col) => {
          if (glyph !== ' ')
            paint(
              planetX + col,
              planetY + row,
              glyph,
              glyph === '/' ? mix(theme.bg, theme.muted, 0.65) : theme.muted,
            );
        });
      });
    }
    if (animated) {
      // Two short comet passes per twelve-second cycle, with four-cell tails.
      // No growing particle list and no work outside this small banner.
      for (let i = 0; i < 2; i++) {
        const phase = (t + i * 6) % 12;
        if (phase >= 4) continue;
        const head = Math.floor((phase / 4) * (width + 10)) - 5;
        const py = i ? height - 1 : 0;
        for (let tail = 4; tail >= 0; tail--) {
          const px = i ? width - 1 - head + tail : head - tail;
          if (py === height - 1 && px <= artWidth + 1) continue;
          paint(
            px,
            py,
            tail === 0 ? '*' : tail < 3 ? '-' : '.',
            mix(theme.bg, theme.ink, 0.62 - tail * 0.1),
          );
        }
      }
    }
  }
  lines.forEach((line, row) => {
    [...line].forEach((char, col) => {
      if (char === ' ') return;
      let fg = theme.ink;
      const digitStart = {
        outline: [21, 20, 20, 20][row],
        slash: [24, 23, 22, 21][row],
        lean: 20,
        pixel: 27,
        stipple: 27,
        wire: 18,
      }[logo.id];
      const isPlainFive =
        char === '5' || (lines.length > 1 && digitStart !== undefined && col >= digitStart);
      if (isPlainFive) fg = theme.orange;
      if (animated && effect === 'signal') {
        const sweep = ((t * 9) % (artWidth + 12)) - 6;
        fg = mix(fg, theme.hot, Math.max(0, 1 - Math.abs(col - sweep) / 3) * 0.65);
      }
      if (animated && effect === 'breathe')
        fg = mix(fg, theme.muted, (Math.sin(t * 1.1) + 1) * 0.2);
      screen.put(left + col, top + row, char, fg, theme.bg, logo.id === 'type');
    });
  });
}
