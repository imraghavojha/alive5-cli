# API contract and known limits

The CLI follows the public Postman collection. Endpoint observations below were
recorded in September 2026; offline tests cover their request and response mappings.

## Public API contract

- Entry point: [alive5.com/api](https://www.alive5.com/api)
- Authoritative collection: [Alive5 API Reference](https://documenter.getpostman.com/view/12135254/UVsQr3zh)
- Authentication: `X-A5-APIKEY` header
- Write/account host: `https://api.alive5.com/public`
- Read host: `https://api-v2.alive5.com/public`

| CLI command                                | Method and public path                     | Request mapping                                                                      |
| ------------------------------------------ | ------------------------------------------ | ------------------------------------------------------------------------------------ |
| `account`, `auth status`, login validation | GET `/1.0/account`                         | API key header                                                                       |
| `channels list`, `users list`              | GET `/1.0/objects/channels-and-users/list` | Users deduplicated locally by ID with channel memberships                            |
| `tags list`                                | GET `/1.0/objects/tags/list`               | No query                                                                             |
| `contacts list`                            | GET `/1.0/objects/contact/get-all`         | `page`, `limit`                                                                      |
| `sms send`                                 | POST `/1.0/conversations/sms/send`         | Multipart `phone_number_from`, `phone_number_to`, `message`, `channel_id`, `user_id` |
| `sms list`                                 | GET `/1.2/conversations/sms`               | `date_start`, `date_end`                                                             |
| `conversations list --type sms`            | GET `/1.0/conversations/sms`               | `date_start`, `date_end`, `page`, optional `channel_id`, `alive5_sessionID`          |
| `conversations list --type fbm`            | GET `/1.0/conversations/fbm`               | Same filters as SMS                                                                  |
| `conversations list --type livechat`       | GET `/2.0/conversations/livechat`          | `datetime_from`, `datetime_to`, zero-based `page`, `timezone_offset`                 |
| `reports summary`                          | GET `/1.0/conversations/summary`           | `from_datetime`, `date_end`, exactly as published                                    |

The collection shows HTTP for the 1.2 SMS history endpoint. This CLI uses HTTPS, verified against the same host and path, to protect the key.

## Verified differences and limits

The static website summary is older than the Postman collection. The implementation uses Postman's `channel_id` and `user_id` for sending, not the older site's assignment fields.

The collection uses month-day-year dates. Its time-based reporting example includes `04-19-2023`, which resolves the day/month ambiguity. CLI inputs stay ISO and are converted at the boundary.

Live chat's first page is `0`; its `pages` value is the final zero-based index. A live response containing six records had `page: 0, pages: 0`. CLI metadata converts this to page 1 of 1. SMS and contacts have one-based pages. SMS page support was checked live as well as against the public website's pagination description and Postman's response metadata.

The summary request as published returned `code: 400, data: null, error: {}`. The CLI retains the documented endpoint and reports failure. It does not guess alternate private routes.

The API sometimes returns a `404` for no matching conversations. The CLI does not silently turn every 404 into success. The public collection supplies neither an idempotency key contract nor delivery-status lookup. Sending is therefore single-attempt and delivery confirmation remains unknown until independently checked.
