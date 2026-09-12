# Working on this CLI

Use the official public Postman collection linked in README.md as the API contract. Do not substitute internal webhook or private browser endpoints.

Keep terminal UI separate from JSON command output. Preserve the envelope and exit codes. Writes must never retry automatically. Do not put credentials or real customer transcripts in fixtures, documentation, or Git.

Run npm run check after behavior changes. Keep the suite focused on externally observable behavior. Live sends require a user-authorized recipient and purpose. Unit tests never use real credentials or send messages.
