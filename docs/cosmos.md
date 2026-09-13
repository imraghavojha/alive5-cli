# Cosmos, v0.4

Label, variation 8, is now the default logo with continuous Cosmos motion. The user's saved preferences were set to `frame`, `full`, and `cosmos`. Other logo variations remain available.

The banner has eight drifting stars, or six in narrow terminals, two comet passes per twelve-second cycle, and a small ringed planet. Wide terminals also show an orbiting moon. Each comet has at most five cells. Decorations stay inside the banner and cannot draw over the wordmark. The planet is omitted if another, wider logo leaves too little room. Motion off leaves a static scene. Task screens do not animate.

No particle arrays grow over time. The existing scheduler still caps sustained animation near six frames per second. A 500-frame warm-loop sample at 110×38 averaged 0.33 ms per frame, including ANSI row generation. An initial real 80×24 PTY sample emitted about 4.5 KB per second during motion. A motion-off sample emitted zero idle bytes.

Appearance storage now lives in a small module shared by the TUI and CLI commands. `appearance get` reads saved settings. `appearance set` validates choices and atomically saves a partial update, or previews it with `--dry-run`. Both work without credentials. Schema discovery includes every option and allowed value. JSON commands do not load the TUI renderer or print animation.

The focused suite has 18 tests, including command discovery, configuration round trips, dry-run behavior, invalid choices, private file permissions, and moving Cosmos scenes at 40, 80, and 110 columns. The existing SMS confirmation, offline preview, multiline paste, and terminal restoration checks remain in place. No live message was sent.

Claude Opus 5 inspected real offline terminal captures at 40 and 80 columns, including sequential animation frames. Its feedback led to dimmer comet heads, neutral diagonal rings, a moon confined to the planet rows, and fewer decorations at narrow widths. The existing shorter Home header and fixed Appearance preview area remain unchanged. Still images do not verify timing; the tests and PTY capture stream cover movement and bounds.

An independent GPT-5.6 Luna check passed schema discovery, saved settings, dry-run non-mutation, invalid choices, clean JSON, fake SMS preview and confirmation rejection, and a PTY settings/pause/save/resize/quit flow. Its artifacts are in `.local/v4/luna`. No real customer data was used.
