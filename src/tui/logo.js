import masks from './logo-mask.json' with { type: 'json' };
import { theme, mix } from './screen.js';
export const logoSizes = Object.keys(masks).map(Number);
export const logoHeight = (width) => masks[width].length / 2;
const quadrants = [' ', '▘', '▝', '▀', '▖', '▌', '▞', '▛', '▗', '▚', '▐', '▜', '▄', '▙', '▟', '█'];
const noise = (x, y) => {
  const n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return n - Math.floor(n);
};
export function drawLogo(
  screen,
  { x, y, width = 48, time = 0, entrance = 1, motion = 'full', effect = 'signal' },
) {
  const mask = masks[width],
    h = mask.length,
    p = Math.min(1, entrance),
    eased = 1 - (1 - p) ** 3;
  const pixels = Array.from({ length: h }, () => Array(width * 2).fill(' '));
  for (let py = 0; py < h; py++)
    for (let px = 0; px < width * 2; px++) {
      const role = mask[py][px];
      if (role === ' ') continue;
      // Resolve silhouette edges early; interior particles finish the short entrance.
      const edge =
        py === 0 ||
        py === h - 1 ||
        px === 0 ||
        px === width * 2 - 1 ||
        mask[py - 1]?.[px] === ' ' ||
        mask[py + 1]?.[px] === ' ';
      const distance = edge ? Math.max(0, 1 - p * 2) : 1 - eased;
      const tx = Math.round(px + (noise(px, py) - 0.5) * distance * width * 0.65),
        ty = Math.round(py + (noise(py, px) - 0.5) * distance * h * 0.8);
      if (tx >= 0 && tx < width * 2 && ty >= 0 && ty < h) pixels[ty][tx] = role;
    }
  const sweep = ((time % 12) / 2) * (width + 12) - 8;
  for (let py = 0; py < h; py += 2)
    for (let px = 0; px < width * 2; px += 2) {
      const values = [
        pixels[py][px],
        pixels[py][px + 1],
        pixels[py + 1][px],
        pixels[py + 1][px + 1],
      ];
      const bits = values.reduce((v, p, i) => v + (p !== ' ' ? 1 << i : 0), 0);
      if (!bits) continue;
      const orange =
        values.filter((v) => v === 'o').length > values.filter((v) => v === 'w').length;
      let fg = orange ? theme.orange : mix('#ede6da', '#c5beb5', (py / h) * 0.6);
      if (!orange && motion === 'full' && effect === 'signal')
        fg = mix(fg, '#fff6e9', Math.max(0, 1 - Math.abs(px / 2 + py * 0.15 - sweep) / 2) * 0.65);
      if (!orange && motion === 'full' && effect === 'breathe')
        fg = mix(fg, '#fff6e9', (Math.sin(time * 1.1) + 1) * 0.1);
      screen.put(x + px / 2, y + py / 2, quadrants[bits], fg);
    }
  if (motion === 'full' && effect === 'signal' && p === 1)
    for (let i = 0; i < 6; i++) {
      const phase = (time * 0.08 + i / 6) % 1,
        px = Math.round(phase * width * 0.9),
        py = Math.round(1 + Math.sin(phase * 6 + i) * 0.8);
      let empty = true;
      for (let dy = -2; dy <= 2; dy++)
        for (let dx = -2; dx <= 2; dx++)
          if (mask[py * 2 + dy]?.[px * 2 + dx]?.trim()) empty = false;
      if (empty)
        screen.put(
          x + px,
          y + py,
          i % 2 ? '·' : '˙',
          mix(theme.bg, theme.orange, 0.23 + Math.sin(phase * Math.PI) * 0.2),
        );
    }
  // The mark stays clear. Particles never enter the punched-out 5 or the lettering.
  if (motion === 'full' && effect === 'orbit')
    for (let i = 0; i < 4; i++) {
      const ex = width * 0.84 + Math.cos(time * 0.65 + (i * Math.PI) / 2) * width * 0.15;
      const ey = h * 0.25 + Math.sin(time * 0.65 + (i * Math.PI) / 2) * h * 0.24;
      const px = Math.round(ex),
        py = Math.round(ey / 2);
      if (px >= 0 && px < width && py >= 0 && py < h / 2) {
        let empty = true;
        for (let dy = -2; dy <= 2; dy++)
          for (let dx = -3; dx <= 3; dx++)
            if (mask[py * 2 + dy]?.[px * 2 + dx]?.trim()) empty = false;
        if (empty) screen.put(x + px, y + py, '·', mix(theme.bg, theme.orange, 0.45));
      }
    }
}
