// Cell-native lettering: no image masks, font downloads, or per-frame pixel
// allocation. FIGlet letterforms were rendered at development time with
// pyfiglet. See docs/design-v3.md.
//
// Every wordmark is declared as two blocks — the word and the numeral — joined
// with no gap, so it reads as one word. Joining also yields the exact column
// where the numeral begins, which is what gets the brand orange. Nothing has to
// track hand-measured offsets.

import { theme, mix } from './screen.js';

export const WORDMARK = 'Alive5';
export const LOGO_HEIGHT = 7;

/**
 * Joins a word block and a numeral block, returning the lines plus the column
 * the numeral starts at. `kern` is the column count between them: it matches the
 * font's own letter spacing, so the result reads as one word rather than two.
 */
function join(word, numeral, kern = 0) {
  const height = Math.max(word.length, numeral.length);
  const width = Math.max(...word.map((line) => line.replace(/\s+$/, '').length)) + kern;
  const lines = Array.from(
    { length: height },
    (_, row) => (word[row] || '').replace(/\s+$/, '').padEnd(width) + (numeral[row] || ''),
  );
  return { lines, fiveFrom: width };
}

const OUTLINE = join(
  ['   _   _ _', '  /_\\ | (_)_ _____', ' / _ \\| | \\ V / -_)', '/_/ \\_\\_|_|\\_/\\___|'],
  [' ___', '| __|', '|__ \\', '|___/'],
);

const SLASH = join(
  ['   ___   ___', '  / _ | / (_)  _____', ' / __ |/ / / |/ / -_)', '/_/ |_/_/_/|___/\\__/'],
  ['   ____', '  / __/', ' /__ \\', '/____/'],
);

const WIRE = join([' _', '|_| |  o     _', '| | |  | \\_/(/_'], [' __', ' |_', '__)'], 1);

const SLAB = join(
  [' _____ _ _', '|  _  | |_|_ _ ___', '|     | | | | | -_|', '|__|__|_|_|\\_/|___|'],
  ['  ___', ' |  _|', ' |_  |', ' |___|'],
);

// A five-row bitmap alphabet, so Pixel and Dots share one set of letterforms.
const GLYPHS = {
  A: ['  ##  ', ' #  # ', '######', '#    #', '#    #'],
  l: ['# ', '# ', '# ', '# ', '##'],
  i: ['#', ' ', '#', '#', '#'],
  v: ['     ', '#   #', '#   #', ' # # ', '  #  '],
  e: [' ### ', '#   #', '#####', '#    ', ' ####'],
  5: ['#####', '#    ', '#### ', '    #', '#### '],
};

const bitmap = (text) =>
  Array.from({ length: 5 }, (_, row) => [...text].map((ch) => GLYPHS[ch][row]).join(' '));

const MATRIX = join(bitmap('Alive'), bitmap('5'), 1);

const fill = (art, glyph) => ({
  ...art,
  lines: art.lines.map((line) => line.replaceAll('#', glyph)),
});

// The frame is a single line of text, so the numeral is found by character.
const FRAME = {
  lines: ['╭────────────╮', `│   ${WORDMARK}   │`, '╰────────────╯'],
  fiveFrom: null,
};

export const logos = [
  {
    id: 'type',
    name: 'Wordmark',
    description: 'Simple type with an orange 5.',
    lines: [WORDMARK],
    fiveFrom: null,
    wide: true,
  },
  {
    id: 'slash',
    name: 'Slash',
    description: 'Forward slashes with open, slanted letterforms.',
    ...SLASH,
  },
  { id: 'outline', name: 'Outline', description: 'A compact, classic ASCII wordmark.', ...OUTLINE },
  {
    id: 'pixel',
    name: 'Pixel',
    description: 'Solid lettering, five terminal cells high.',
    ...fill(MATRIX, '█'),
  },
  {
    id: 'stipple',
    name: 'Dots',
    description: 'ASCII dots form each letter without extra fonts.',
    ...fill(MATRIX, ':'),
  },
  { id: 'wire', name: 'Wire', description: 'Fine strokes and a light outline.', ...WIRE },
  {
    id: 'lean',
    name: 'Slab',
    description: 'Squared ASCII lettering with a heavier outline.',
    ...SLAB,
  },
  {
    id: 'frame',
    name: 'Label',
    description: 'A small terminal label with a fine border.',
    ...FRAME,
  },
];

export const logoById = (id) => logos.find((item) => item.id === id) || logos[0];

/** True when this cell belongs to the numeral and should take the brand orange. */
const isNumeral = (fiveFrom, char, col) => char === '5' || (fiveFrom != null && col >= fiveFrom);

export function drawLogo(
  screen,
  {
    x,
    y,
    width = 48,
    height = LOGO_HEIGHT,
    time = 0,
    motion = 'full',
    effect = 'cosmos',
    variant = 'frame',
  },
) {
  const logo = logoById(variant);
  // Every variant fits the smallest supported terminal. A narrower command
  // banner keeps readable text instead of clipping letterforms.
  const fits = Math.max(...logo.lines.map((line) => line.length)) <= width - 2;
  const lines = fits ? logo.lines : [WORDMARK];
  const fiveFrom = fits && lines.length > 1 ? logo.fiveFrom : null;
  const artWidth = Math.max(...lines.map((line) => line.length));
  const top = y + Math.floor((height - lines.length) / 2);
  const animated = motion === 'full' || (motion === 'subtle' && time < 0.85);
  const t = animated ? time : 0;
  const scene = { screen, x, y, width, height, artWidth, top, lines, t };

  if ((animated && effect === 'orbit') || effect === 'cosmos') drawStars(scene, effect);
  if (effect === 'cosmos') {
    drawPlanet(scene);
    if (animated) drawComets(scene);
  }

  lines.forEach((line, row) => {
    [...line].forEach((char, col) => {
      if (char === ' ') return;
      let fg = isNumeral(fiveFrom, char, col) ? theme.orange : theme.ink;
      if (animated && effect === 'signal') {
        const sweep = ((t * 9) % (artWidth + 12)) - 6;
        fg = mix(fg, theme.hot, Math.max(0, 1 - Math.abs(col - sweep) / 3) * 0.65);
      }
      if (animated && effect === 'breathe')
        fg = mix(fg, theme.muted, (Math.sin(t * 1.1) + 1) * 0.2);
      screen.put(x + col, top + row, char, fg, theme.bg, logo.wide === true);
    });
  });
}

/** Deterministic stars along the banner's top and bottom rows only. */
function drawStars({ screen, x, y, width, height, t }, effect) {
  const count = effect === 'cosmos' && width < 50 ? 6 : 8;
  for (let i = 0; i < count; i++) {
    const px = Math.floor(((i * width) / count + t * (i % 2 ? 1 : 0.6)) % width);
    const py = i % 2 ? height - 1 : 0;
    const bright = (Math.sin(t * 1.2 + i * 2) + 1) / 2;
    screen.put(x + px, y + py, i % 3 ? '·' : '+', mix(theme.bg, theme.muted, 0.3 + bright * 0.28));
  }
}

/**
 * Decorations own only empty banner cells. Even at 40 columns none of them can
 * overwrite the lettering, the controls, or another screen region.
 */
const painter =
  ({ screen, x, y, width, height, artWidth, top, lines }) =>
  (px, py, glyph, color) => {
    if (px < 0 || px >= width || py < 0 || py >= height) return;
    if (px <= artWidth && py >= top - y && py < top - y + lines.length) return;
    screen.put(x + px, y + py, glyph, color);
  };

const PLANET = ['   .-.  /', ' /(___)/ ', "/  '-'   "];

function drawPlanet(scene) {
  const { width, height, artWidth, t } = scene;
  const planetX = Math.max(artWidth + 3, width - 11);
  if (planetX + 9 > width) return;
  const paint = painter(scene);
  const planetY = Math.floor((height - 3) / 2);
  // A tiny moon orbits the planet, which stays recognizable and stationary.
  if (width >= 50)
    paint(
      planetX + 4 + Math.round(Math.cos(t * 0.45) * 5),
      planetY + 1 + Math.round(Math.sin(t * 0.45)),
      'o',
      mix(theme.bg, theme.muted, 0.8),
    );
  PLANET.forEach((line, row) =>
    [...line].forEach((glyph, col) => {
      if (glyph !== ' ')
        paint(
          planetX + col,
          planetY + row,
          glyph,
          glyph === '/' ? mix(theme.bg, theme.muted, 0.65) : theme.muted,
        );
    }),
  );
}

/**
 * Two short comet passes per twelve-second cycle, with four-cell tails. No
 * growing particle list and no work outside this small banner.
 */
function drawComets(scene) {
  const { width, height, artWidth, t } = scene;
  const paint = painter(scene);
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
