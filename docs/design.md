# Terminal redesign, v0.2

## Visual references

The user supplied [ThePrimeagen's Omarchy session at 1:51:21](https://www.youtube.com/watch?v=Qwekj_ZtmeY&t=6681s). The reference showed dimensional lettering, moving dot particles, and fixed scene controls. We inspected the video directly in Chrome. Alive5 uses its own mark and orange palette rather than the reference's typography or purple colors.

The logo mask derives from the [official Alive5 RGB asset](https://irp.cdn-website.com/519d3ac1/dms3rep/multi/Alive5_Logo_RGB_2023-01-high-01.png) linked by [alive5.com](https://www.alive5.com). Its dominant colors are `#EB5124` and `#48484A`. The terminal uses orange unchanged and light lettering on a charcoal background. The small version simplifies the secondary outline and widens the 5 cutout so the number survives at terminal resolution.

[GitHub's Copilot banner engineering article](https://github.blog/engineering/from-pixels-to-characters-the-engineering-behind-github-copilot-clis-animated-ascii-banner/) informed the separate animation data, color roles, and terminal compatibility work. [Bubble Tea](https://github.com/charmbracelet/bubbletea) informed the state/view split and bounded rendering. [OpenTUI](https://github.com/anomalyco/opentui), which powers OpenCode, was reviewed for persistent terminal layouts. [log-update](https://github.com/sindresorhus/log-update) provided another reference for overwriting output instead of appending.

We retained Node 22 compatibility and implemented a small cell renderer. There is no new production native binary or alternative runtime requirement.

## Rendering and interaction

The workspace uses the alternate screen with a fixed header, sidebar, content panel, and footer. Short or narrow windows collapse the sidebar. Below 40 columns or 24 rows, the workspace shows a resize message rather than drawing over itself.

The logo is precomputed quadrant-cell data at five sizes. Runtime code never downloads or decodes an image. A short convergence entrance resolves the outline before the interior. Signal sweep, Slow glow, and Orbit keep the same silhouette. Full mode caps the entrance at 20 fps and idle motion near 6 fps. Entrance only becomes static after the reveal. Off is static immediately. Input fields stop animation.

The renderer caches content rows and emits only changed rows in a single write, wrapped in synchronized-output sequences. It respects stream backpressure. No newline-based rendering is used inside the workspace, so repeated navigation cannot extend scrollback. Exit and interruption restore cursor visibility, line wrapping, bracketed paste, and the original screen.

Truecolor terminals use the exact orange; other color terminals receive a 256-color approximation. `NO_COLOR` suppresses color and motion. The shell-command JSON path does not load the workspace renderer.

A local warm-loop benchmark of 500 frames at 110×38 averaged approximately 1.6 ms per frame on this machine. This is a renderer measurement, not an end-to-end startup guarantee. A captured full-motion idle second emitted about 5.8 KB; motion-off emitted zero bytes during the idle sample. Native-window terminal screenshots were unavailable to the computer tool. Preview images render actual PTY output through xterm's headless terminal, with block glyphs drawn on whole-pixel cell boundaries.

## Claude Opus review loop

The installed Claude Code session was authenticated. Reviews ran with `--model opus`, read-only tools, and fake-data screenshots. Responses identified `claude-opus-5` as the reviewing model.

| Pass            | Result                   | Changes prompted                                                             |
| --------------- | ------------------------ | ---------------------------------------------------------------------------- |
| Direction       | Concrete redesign advice | Official letterforms, orange bubble, alternate-screen layout, reduced motion |
| First captures  | 6/10                     | More logo detail, flatter orange, consistent panel spacing                   |
| Second captures | 7.5/10                   | Compact task header, context-specific keys, clear entered values             |
| Third captures  | 8.5/10, hold             | Wider compact 5, paused-motion captures, focused message-field evidence      |
| Final gate      | 9/10, ship               | Reviewer confirmed the 5, typing hints, count, and preview were clear        |

These are one model's design judgments, not objective quality scores. Raw reviews and captures remain in the gitignored `.local/design` directory. No credentials or real customer records were shared with the reviewers.

## Weaker-model check

OpenCode's `mimo-v2.5-free` executed command schema discovery and an offline SMS preview. It also wrote its own temporary PTY driver and completed 20 interactive steps through Appearance, composing, review, editing, and quit. It verified that alternate-screen, cursor, wrapping, and paste modes were restored. It reported no CLI defects after correcting its own handling of the prefilled From field.

The reviewer inspected source code, so this was an independent operation check rather than a blind usability study. Its final prose incorrectly claimed it had not read source and that number shortcuts appeared in the footer; those claims were not adopted. No live messages were sent during this redesign.
