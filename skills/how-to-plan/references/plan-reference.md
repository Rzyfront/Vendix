# how-to-plan — reference tables

Read on demand while drafting a feature doc.

## Acceptable vs rejected fields

| Field | Acceptable | Rejected |
|-------|------------|----------|
| Context | "ORG_ADMIN cannot supervise fiscal data; reports hit store endpoints → 403." | "Fix fiscal stuff." |
| Objective | "ORG_ADMIN reads invoices across stores respecting `fiscal_scope`." | "Improve org panel." |
| Business decision | "Org panel is read-only for invoicing; no DIAN submission because `fiscal_scope` may target the store NIT." | "It must work well." |
| Critical files | `apps/backend/src/domains/organization/invoicing/invoicing.controller.ts` | `organization/invoicing/*` |
| Reusable assets | `apps/backend/src/common/services/fiscal-scope.service.ts` — resolves fiscal entity | "Some services can be reused." |
| Task Skills | `vendix-fiscal-scope, vendix-backend, vendix-prisma-scopes, vendix-permissions` | `how-to-plan` (planner skill, never a task skill) |
| Task Verify | `curl -H "Authorization: Bearer $ORG_TOKEN" https://api.vendix.com/api/organization/invoicing/invoices` → 200, `data[]` non-empty; store token → 403 | "Test it." |

## Skill selection matrix

If a task touches the left column, the right column must be in its `Skills`.

| Task touches… | Skills |
|---------------|--------|
| Multi-tenant data (org / store scope) | `vendix-multi-tenant-context`, `vendix-prisma-scopes` |
| Authorization, roles, RBAC | `vendix-permissions`, `vendix-backend-auth` |
| Org vs Store behavior | `vendix-operating-scope` |
| Fiscal entity / DIAN / NIT | `vendix-fiscal-scope` |
| API endpoint / DTO | `vendix-backend`, `vendix-validation` |
| Frontend module / form / component | `vendix-frontend`, `vendix-zoneless-signals`, `vendix-angular-forms` |
| Mobile (`apps/mobile`) | `mobile-dev` |
| Money / pricing display | `vendix-currency-formatting`, `vendix-product-pricing` |
| Schema / migrations | `vendix-prisma`, `vendix-prisma-migrations` |
| Seeds | `vendix-prisma-seed` |
| Auto journal entries | `vendix-auto-entries`, `vendix-accounting-rules` |
| Inventory stock | `vendix-inventory-stock`, `vendix-inventory-valuation` |
| Subscription gating (writes or AI only, not read-only) | `vendix-subscription-gate` |
| AI features | `vendix-ai-engine`, `vendix-ai-agent-tools`, `vendix-ai-platform-core` |
| Notifications | `vendix-notifications-system` |
| Dates / timezones | `vendix-date-timezone` |
| File uploads / S3 | `vendix-s3-storage` |

If the matrix is silent on a domain the task touches, list it under **Knowledge gaps**.

## Verification catalog

Pick exact invocations; never generic phrases.

| Mechanism | When | Example |
|-----------|------|---------|
| `curl` (primary API check) | API contract, auth boundary | `curl -sk -H "Authorization: Bearer $TOK" https://api.vendix.com/api/store/orders` |
| Playwright MCP | User-facing frontend flow on the real vhost (`https://vendix.com`, never `localhost:4200`) | `browser_navigate` → `browser_snapshot` (see `how-to-test`) |
| Backend spec (scoped) | Service logic | `npm run buildcheck:test -- src/domains/x/x.service.spec.ts` or `npm run test:path -w apps/backend -- src/domains/x` — one path per call, never the full suite (see `buildcheck-dev`) |
| Frontend health | Template/type errors at runtime | `bash scripts/buildcheck.sh --watch` → last cycle OK. No local build: CI builds |
| Backend health | Runtime errors | `docker logs --tail 40 vendix_backend` |
| Migration | Schema change | `npx prisma migrate status` + targeted `SELECT` |
| Permission | RBAC change | token lacking the permission → 403 |
| Log inspection | Async flow / queue | `docker logs --tail 200 vendix_backend \| grep <correlation_id>` |

Dev credentials: seed owner accounts (`owner@techsolutions.co` / `owner@fashionretail.com`, password
`1125634q`, see `apps/backend/prisma/seeds/users.seed.ts`) or ask the user. Agents never run Bruno
(`.bru`) tests as verification; `vendix-bruno-test` is opt-in for humans.
