# API Routes Reference

Deterministically generated from `src/app/api/**/route.ts` via `npm run docs:api`.

- **OpenAPI Spec:** [`docs/architecture/openapi.json`](./openapi.json)
- **Total Endpoints:** 30 operations across 21 paths

| Path | Method | Tag | Path Params | Status Codes | Summary | Source |
| --- | --- | --- | --- | --- | --- | --- |
| `/api/account` | `GET` | `account` | - | 200, 401, 500, 503 | GET /api/account | `src/app/api/account/route.ts` |
| `/api/account` | `DELETE` | `account` | - | 200, 401, 503 | DELETE /api/account | `src/app/api/account/route.ts` |
| `/api/expenses/export` | `GET` | `expenses` | - | 200, 400, 401, 503 | Export cycle- and group-scoped ledger transactions in RFC-4180 CSV or JSON. | `src/app/api/expenses/export/route.ts` |
| `/api/fx` | `GET` | `fx` | - | 200, 400 | GET /api/fx | `src/app/api/fx/route.ts` |
| `/api/groups` | `POST` | `groups` | - | 201, 400, 401, 503 | POST /api/groups | `src/app/api/groups/route.ts` |
| `/api/groups/join` | `POST` | `groups` | - | 200, 400, 401, 503 | POST /api/groups/join | `src/app/api/groups/join/route.ts` |
| `/api/groups/{groupId}/audit-log` | `GET` | `groups` | `groupId` | 200, 400, 401, 503 | GET /api/groups/{groupId}/audit-log | `src/app/api/groups/[groupId]/audit-log/route.ts` |
| `/api/groups/{groupId}/billing-cycles/close` | `POST` | `groups` | `groupId` | 200, 400, 401, 503 | POST /api/groups/{groupId}/billing-cycles/close | `src/app/api/groups/[groupId]/billing-cycles/close/route.ts` |
| `/api/groups/{groupId}/expenses` | `GET` | `groups` | `groupId` | 200, 400, 401, 403, 500, 503 | GET /api/groups/{groupId}/expenses | `src/app/api/groups/[groupId]/expenses/route.ts` |
| `/api/groups/{groupId}/expenses` | `POST` | `groups` | `groupId` | 201, 400, 401, 503 | POST /api/groups/{groupId}/expenses | `src/app/api/groups/[groupId]/expenses/route.ts` |
| `/api/groups/{groupId}/expenses/{expenseId}` | `PATCH` | `groups` | `groupId`, `expenseId` | 200, 400, 401, 503 | PATCH /api/groups/{groupId}/expenses/{expenseId} | `src/app/api/groups/[groupId]/expenses/[expenseId]/route.ts` |
| `/api/groups/{groupId}/expenses/{expenseId}` | `DELETE` | `groups` | `groupId`, `expenseId` | 200, 400, 401, 503 | DELETE /api/groups/{groupId}/expenses/{expenseId} | `src/app/api/groups/[groupId]/expenses/[expenseId]/route.ts` |
| `/api/groups/{groupId}/invite/regenerate` | `POST` | `groups` | `groupId` | 200, 400, 401, 503 | POST /api/groups/{groupId}/invite/regenerate | `src/app/api/groups/[groupId]/invite/regenerate/route.ts` |
| `/api/groups/{groupId}/leave` | `POST` | `groups` | `groupId` | 200, 400, 401, 503 | POST /api/groups/{groupId}/leave | `src/app/api/groups/[groupId]/leave/route.ts` |
| `/api/groups/{groupId}/members/{userId}` | `DELETE` | `groups` | `groupId`, `userId` | 200, 400, 401, 503 | DELETE /api/groups/{groupId}/members/{userId} | `src/app/api/groups/[groupId]/members/[userId]/route.ts` |
| `/api/groups/{groupId}/ratios` | `PATCH` | `groups` | `groupId` | 200, 400, 401, 503 | PATCH /api/groups/{groupId}/ratios | `src/app/api/groups/[groupId]/ratios/route.ts` |
| `/api/groups/{groupId}/reminders` | `GET` | `groups` | `groupId` | 200, 400, 401, 403, 503 | List active 24h settlement reminder cooldowns for the authenticated creditor in a group. | `src/app/api/groups/[groupId]/reminders/route.ts` |
| `/api/groups/{groupId}/reminders` | `POST` | `groups` | `groupId` | 201, 400, 401, 429, 503 | Dispatch settlement reminder(s) for a group with 24h cooldown and SMS opt-in gating. | `src/app/api/groups/[groupId]/reminders/route.ts` |
| `/api/groups/{groupId}/settlements` | `GET` | `groups` | `groupId` | 200, 400, 401, 403, 500, 503 | GET /api/groups/{groupId}/settlements | `src/app/api/groups/[groupId]/settlements/route.ts` |
| `/api/groups/{groupId}/settlements` | `POST` | `groups` | `groupId` | 201, 400, 401, 503 | POST /api/groups/{groupId}/settlements | `src/app/api/groups/[groupId]/settlements/route.ts` |
| `/api/notifications` | `GET` | `notifications` | - | 200, 401, 500, 503 | GET /api/notifications | `src/app/api/notifications/route.ts` |
| `/api/notifications` | `PATCH` | `notifications` | - | 200, 401, 500, 503 | PATCH /api/notifications | `src/app/api/notifications/route.ts` |
| `/api/receipts` | `GET` | `receipts` | - | 200, 307, 400, 401, 403, 404, 503 | GET /api/receipts | `src/app/api/receipts/route.ts` |
| `/api/receipts` | `POST` | `receipts` | - | 201, 400, 401, 503 | POST /api/receipts | `src/app/api/receipts/route.ts` |
| `/api/reminders` | `GET` | `reminders` | - | 200, 401, 503 | List all active 24h settlement reminder cooldowns for the authenticated creditor across groups. | `src/app/api/reminders/route.ts` |
| `/api/reminders` | `POST` | `reminders` | - | 201, 400, 401, 429, 503 | Send one or a cross-group batch of settlement reminders with strict 24h cooldown and SMS opt-in gating. | `src/app/api/reminders/route.ts` |
| `/api/search` | `GET` | `search` | - | 200, 401, 500, 503 | GET /api/search | `src/app/api/search/route.ts` |
| `/api/settings` | `GET` | `settings` | - | 200, 401, 500, 503 | GET /api/settings | `src/app/api/settings/route.ts` |
| `/api/settings` | `PATCH` | `settings` | - | 200, 400, 401, 503 | PATCH /api/settings | `src/app/api/settings/route.ts` |
| `/api/settings/export` | `GET` | `settings` | - | 200, 400, 401, 500, 503 | Export full ledger history across all user groups in RFC-4180 CSV or JSON. | `src/app/api/settings/export/route.ts` |
