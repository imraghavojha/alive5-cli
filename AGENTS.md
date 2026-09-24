# Working on this CLI

Use the official public Postman collection linked in README.md as the API contract. Do not substitute internal webhook or private browser endpoints.

Keep terminal UI separate from JSON command output. Preserve the envelope and exit codes. Writes must never retry automatically. Do not put credentials or real customer transcripts in fixtures, documentation, or Git.

Modules have one responsibility each: command groups in `src/commands/`, transport in `src/http.js`, endpoints in `src/api.js`, record shapes in `src/normalize.js`, input rules in `src/validate.js`, local files in `src/storage.js`, text output in `src/output.js`, and the workspace split across `src/tui/` by state, keys, drawing, editing, and terminal lifecycle. Add behavior to the module that already owns it rather than widening another one. The version lives only in `package.json`, read through `src/meta.js`.

Run npm run check after behavior changes. Keep the suite focused on externally observable behavior. Live sends require a user-authorized recipient and purpose. Unit tests never use real credentials or send messages.

For visual changes, ask Claude Opus to review real terminal captures from the offline demo. Iterate on its concrete feedback before shipping. Record any provider failure honestly instead of substituting another model and calling it Opus. Use fake data in review images. Repeat an independent weaker-model command and terminal usability check after substantial interaction changes.

The interactive workspace owns the alternate screen. Keep the header and footer fixed, scroll content internally, restore terminal modes on exit, and leave the JSON command path free of animation. Respect reduced-motion settings. Keep rendering bounded and measure performance when adding effects.
