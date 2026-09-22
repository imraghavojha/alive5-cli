# Working on this CLI

Use the official public Postman collection linked in README.md as the API contract. Do not substitute internal webhook or private browser endpoints.

Keep terminal UI separate from JSON command output. Preserve the envelope and exit codes. Writes must never retry automatically. Do not put credentials or real customer transcripts in fixtures, documentation, or Git.

Modules have one responsibility each: command groups in `src/commands/`, transport in `src/http.js`, endpoints in `src/api.js`, record shapes in `src/normalize.js`, input rules in `src/validate.js`, local files in `src/storage.js`, text output in `src/output.js`, and the workspace split across `src/tui/` by state, keys, drawing, editing, and terminal lifecycle. Add behavior to the module that already owns it rather than widening another one. The version lives only in `package.json`, read through `src/meta.js`.

Run npm run check after behavior changes. Keep the suite focused on externally observable behavior. Live sends require a user-authorized recipient and purpose. Unit tests never use real credentials or send messages.

For visual changes, ask Claude Opus to review real terminal captures from the offline demo. Iterate on its concrete feedback before shipping. Record any provider failure honestly instead of substituting another model and calling it Opus. Use fake data in review images. Repeat an independent weaker-model command and terminal usability check after substantial interaction changes.

The interactive workspace owns the alternate screen. Keep the header and footer fixed, scroll content internally, restore terminal modes on exit, and leave the JSON command path free of animation. Respect reduced-motion settings. Keep rendering bounded and measure performance when adding effects.

## Where things live

| Path                   | Responsibility                                                                   |
| ---------------------- | -------------------------------------------------------------------------------- |
| `src/cli.js`           | Global options, the command context, and the single error-to-exit-code path      |
| `src/commands/`        | One file per command group; `shared.js` holds option and help helpers            |
| `src/http.js`          | Transport, the Alive5 response envelope, secret removal, pagination              |
| `src/api.js`           | Documented endpoints and their parameters                                        |
| `src/normalize.js`     | API shape to CLI record; the only place record field names are chosen            |
| `src/validate.js`      | Every input rule, shared by commands, the API layer, and the workspace           |
| `src/storage.js`       | Config directory, one atomic JSON writer, credentials, appearance, recent sender |
| `src/errors.js`        | `CliError`, HTTP status mapping, exit codes, the JSON envelope                   |
| `src/output.js`        | Human-readable text for the command path                                         |
| `src/tui/workspace.js` | Panel state machine, history, async requests, and mouse routing                  |
| `src/tui/flows.js`     | What each screen does: compose, pickers, threads, the command palette            |
| `src/tui/keys.js`      | Key handling, one function per panel kind                                        |
| `src/tui/panels.js`    | Drawing, one function per panel kind, including chat bubbles and pickers         |
| `src/tui/view.js`      | Fixed header, footer, notices, and the shortcut list                             |
| `src/tui/records.js`   | Columns, threads, relative times, and detail rows for records                    |
| `src/tui/editor.js`    | Text field value plus caret                                                      |
| `src/tui/runtime.js`   | Terminal lifecycle, signals, and the capped timer for animation and spinners     |
| `src/tui/input.js`     | Raw stdin decoding: bracketed paste, lone Escape, SGR mouse reports              |
| `src/tui/screen.js`    | The cell buffer, frames, links, click regions, and themes                        |
| `src/tui/terminal.js`  | Alternate screen, terminal modes, row-diffed output                              |
| `src/tui/text.js`      | Terminal-safe measurement, clipping, wrapping, and fuzzy matching                |
| `src/tui/logo.js`      | The eight wordmarks and the banner effects                                       |
| `src/tui/layout.js`    | Navigation order and panel geometry                                              |
