# Flow schemes — full probe catalog

Run in order: a failure in an earlier scheme usually invalidates the later ones. Each case starts
from its user story (`Como <rol> en <entorno>, quiero <funcionalidad> para <resultado>`).

## 1. Happy Path — does it work as designed?

- Cover the primary success path end-to-end **plus every documented alternate success path**: each
  role/tenant that should succeed, each valid variant, empty→first-item, pagination, and the designed
  edit / cancel / renew / transition actions.
- How: `curl` the endpoint sequence with valid payloads and a token that HAS the permission; drive the
  real UI journey with Playwright MCP (navigate → snapshot → fill → submit → assert the rendered result).
- Pass: correct 2xx + response shape / state transition; the UI shows the designed outcome; every
  designed side-effect fires (event → journal entry, log row, notification).

## 2. Sad Path — what happens when a confused user gets it wrong by accident?

- **Out-of-order:** submit before filling, pay before selecting, renew a draft, double-click submit,
  back-button then resubmit, refresh mid-flow.
- **Boundary/format a real user might type:** empty, whitespace-only, huge text, wrong date format,
  `0` / negative quantity, decimals where integers are expected, wrong currency, pasted emoji.
- **Abandon / resume:** open a modal and close it, navigate away mid-flow, session expires mid-flow,
  stale form (entity changed in another tab).
- **Wrong-but-owned data:** valid id of the wrong type, inactive / soft-deleted row.
- Pass: fails safely — correct 4xx + human-readable, actionable message (`vendix-error-handling`), no
  crash, no half-written state, **never a success toast on a failed write**, the user always has a way out.

## 3. Brute-Force — does it resist intentional abuse?

Authorized, defensive QA only: local/dev with seed data, never production. Never crack real
credentials. Prove rejection with a single attempt; report a hole instead of exploiting it further.

Security probes (expect `401/403/400/422`, never `200 + data`):
- **AuthZ / IDOR:** no token, expired token, role without the permission; another tenant's resource id
  (cross-store / cross-org). See `vendix-multi-tenant-context`, `vendix-prisma-scopes`.
  A `200` with `super_admin` proves nothing (guard bypass): prove `403` for the role without the
  permission and `200` for the role with it.
- **Mass-assignment:** extra/forbidden fields (`status`, `store_id`, `id`, `price`, `role`) →
  `forbidNonWhitelisted` must return 400 (`vendix-validation`).
- **Injection:** SQL / HTML / template payloads in text fields and query params — parameterized /
  escaped, never reflected or executed.
- **Rate / quota:** exceed a metered endpoint's cap; Redis quota must block, not pass or double-count
  on retry (`vendix-redis-quota`).

Data-integrity probes (expect a guarded rejection, never corruption):
- Negative / overflow amounts, stock below zero, duplicate unique keys, concurrent double-submit,
  replaying an idempotent op / webhook twice.
- Illegal transitions: cancel a cancelled order, renew a cancelled membership, close a closed period.
- Money / accounting invariants: unbalanced entry, payment > order total, refund > paid
  (`vendix-accounting-rules`, `vendix-auto-entries`).

How: scripted `curl` loops for authz / injection / rate / state; Playwright MCP for UI abuse (tamper a
disabled control, resubmit, force a hidden action).
Pass: every attempt rejected with the correct status + safe error, datastore unchanged (verify with a
follow-up read), no cross-tenant leak. **Any attempt that succeeds is a blocking bug.**
