# Verification

September 12, 2026. Tests used the local Node 22 installation and the existing Alive5 account selected in Chrome.

## Automated checks

Ten focused Node tests pass. They cover:

- Agent discovery, parse errors, and clean JSON without ANSI output.
- Date and phone validation.
- Nested API failures and credential redaction.
- Multipart sending, exactly one request, and uncertain delivery after a timeout.
- Offline previews and explicit send intent.
- Contact pagination and the published query names.
- SMS/live-chat normalization, live-chat page conversion, and HTTPS SMS history.
- Rate limits, malformed replies, and host restrictions.
- Private credential-file permissions, replacement, and logout.
- Terminal control-character stripping.

`npm run check` also checks formatting. `npm pack --dry-run` checks the distributable file list. No test reads production credentials or sends SMS.

## Live checks

Account authentication, channels/users, tags, contact pagination, SMS transcript history, live-chat transcripts, SMS sending, and recent SMS message history were exercised against the public API.

One real text with marker `A5-0912` was sent to the user's authorized number ending in **9057**. Alive5 returned `sent`. Google Messages independently showed the incoming text from the Alive5 number at **5:35 PM America/Chicago**. The public 1.2 SMS history endpoint returned that same marker at **2026-09-12T22:35:33.490Z**. No additional live text was sent for the agent check.

The documented summary report returned an upstream empty error object. An empty Facebook conversation range returned `404 not found`; successful Facebook transcript data was not available to verify. Those paths remain explicit failures rather than invented empty results.

The terminal launch, first-run login prompt, masked input, keyboard menu, cancellation, and clean exit were checked through a pseudo-terminal. The computer-use tool refused access to the installed terminal app, so native-window screenshot QA was not available.

## External agent check

OpenCode with `opencode/glm-5.3` could not start because the configured OpenCode account returned `No payment method`. No billing settings were changed.

A second pass used the available `opencode/mimo-v2.5-free` model with an empty CLI credential directory. It executed help and schema discovery, a dry-run SMS, a send without confirmation, an invalid date, and an unknown flag. It reported all six checks passing and no defects. All activity was offline and limited to the CLI commands. Its review incorrectly described `--no-input` as required; it is optional because piped output already disables prompts. `--yes` is the flag required for noninteractive sending.

Agent logs stay in the gitignored `.local` directory. They are not part of the package. The GLM-specific check remains blocked by the existing provider account's billing state.

## Version 0.2 redesign

The suite now contains 14 focused tests. All pass on Node 22.18.0 and Node 26.0.0. Four additional interaction tests cover the guided composer and explicit send confirmation, overlong messages, bounded layouts and internal scrolling, appearance controls, real PTY navigation, multiline paste, and restoration of the shell. Existing API and JSON-contract tests still pass.

The visual review and independent weaker-model terminal check are recorded in [design notes](design.md). The redesign uses fake data for captures and review. It did not send another real SMS. Version 0.1's delivery verification above remains the last live send check.

## Version 0.3

All 16 focused tests pass on Node 22.18.0 and Node 26.0.0. `npm run check` and the package dry-run pass. The two new tests cover all eight logo previews, saved preferences, migration from V2, continuous effects, and static task screens. The existing real PTY test continues to exercise compose, multiline paste, review, editing, resizing, and terminal restoration.

V3 was tested offline with fake contacts and numbers. No live SMS was sent. Three Claude Opus capture reviews and an independent GPT-5.6 Luna command/PTY check are documented in [V3 design notes](design-v3.md), along with performance samples and the inconclusive OpenCode attempt.

## Version 0.4

All 18 tests pass, including the new agent-facing appearance commands and bounded Cosmos effects. Appearance configuration works without an API key and preserves JSON output and exit codes. The independent command/PTY review passed. Details, render measurements, and visual review notes are in [Cosmos notes](cosmos.md). This release was verified offline and sent no live SMS.

## Version 0.5

September 21, 2026. All 40 tests pass on Node 22.18.0 with `TZ=America/Chicago`, and `npm run check` is clean. This release was verified offline with fake data and sent no live SMS.

New tests cover local-calendar date presets, command typo suggestions and missing-flag fields, aligned details with OSC 8 links, thread grouping and chat alignment, searchable pickers, Home's recent threads, the command palette, and mouse clicks and decoding. The PTY test also checks that mouse reporting is turned off on exit.

Real PTY captures were taken at 120×34, 80×24, and 40×24 in the dark theme, and at 120×34 in the light and high-contrast themes. A separate PTY script sent SGR click and wheel reports to the demo and confirmed that the menu selection and opening worked. The README GIF was recorded with VHS from `docs/demo.tape` against the offline demo.

The captures were reviewed by the Claude Opus 5.5 session that made the changes, not by an independent reviewer. That review led to the flexible message column at 40 columns, ellipses on clipped labels, right-aligned picker hints, and hiding `Tab recent` when recent threads do not fit. No weaker-model usability pass was run for this release.
