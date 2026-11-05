# Inbox maintenance

The default HTTP relay base is `https://wmbb2krgd4yqmghwsxd3yamzey0ocqsz.lambda-url.us-east-1.on.aws/v1`, matching the Keragon connector. `ALIVE5_RELAY_URL` overrides `relayUrl` in `inbox.json`, which overrides the default. HTTP overrides may include `/v1` or omit it. Remove existing subscriptions before changing relay URLs.

`inbox.json` is stored with mode `0600` under `ALIVE5_CONFIG_DIR`, `$XDG_CONFIG_HOME/alive5`, or `~/.config/alive5`. Its shape is `{relayUrl,clientId,subscriptions:{line:{subscriptionId,deliveryToken,websocketUrl,channelId,checkpoint?}}}`. Add/remove authenticate with `X-A5-APIKEY`; a stable client ID makes registration retries reuse subscriptions. Failed removal preserves local credentials for retry.

Commander parses global options anywhere by default. Its positional mode permits shadowing but breaks existing commands with trailing global flags, so `inbox wait --wait <seconds>` sets the wait duration and global `--timeout <ms>` remains the HTTP timeout, including history reads.

Sockets accept only `wss://<api-id>.execute-api.<region>.amazonaws.com` destinations. Subscription IDs and delivery tokens are query credentials. Each subscribed line has one socket, pinged every five minutes and renewed after 110 minutes, with reconnect backoff. There is no acknowledgement or replay protocol.

On connection, live frames are held while paginated SMS history is scanned: initially 24 hours, then one minute before the successful-output checkpoint. History/live matching consumes individual sender/text occurrences within five seconds; distinct live IDs are never content-deduped. Checkpoints retain up to 1,000 hashed overlap occurrences for one minute of message time and exact relay IDs for 30 minutes of observation time. Message bodies are not saved. A history scan has a 100-page guard and fails on repeated pages; there is no periodic history polling.

Checkpoints advance after stdout accepts a write, not after an agent processes it. ID-less history matching is approximate, history indexing can lag, and duplicates can recur beyond retained windows. Stream events contain `type`, `id`, `line`, `channelId`, `from`, `text`, `threadId`, `receivedAt`, `direction`, and `mediaUrl`; history IDs, thread IDs and media URLs may be null. Streams reject `--raw` and `--fields`.
