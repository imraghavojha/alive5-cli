# Alive5 CLI

<img src="docs/media/hero.png" width="560" alt="The alive5 wordmark beside a cute retro cream computer with a terminal-prompt face">

Read conversations, reply, and send texts from your terminal. The same commands return clean JSON for scripts and AI agents.

<img src="docs/media/demo.gif" width="800" alt="The current workspace with the Isometric Desktop mascot: Home, a conversation, a reply, and contact search">

[Watch the full-resolution demo](docs/media/demo.mp4)

## Installation

The CLI needs Node.js 22 or newer. It is not on npm yet, so install it from this checkout:

```sh
npm install
npm link   # puts alive5 on your PATH
alive5
```

To update, pull, then run `npm ci` and `npm link`. To remove it, run `npm unlink -g @alive5/cli`. You can also run `node bin/alive5.js` without linking.

## Connect your account

Run `alive5` and paste your API key from **Alive5 → Integrations → API Key**. The CLI checks it with Alive5 and saves it to `~/.config/alive5/credentials.json` with mode `0600`. That is file protection, not encryption.

For automation, set `ALIVE5_API_KEY`, or pipe a key into `alive5 auth login --key-stdin`. There is deliberately no key flag, so keys stay out of shell history.

## The workspace

Run `alive5` with no arguments.

<table>
  <tr>
    <td><img src="docs/media/conversations.png" alt="A thread list beside the selected conversation"></td>
    <td><img src="docs/media/contact-picker.png" alt="Searching contacts by typing part of a name"></td>
  </tr>
</table>

- **Home** shows the last seven days of conversations beside the menu. `Tab` moves between them.
- **Conversations** read like a chat: the customer on the left, your team on the right. `Enter` opens one. `r` replies with the number and channel filled in.
- **Compose** is one form: channel, teammate, sender, recipient, and message. Press `Enter` on an empty field, or `Ctrl+F`, to choose from a list you can search by typing. The CLI remembers your last channel and teammate.
- **Review** lists every consequential choice before anything is sent. If a send result is uncertain, your draft is kept and the next `Enter` does not send it again.
- **`Ctrl+K`** finds any action by name.
- **The mouse works.** Click to select, click again to open, and scroll with the wheel. Hold Shift (Option in Terminal.app and iTerm2) to select text.

| Key               | Does                                                        |
| ----------------- | ----------------------------------------------------------- |
| `↑` `↓` / `j` `k` | Move                                                        |
| `Enter`           | Open or confirm                                             |
| `Esc`             | Go back one step, keeping your draft, selection, and filter |
| `Ctrl+K` / `:`    | Search every action                                         |
| `/`               | Filter the loaded list                                      |
| `r` / `m`         | Reply to a conversation / message a contact                 |
| `y`               | Copy the highlighted value                                  |
| `n`               | Load the next page                                          |
| `?`               | Every shortcut                                              |
| `q`               | Quit. `Ctrl+C` always quits.                                |

**Appearance.** Press `a` to choose one of eight wordmarks, a computer mascot, a banner effect, and a Dark, Light, Terminal, or High contrast theme. Terminal colors and the compact Isometric Desktop are the defaults for new installs; select the Mascot row and use ←/→ to switch to Pocket Macintosh. Press `s` to save. Motion defaults to Full (continuous animation); Subtle plays an entrance and then holds still, and Off pauses it. Saved theme and motion preferences are preserved. Both mascots show typing dots in Messages, a typing cursor in Compose, a contact card in Contacts, and alternating speech bubbles in Conversations. These animate in the header at about 6 fps, leaving task content still. `NO_COLOR`, `ALIVE5_NO_ANIMATION=1`, or `--no-animation` turn motion off. You can also run `alive5 appearance set --mascot pocket-macintosh --motion full` or `alive5 appearance set --mascot isometric-desktop`. [Compare the wordmarks](docs/media/logos-v3.png) · [See both mascots in motion](docs/media/logo-motion.gif)

**Line mode.** `alive5 --linear` runs the same workspace as plain lines of text, without full-screen drawing. It is meant for screen readers, logs, and slow connections, but it has not yet been tested with a screen reader.

The workspace needs at least 40×24. Wider terminals get side-by-side panes.

## Commands

```sh
alive5 channels list        # sending numbers, channel IDs, and user IDs
alive5 contacts list --limit 10
alive5 sms list --since 2026-09-12 --until 2026-09-13
alive5 conversations list --type livechat --since 2026-09-01 --until 2026-09-08
alive5 sms send --from +15555550100 --to +15555550101 \
  --channel CHANNEL_ID --user USER_ID --message 'See you at 10.' --dry-run
alive5 doctor               # local checks, no network
alive5 completion zsh > "${fpath[1]}/_alive5"
```

`--dry-run` validates locally and prints the exact form without calling the API. Replace it with `--yes` to send. To include a full day, set `--until` to the day after.

## Receive texts

Point the CLI at the deployed relay, then subscribe your Alive5 number:

```sh
export ALIVE5_RELAY_URL='https://<deployed-relay-host>'
alive5 inbox channels add +15555550100
alive5 inbox wait --timeout 60 --json
alive5 inbox listen --line +15555550100 --notify
alive5 inbox channels list
alive5 inbox channels remove +15555550100
```

There is no default relay URL yet. You can also set `relayUrl` in `inbox.json` in the config directory. The environment variable overrides it. The first `channels add` uses your saved Alive5 key (or `ALIVE5_API_KEY`) to register and saves `{relayUrl,clientId,token,wsUrl}` there with mode `0600`. The directory follows `ALIVE5_CONFIG_DIR`, then `$XDG_CONFIG_HOME/alive5`, then `~/.config/alive5`.

For agents, use **wait → read → reply with `sms send` → wait**. `wait` prints exactly one text and exits 0, or exits 124 without stdout on timeout. Its `--timeout` is in seconds; omit it to wait indefinitely. `listen` runs until stopped. Both keep one idle WebSocket, reconnect with backoff, and never poll Alive5. `--notify` adds macOS notifications; other systems warn once and continue.

Piped output (or `--json`) is one JSON envelope per text, with `data` containing `type`, `id`, `line`, `channelId`, `from`, `text`, `threadId`, and `receivedAt`. Status and errors go only to stderr. On a terminal, each text is one readable line. Streams do not support `--fields` or `--raw`.

Texts are acknowledged only after stdout accepts the write. Unacked texts stay on the relay for 24 hours, including those skipped by `--line`. Reconnects can replay a text, so deduplicate by `data.id` if needed. This acknowledges output, not your agent’s later processing. Media-only texts are not delivered by Alive5 webhooks. Ctrl+C or SIGTERM closes the socket and exits 130.

## For agents and scripts

Piped output is JSON: one envelope per command, errors included. Inbox streams use the per-text format above, with errors on stderr.

```json
{ "ok": true, "data": [], "error": null, "meta": { "schemaVersion": 1 } }
```

- `alive5 schema` describes every command, flag, exit code, and side effect.
- Exit codes: 0 ok · 1 local · 2 usage · 3 auth · 4 API · 5 rate limit · 124 wait timeout · 130 cancelled.
- A mistyped command returns `UNKNOWN_COMMAND` with `error.details.suggestions`. A missing flag returns `MISSING_OPTION` with `error.field`.
- Nothing prompts when output is piped. Sending needs `--yes` and never retries.

## Good to know

- When Alive5 accepts a text, that does not confirm it reached the handset, so send results say `deliveryConfirmed: false`. A send that fails on the network may still have gone through; check before you resend.
- The API does not say which side sent a message. The workspace treats a phone-number sender as the customer.
- The CLI follows the [public Postman collection](https://documenter.getpostman.com/view/12135254/UVsQr3zh).

## Development

```sh
npm test            # offline; never sends a message
npm run check       # formatting and tests
npm run demo        # the workspace with fake data
npm run capture     # PTY screenshots into .local/design
vhs docs/demo.tape  # re-record the GIF above with Charm's VHS
```

## License

UNLICENSED. Private to Alive5.
