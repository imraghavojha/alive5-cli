# Terminal design, v0.3

The earlier T3 thread was read before implementation. V3 follows the user's latest direction: a minimal layout and eight selectable Alive 5 wordmarks. The official raster silhouette is no longer the runtime logo.

## Research and choices

- [Command Line Interface Guidelines](https://clig.dev/) informed concise output, discoverable commands, terminal detection, and preserving machine-readable output. The guide explicitly excludes full-screen applications, so it is not treated as a full-screen layout specification.
- [Stripe CLI](https://github.com/stripe/stripe-cli) provides a reference for focused commands, help, and explicit flags. Slash is an original Alive 5 rendition using FIGlet Small Slant lettering. We did not verify that Stripe currently ships the slash logo the user remembers.
- [Bubble Tea](https://github.com/charmbracelet/bubbletea) informed keeping input, state, and rendering separate. The existing Node cell renderer remains in place; this release does not add a production TUI framework.
- [GitHub's animated banner engineering article](https://github.blog/engineering/from-pixels-to-characters-the-engineering-behind-github-copilot-clis-animated-ascii-banner/) informed treating a banner as terminal cells with bounded animation work and terminal compatibility in mind.

The layout is one left-aligned column, capped at 78 cells. Home has six numbered choices and one description. There is no sidebar, slogan, or repeated command column. The selected logo stays above Home and Appearance; forms and readers have a one-line brand header. Wordmark and Label use shorter headers on Home. Appearance keeps a fixed preview area so controls stay still while comparing logos.

## Logo gallery

| Key | Name     | Construction                                 |
| --- | -------- | -------------------------------------------- |
| 1   | Wordmark | Plain type and an orange 5                   |
| 2   | Slash    | Slanted ASCII lettering with forward slashes |
| 3   | Outline  | Compact ASCII outline, initial default       |
| 4   | Pixel    | Solid terminal cells                         |
| 5   | Dots     | ASCII dot matrix                             |
| 6   | Wire     | Thin ASCII strokes                           |
| 7   | Slab     | Squared ASCII lettering                      |
| 8   | Label    | Small text inside a fine border              |

`a` opens Appearance. Arrow keys select and change settings. `1`–`8` switch logos directly. `s` saves all appearance settings, `r` restarts the effect, and Space pauses or resumes motion. Enter activates Replay or Save appearance. Left and right arrows do not trigger action rows. Existing appearance files gain the default Outline logo while retaining their motion and effect preferences.

Every logo supports Light sweep, Slow glow, and Star drift. Continuous mode keeps the effect running. Entrance only runs it for 850 ms, then becomes static. The lettering never disappears. Eight deterministic stars drift in the banner's top and bottom rows without crossing letter cells. Task screens perform no animation rendering. Reduced-motion flags override saved motion choices.

## Letterform credits

Outline, Slash, Wire, and Slab are precomputed output from [pyfiglet](https://github.com/pwaller/pyfiglet), using Small, Small Slant, Bigfig, and Rectangles. Only the rendered words are included at runtime, not the font library. Small, Small Slant, and Bigfig are by Glenn Chappell. Small and Small Slant include font-format updates by Paul Burton. Rectangles is by David Villegas. No font definitions were modified. Other variants are cell-native designs in `src/tui/logo.js`.

## Verification

Tests use fake data and temporary configuration directories. The existing API contract, JSON envelope, exit codes, and send confirmation tests remain in place. Additional checks cover all eight previews, saving and loading settings, migration from V2 settings, persistent motion, static task screens, narrow-window controls, and terminal restoration.

Real PTY captures are rendered through xterm's headless emulator. They are not native terminal-window screenshots. The gallery and workspace images in `docs/media` come from those captures. Raw captures and external review logs stay in `.local/v3`, outside the package.

Three Claude Opus review passes inspected the fake-data captures. Feedback led to clearer letterforms, removal of repeated branding and command clutter, portable ASCII dots, aligned footers, shorter labels, and removal of duplicate message hints. The final reported accent-color defects in Wire and Slab were corrected and checked in fresh captures. Opus noted that Wire's stylized A can read as H at a glance. It remains one of the eight options for the user to compare; Outline is the default. The reviewer did not evaluate motion from still images.

A 500-frame warm-loop sample at 110×38 averaged 0.31 ms per frame, including ANSI row generation. A real 80×24 PTY sample emitted about 4.1 KB during one second of continuous star motion. A separate 110×38 motion-off sample emitted zero idle bytes. These are local measurements, not startup or remote-terminal performance guarantees.

The independent GPT-5.6 Luna check executed help and schema discovery, a fake SMS dry-run, and rejection of a send without confirmation. Its own PTY driver completed all eight logo selections, settings changes, pause/save, composing with a prefilled sender, multiline paste, review/edit, resizing to 40×24, and clean quit. It found no implementation defects after correcting its driver assumptions. The driver remains in `.local/v3/luna`.

OpenCode's MiMo check was also attempted. Its driver repeatedly used old labels or doubled the prefilled sender. External-directory approval rejections interrupted debugging. That run is recorded as inconclusive rather than a passing independent check; its speculative paste diagnosis was not adopted.
