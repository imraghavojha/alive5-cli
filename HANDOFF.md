# Alive5 CLI improvement handoff

**Status, September 24, 2026.** The later appearance pass implemented items 6, 12, 14, and 15 on top of `e885aaa`. Item 24 is partial because this checkout has no remote release target or cross-platform test environment. The current suite has 37 passing tests and `npm run check` is clean.

|           | Items |
| --------- | ----- |
| ✅ Done   | 1–23  |
| ◐ Partial | 24    |

The review and implementation history below remains for context. [Current work and remaining verification](#current-work-and-remaining-verification) at the end supersedes the older “Remaining work” section.

Reviewed September 24, 2026 against CLI commit `3aa385f`. Read the complete thread `e9b56e9e-7888-4b42-8a27-68d9feb9a839`, compared it with this session's review, rechecked the source and failure cases, and independently consulted primary documentation. This replaces both review artifact sets. At the time of that review, no product changes had been implemented.

## Implement first: correctness and recovery

1. ✅ **Represent send outcomes accurately.** Separate sending, accepted, rejected, and unknown results. An uncertain send currently retains “Nothing has been sent” and allows another Enter to send again. Preserve the draft and require deliberate recovery.
2. ✅ **Show complete sending context.** Include workspace, channel, teammate, sender, recipient, and full message in review so users can verify every consequential choice.
3. ✅ **Provide real text editing.** Support cursor movement, insertion, deletion, and multiline navigation. Typing currently only appends; fixing a word is unnecessarily difficult. Preserve safe multiline paste and accurate limit wording.
4. ✅ **Make Back preserve work.** Return to the previous step with draft, selection, filters, and scroll position intact. Escape currently jumps Home and discards form context. Avoid saving message drafts to disk by default.
5. ✅ **Keep errors and progress readable.** Show wrapped errors near the affected content and a visible busy state without hiding shortcuts. Long send warnings currently truncate in the footer.
6. ✅ **Correct scrolling and truncation.** End followed by Up should visibly scroll immediately; resizing should preserve valid positions. Indicate clipped labels with an ellipsis and show progress through long previews.
7. ✅ **Clarify dates and global options.** Use clearly labeled calendar/timezone behavior, offer common date presets, and honor applicable timeout settings in the TUI. UTC-derived “today” and ignored global-looking options are misleading.
8. ✅ **Make command errors actionable.** Replace `(outputHelp)` with the required subcommand and recovery guidance; add structured field/details information where useful. Invalid commands must remain explicit failures.

## Improve everyday usability and appearance

9. ✅ **Replace record dumps with selectable lists.** Use compact, relevant columns with full details available on demand. Contacts currently repeat names and internal field labels across many lines.
10. ✅ **Connect browsing to actions.** Allow opening a record, composing to a selected contact, and copying useful values where supported. Users should not retype a number they just found.
11. ✅ **Add contextual search and help.** Support list filtering and a shortcut overlay. Clearly distinguish searching loaded records from searching the entire account; keep typing fields free of shortcut conflicts.
12. ✅ **Adapt layout to the task and terminal.** Use list/detail panes when space permits and a single panel on narrow screens. Give reading/editing useful space while retaining comfortable line lengths and fixed navigation hints.
13. ✅ **Prioritize work in navigation.** Use a compact contextual header and emphasize Compose, Messages, Conversations, and Contacts. Keep appearance and agent help accessible as secondary choices.
14. ✅ **Make visual defaults calmer and more accessible.** Default new preferences to static or entrance-only motion, preserving saved choices and all existing effects. Add light/dark/terminal-native and high-contrast options, stronger focus indication, and readable action colors. The current body-text contrast is already good.
15. ✅ **Provide a linear accessibility path.** Support readable non-animated interaction/output alongside the alternate-screen workspace. Color removal alone does not establish screen-reader usability.

## Improve discovery for people and agents

16. ✅ **Improve command help.** Add short examples, surface environment authentication and stdin login, and make exit-code guidance easy to find without bloating every command's help.
17. ✅ **Expand machine discovery.** Describe input constraints, conditional options, allowed output fields, result shapes, authentication, side effects, and compatibility guarantees. Agents should not need source inspection or sample customer records.
18. ✅ **Describe dry runs honestly.** Identify local validation explicitly. Any optional account/channel preflight must use documented read APIs and must not promise delivery or validate unsupported sender associations.
19. ✅ **Make installed guidance and diagnostics discoverable.** Expose the agent usage guide and add structured local diagnostics for runtime, PATH, and configuration, with network checks explicit and secrets omitted. Distinguish contributor instructions from CLI-user instructions.
20. ✅ **Add shell completions.** Support the claimed shells with installation guidance and verification. This mainly improves human command use; it is not a prerequisite for agents. [GitHub CLI completion reference](https://cli.github.com/manual/gh_completion)

## Simplify maintenance without losing features

21. ✅ **Separate responsibilities incrementally.** Split command groups, transport, configuration, validation, output, terminal lifecycle, navigation, and task-specific behavior where they currently overlap. Avoid a framework rewrite or a rigid folder count. [Stripe architecture](https://github.com/stripe/stripe-cli/blob/master/ARCHITECTURE.md)
22. ✅ **Centralize shared contracts and duplicated rules.** Retain structured records, clarify state/result types, share normalization and presentation rules, consolidate atomic writes and status mapping, and use one version source. Keep JSON, line-oriented text, and full-screen rendering distinct.
23. ✅ **Remove verified dead code during refactoring.** Unused logo sizing, layout properties, and color tokens obscure the active design. A panel registry is optional; the requirement is understandable ownership of rendering, keys, and transitions. [Lazygit's own architecture tradeoffs](https://github.com/jesseduffield/lazygit/blob/master/docs/dev/Codebase_Guide.md)
24. ◐ **Strengthen verification and distribution.** Cover the reproduced failures, package installation, supported Node/OS combinations, narrow/wide terminals, themes, and accessibility. Make capture fonts portable and document an actual release/install/update path before claiming public distribution.

## Suggestions to reject or defer

All still stand. None were acted on.

- **Reject client-only “idempotency.”** An echoed ID cannot prevent duplicate SMS. Revisit only with documented server support; retain no automatic send retries and honest unknown outcomes. [Server-backed idempotency example](https://docs.stripe.com/api/idempotent_requests)
- **Keep the existing JSON error stream and envelope.** Defer `--errors stderr`; it adds contract combinations without an established need. JSON errors on stdout are also used by oclif. [oclif command source](https://github.com/oclif/core/blob/main/src/command.ts)
- **Defer ID-only quiet/brief modes.** Normal machine output is already undecorated; stripping send status would hide useful outcome information.
- **Defer automatic all-page export and NDJSON.** If needed, make them explicit and bounded, preserve partial-failure reporting, and restrict them to supported endpoints. They reduce agent invocations, not API requests. [GitHub pagination semantics](https://cli.github.com/manual/gh_api)
- **Do not stretch every panel to eliminate blank rows.** The reader and preview already use available height. Improve information density and task flow instead of optimizing a blank-row percentage.
- **Keep useful command suggestions.** Existing suggestions accompany `ok:false` and exit 2; there is no demonstrated reason to remove them. [Commander error behavior](https://github.com/tj/commander.js#display-help-after-errors)
- **Do not ship contributor `AGENTS.md` as the agent usage guide.** Clarify document titles/audiences; a filename change is optional and must preserve links.
- **Defer named profiles, external-editor integration, MCP, agent-skill installation, embedded jq/templates, man pages, clickable links, plugins, and broad framework migration** until a concrete usage need justifies their cost.
- **Do not optimize for the linter grade or promise a one-week schedule.** The audit misidentifies existing capabilities and includes malformed discovered commands. Its path-traversal/control-character probes do not establish general security guarantees. Completion support is not credibly estimated as “40 lines.”

## Preserve and verify

Keep all existing features, command names/flags, normalized records, explicit pagination, raw output, JSON envelopes, exit codes, credential protections, terminal restoration, and motion controls. Keep all logos/effects optional. Use only documented public APIs. No live sends without an authorized recipient and purpose.

The 18 tests that existed at review time passed; the critical send, editing, Escape, and parent-command failures were independently reproduced. The suite is now 29 tests and all of those reproduced failures have regression coverage. Future behavior changes must pass `npm run check` and focused regressions. Follow the existing `AGENTS.md` visual-review requirements when shipping UI changes.

Cleanup removed `.local/audit/`, `.local/review-2026-09-24/`, and the empty accidental `cli/` subtree inside this CLI repository. Existing tracked documentation and unrelated development artifacts were preserved. This handoff is the only new project file.

## What was implemented

Items 1–5, 7–13, and 16–23 are done, with 29 passing tests and `npm run check` clean.

**Correctness and recovery.** Send outcomes are now four distinct states — in flight, accepted, rejected, and unknown. An unknown result keeps the draft, replaces "Nothing has been sent" with an explicit warning, and will not send again on the next Enter. Review shows workspace, channel, sending teammate, sender, recipient, and the full message. Form fields are real text fields with a caret: ←→, Home/End, Backspace, Delete, Ctrl+W, Ctrl+U, Tab/Shift+Tab, and Ctrl+J for line breaks; multiline paste and the 1600-character wording are unchanged. Escape steps back one panel and keeps the draft, selection, filter, and scroll; nothing is written to disk. Errors wrap across the footer instead of being clipped, and the rule moves up so the panel does not shift. Parent commands now fail with `SUBCOMMAND_REQUIRED`, exit 2, and `error.details.subcommands`, rather than `(outputHelp)`.

**Usability.** Record dumps became compact selectable tables with per-type columns, full detail on Enter, `/` filtering that states it only covers loaded records, `y` to copy, `m` to compose to the highlighted contact, and `n` for the next page. Date screens offer Today, Yesterday and today, Last 7 days, Last 30 days, and an explicit range, and say they use this computer's calendar. `?` opens a shortcut overlay from any panel. Timestamps are shown without the `T` and `Z`. Navigation leads with the four work sections.

**Discovery.** Every command group and the leaf commands that need them carry `Examples:` blocks. `schema` now reports argument shapes, which options take a value, the authentication block, side effects, and expanded notes. `alive5 completion bash|zsh|fish` generates completions from the live command tree. `alive5 doctor` reports runtime, PATH, terminal, and configuration state with `networkChecked: false` and no key material. `--dry-run` reports `validated: "locally"`.

**Maintenance.** `src/core.js`, `src/ui.js`, and `src/appearance.js` were replaced by single-responsibility modules: `errors.js`, `validate.js`, `storage.js`, `http.js`, `normalize.js`, `output.js`, `prompts.js`, `meta.js`, and one file per command group under `src/commands/`. The workspace split into `workspace.js` (panel mechanics, 698 → 384 lines), `flows.js`, `keys.js`, `panels.js`, `view.js`, `layout.js`, `records.js`, `editor.js`, `input.js`, `runtime.js`, `terminal.js`, `screen.js`, and `text.js`. HTTP status mapping, atomic JSON writes, and record field names each have exactly one home, and the version is read from `package.json`. Dead code went: `logoSizes`, `theme.gray`, and the unused `layout()` properties. The wordmark table is generated by joining a word block and a numeral block, which replaced the hand-measured `digitStart` offsets.

**Wordmark.** Every wordmark now reads `Alive5` with no space, in the type, label, and bitmap variants and in the four FIGlet variants, where the numeral block was tightened to the font's own letter spacing. The README, docs, tests, and the `From · your Alive5 number` field label follow.

## Current work and remaining verification

- **Appearance (14):** Fresh preferences now use entrance-only motion. Existing saved motion stays intact. Dark, light, terminal-native, and high-contrast themes flow through the cell renderer; terminal-native uses ANSI default foreground/background and reverse video for focus. Focus is clearer in lists and fields, and action text follows the chosen theme. The CLI and TUI can save all four appearance settings.
- **Scrolling and layout (6, 12):** Reader End/Up scrolls immediately by using the actual visible height. Resize clamps offsets and selection without resetting valid positions. At 100 columns or wider, lists show a selected-record detail pane; very wide tables retain all columns. Narrow terminals use one panel and prioritize the fields that identify each record.
- **Linear interaction (15):** `alive5 --linear` runs the workspace as ordinary text without alternate screen, animation, or raw mode. It shares the same state and send confirmation. It has automated text-output coverage but has not been tested with a screen reader, so no screen-reader compatibility claim is made.
- **Capture and packaging (24):** The capture script finds a monospace font on macOS, Linux, or Windows and uses theme-matched terminal defaults. The 37 tests passed locally on macOS with Node 22.18.0 and 26.0.0. `npm pack`, offline installation from the tarball, and the installed binary were verified locally. A GitHub Actions matrix now schedules tests, package installation, and capture on macOS, Linux, and Windows with Node 22, 24, and 26. This checkout has no Git remote, so the matrix has not run. README documents local install, update, and unlink. The package remains private; no public release target is configured.
- **Visual review:** Claude Opus 5 read six real offline PTY PNG captures and identified capture defaults, wide-list density, focus, and theme contrast issues. Those fixes were applied and captured again. A requested second Opus pass hit Claude Code's rate/session limit; an attempt through OpenCode reported insufficient account funds. Neither returned feedback. An independent `mimo-v2.6-flash-free` command and terminal pass found narrower list, shortcut, hint, and wrapping defects that were fixed. Its later review of four PNGs reported no blocking visual defects. The screenshot files and raw responses are gitignored under `.local/`.

No live messages were sent. Review images use fake offline data.

## Version 0.5, September 21

This pass made the UX changes from the terminal UX review and deliberately left out the agent-facing proposals (fewer IDs for sending, a delivery check, contact search, output-field discovery, structured next steps, JSON payload input, NDJSON, MCP). Those remain open.

- **Fixes:** date presets use the local calendar; mistyped commands suggest the intended one; missing flags name their field; list screens show a spinner while loading.
- **Look:** framed list panes with scrollbars, aligned label/value details, OSC 8 links, relative times in lists and local times in details, bright keys in the footer, and self-clearing notices.
- **Conversations:** messages and transcripts are threads with a chat-style transcript and `r` to reply.
- **Compose:** channel and teammate are form fields; pickers search as you type; To can search contacts; the last sender is remembered in `recent.json`.
- **Navigation:** Home shows recent threads, `Ctrl+K` searches every action, and the mouse selects, opens, and scrolls.
