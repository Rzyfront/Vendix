# Store Timezone — Single Source of Truth (analytics day-boundary)

> **Rule:** the "business day/month" of any analytics/report is computed in the
> **store's timezone**, never in UTC. Enforced by `npm run tz:audit` (CI).

## The bug (QUI-487)

Every analytics timestamp column (`orders.created_at`, `expenses.expense_date`,
`carts.created_at`, `product_reviews.created_at`, `inventory_*.created_at`,
`purchase_orders.created_at`, `cash_register_sessions.opened_at`, …) is declared
`@db.Timestamp(6)` — `timestamp without time zone`. Prisma normalizes **every**
`DateTime` to UTC on write/read, so each column physically holds the **UTC
wall-clock**.

A bare bucket therefore truncates in UTC:

```sql
DATE_TRUNC('day', o.created_at)          -- UTC day
EXTRACT(MONTH FROM o.created_at)         -- UTC month
```

For a store in `America/Bogota` (UTC-5), a sale at **23:40 local** is stored as
**04:40Z the next day**, so it is reported one calendar day (and, at month
edges, one month) later. The same shift affects range-based summaries when the
`[from, to]` boundaries are built from the server clock instead of the store's
local calendar.

## The fix — one primitive

`apps/backend/src/common/utils/store-timezone.util.ts` is the **single source of
truth**. It is a pure, dependency-free utility (no luxon/date-fns; all wall-clock
↔ UTC conversion is derived from `Intl.DateTimeFormat`, so it is correct for any
IANA timezone including DST zones). No service resolves a timezone or builds a
range on its own.

### API

| Function | Purpose |
|---|---|
| `resolveStoreTimezone(prisma, storeId)` | Store tz from `store_settings.settings.general.timezone`; fallback `America/Bogota`. |
| `resolveOrganizationTimezone(unscopedPrisma, orgId)` | Cross-store dashboards: tz of the org's first active store. Call with `withoutScope()`. |
| `assertSafeTimezone(tz)` | Charset guard (`/^[A-Za-z0-9_/+-]+$/`) before the tz is inlined into raw SQL; else default. |
| `localBucketSql(col, tz)` | `(col AT TIME ZONE 'UTC' AT TIME ZONE tz)` — the column rendered as store-local wall-clock. |
| `localPeriodSql(col, tz, granularity)` | `to_char(DATE_TRUNC(unit, <localBucket>), fmt)` as **TEXT** — the authoritative period label. |
| `localPeriodKey(date, granularity, tz)` | The JS label for one instant — byte-identical to `localPeriodSql`. |
| `enumerateLocalPeriodKeys(start, end, granularity, tz)` | Every local label in a range (zero-fill). |
| `resolveLocalDateRange(query, tz)` | `{ startDate, endDate }` as UTC instants of the LOCAL day/month; presets vs local clock. |
| `zonedWallClockToUtc(y,mo,d,h,mi,s,ms, tz)` | UTC instant of a local wall-clock (DST-safe). |
| `localCivil(date, tz)` | Local civil parts of a UTC instant. |

### The three coupled layers

1. **SQL bucketing (charts/trends):** wrap the column in `localBucketSql` before
   `DATE_TRUNC`/`EXTRACT`, or use `localPeriodSql` directly and `GROUP BY 1
   ORDER BY 1 ASC`.
2. **Range boundaries (summary/KPI/table/export/growth):** Prisma `aggregate`/
   `groupBy`/`count` cannot apply `AT TIME ZONE` in `where`, so they need UTC
   instants. `parseDateRange(query, tz)` delegates to `resolveLocalDateRange`,
   which computes the local day/month boundaries and returns their UTC instants.
3. **Zero-fill:** `fillTimeSeries(..., tz)` walks the local calendar via
   `enumerateLocalPeriodKeys`, producing labels byte-identical to the SQL — no
   off-by-one buckets at the range edges.

### Why the DOUBLE `AT TIME ZONE`

The columns are `timestamp without time zone` holding a UTC wall-clock:

- `col AT TIME ZONE 'UTC'` reinterprets the naive value as UTC → `timestamptz`.
- `… AT TIME ZONE tz` renders that instant as the store's local wall-clock.

A **single** `col AT TIME ZONE tz` is correct **only** for a genuine
`timestamptz` column. Applying the wrong idiom to the wrong column type corrupts
silently. (Verified: no analytics bucket column is `timestamptz`; every
`Timestamptz(6)` in the schema belongs to infra/domain/notification/subscription
tables.)

### Why the label is TEXT

`localPeriodSql` emits the period label via `to_char(...)`. If it returned a
`timestamp` instead, the `pg` driver would reparse that naive value into a
tz-ambiguous JS `Date`, reintroducing the bug at the driver boundary. Emitting
TEXT means JS never re-derives the bucket.

## Scope — platform vs store

- **Store analytics/reports** (`domains/store/analytics/**`, `menus/menu-engineering`,
  and the per-org dashboard `organizations.getOrganizationStats`): **store/org
  timezone**, via the primitive.
- **Superadmin cross-store dashboard** (`superadmin/dashboard/dashboard.service.ts`):
  **intentionally UTC**. It aggregates across stores that may live in different
  timezones, so no single store tz is meaningful; UTC is the neutral reference.
  This is a deliberate policy, not a bug. Changing it (e.g. to a platform tz)
  requires an explicit product decision.
- **Weekly report window** (`weekly-report/utils/week-window.ts`): **intentionally
  Colombia-fixed** (UTC-5, no DST) because the business rule is defined as
  "Sunday 07:00 Colombia". Documented exception.

## Enforcement — `tz:audit`

`scripts/tz-audit.sh` (`npm run tz:audit`; CI job **TZ Audit**, gated on
`apps/backend/**`) is a grep guard mirroring `zoneless:audit`. It fails the build
when a module reintroduces the bug:

1. `DATE_TRUNC(` literal outside the primitive.
2. `EXTRACT(<unit> FROM table.column)` on a bare column (no `AT TIME ZONE`).
3. `setUTCHours` / `Date.UTC` inside an analytics `*.service.ts`.

Ignored: comments, `*.spec.ts` (they describe the pattern in test strings), and
lines carrying an inline `tz-audit:ignore` marker. The marker is the documented
escape hatch for a **pre-localized business date** — e.g.
`accounting_entries.entry_date`, which auto-entries stamp in the store timezone
and manual entries set from a `YYYY-MM-DD` string. Such a date must **not** pass
through `AT TIME ZONE` (that would double-convert it).

## Adding a new analytics query — checklist

1. Resolve the tz once: `const tz = await resolveStoreTimezone(this.prisma, storeId)`.
2. Trends: `SELECT ${localPeriodSql('t.created_at', tz, g)} AS period … GROUP BY 1 ORDER BY 1 ASC`; type the row as `{ period: string; … }`; do **not** reformat `period` in JS.
3. Zero-fill: `fillTimeSeries(rows, startDate, endDate, g, zero, formatPeriodFromDate, tz)`.
4. Ranges: `const { startDate, endDate } = parseDateRange(query, tz)`.
5. Bare `EXTRACT`/`DATE_TRUNC` on a raw column → wrap in `localBucketSql`.
6. `npm run tz:audit` must stay green.
