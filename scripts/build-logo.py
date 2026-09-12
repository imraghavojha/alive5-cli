"""Compile the official Alive5 silhouette into terminal quadrant masks.
Input: downloaded official PNG. Output is code data, never decoded at runtime.
"""
from PIL import Image
import json
from pathlib import Path

image = Image.open('.local/design/alive5-official.png').convert('RGBA')
masks = {}
for width in [28, 38, 48, 62, 76]:
    height = max(8, round(width * image.height / image.width / 2) * 2)
    sample = image.resize((width * 2, height), Image.Resampling.LANCZOS)
    masks[str(width)] = [
        ''.join(' ' if (p := sample.getpixel((x, y)))[3] < 120 else 'o' if p[0] > 150 and p[1] < 150 else 'w' for x in range(width * 2))
        for y in range(height)
    ]
# Compact marks use a wider cutout and omit the thin secondary outline.
# Those details otherwise merge at fewer than ten terminal columns.
compact = [list(row) for row in masks['38']]
for y in range(2, 7):
    for x in range(61, 73):
        compact[y][x] = 'o'
for y, row in enumerate(['         ', '   oooooo', '        o', 'oooooo   ', '         ']):
    for x, cell in enumerate(row):
        compact[y + 2][x + 62] = cell
for y in range(8,len(compact)):
    for x in range(57,76):
        if compact[y][x]=='o': compact[y][x]=' '
masks['38'] = [''.join(row) for row in compact]
Path('src/tui/logo-mask.json').write_text(json.dumps(masks) + '\n')
