---
name: vendix-date-timezone
description: >
  Date and timezone handling patterns: UTC-safe date-only display, form date strings,
  chart labels, date range queries, print formatting, and off-by-one day prevention.
  Trigger: When displaying dates, formatting date labels, using DatePipe/toLocaleDateString,
  querying date ranges, or adding DateTime fields.
license: MIT
metadata:
  author: rzyfront
  version: "2.0"
  scope: [root]
  auto_invoke:
    - "Displaying or formatting dates in frontend"
    - "Fixing date display off-by-one bugs"
    - "Creating date inputs in forms"
    - "Querying by date ranges in backend"
    - "Adding new DateTime fields to Prisma schema"
    - "Working with date.util.ts utilities"
    - "Working with toLocaleDateString or DatePipe"
    - "Formatting chart axis labels with dates"
    - "Printing documents with date fields"
    - "Parsing date strings from query parameters"
---

# Vendix Date And Timezone

## Core Problem

`new Date('2026-04-12')` is UTC midnight. In Colombia (UTC-5), local date formatting can show the previous day. Date-only backend values must be displayed in UTC.

## Frontend Source of Truth

`apps/frontend/src/app/shared/utils/date.util.ts` exposes:

- `formatDateOnlyUTC(value)`
- `toLocalDateString(date?)`
- `toUTCDateString(date)`
- `getDefaultStartDate()`
- `getDefaultEndDate()`
- `formatChartPeriod(period, granularity)`

Use these utilities for new code. Some legacy modules still use `DatePipe` or raw `toLocaleDateString()`; do not copy those patterns for date-only fields.

## Rules

- Date-only fields: display with `timeZone: 'UTC'` or `formatDateOnlyUTC()`.
- Timestamp fields: local timezone is acceptable when showing time.
- Form date inputs should use `YYYY-MM-DD` strings.
- Use `toLocalDateString()` for local today defaults.
- Use `toUTCDateString()` when converting backend date-only values to input strings.
- Use `formatChartPeriod()` for chart labels instead of private component formatters.
- Prefer `es-CO` for Colombian-facing display, but keep existing utility behavior unless changing it intentionally; `formatChartPeriod()` currently uses locale `es`.

## Backend Rules

- Use UTC methods (`getUTCMonth`, `getUTCDate`, etc.) for date-only field math.
- Be explicit when converting query strings into inclusive ranges.
- Do not assume one centralized backend parser exists everywhere; inspect the domain utility currently in use.
- Store timestamps as UTC; treat date-only business fields as midnight UTC values for display purposes.
- **Analytics / reports are the exception: the business day/month is computed in the STORE timezone, never UTC.** See the section below — never hand-roll UTC bucketing there.

## Backend Analytics Day-Boundary (Store Timezone) — QUI-487

**The "business day/month" is ALWAYS computed in the store's timezone, never in UTC.** Prisma normalizes every `DateTime` to UTC even on `@db.Timestamp` (naive) columns, so each analytics timestamp physically holds the UTC wall-clock. A bare `DATE_TRUNC('day', created_at)` or `EXTRACT(MONTH FROM created_at)` therefore buckets in UTC — a 23:00 `America/Bogota` sale (04:00Z next day) lands in the wrong day/month.

**Single source of truth:** `apps/backend/src/common/utils/store-timezone.util.ts`. Never resolve a timezone or build a date range privately — always go through it.

| Concern | Use | Notes |
|---|---|---|
| Resolve a store's tz | `resolveStoreTimezone(prisma, storeId)` | reads `store_settings.settings.general.timezone`, falls back `America/Bogota` |
| Resolve an org's tz (cross-store dashboard) | `resolveOrganizationTimezone(unscopedPrisma, orgId)` | first active store's tz |
| SQL period label (charts/trends) | `localPeriodSql(col, tz, granularity)` | emits `to_char(DATE_TRUNC(unit, col AT TIME ZONE 'UTC' AT TIME ZONE tz), fmt)` as TEXT; `SELECT ... AS period`, `GROUP BY 1 ORDER BY 1 ASC` |
| SQL local wall-clock of a column | `localBucketSql(col, tz)` | `(col AT TIME ZONE 'UTC' AT TIME ZONE tz)`; wrap the column before `EXTRACT`/`DATE_TRUNC` |
| Range boundaries (summary/KPI/table/export/growth) | `parseDateRange(query, tz)` → delegates to `resolveLocalDateRange` | returns UTC instants of the LOCAL day/month; presets computed against the local clock |
| Zero-fill labels | `fillTimeSeries(..., tz)` / `enumerateLocalPeriodKeys` | byte-identical to the SQL labels (no off-by-one at the edges) |

**Why the DOUBLE `AT TIME ZONE`:** analytics columns are `timestamp without time zone` holding a UTC wall-clock, so `col AT TIME ZONE 'UTC'` reinterprets naive-as-UTC (→ `timestamptz`), then `AT TIME ZONE tz` renders the store's local clock. A single `col AT TIME ZONE tz` is correct ONLY for a genuine `timestamptz` column — applying the wrong idiom corrupts silently.

**Emit the period label as TEXT in SQL** (`to_char`), never re-derive it in JS from a returned `timestamp` — the `pg` driver reparses a naive timestamp tz-ambiguously.

**Enforcement:** `npm run tz:audit` (CI job "TZ Audit", gated on `apps/backend/**`) fails the build on raw `DATE_TRUNC`, bare `EXTRACT(unit FROM table.col)`, or `setUTCHours`/`Date.UTC` in analytics services. A pre-localized business date (e.g. `accounting_entries.entry_date`) is exempted with an inline `-- tz-audit:ignore` marker.

**Scope — platform vs store.** The superadmin cross-store dashboard (`superadmin/dashboard/dashboard.service.ts`) is intentionally UTC: it aggregates across stores in different timezones, so no single store tz applies. `weekly-report/utils/week-window.ts` is intentionally Colombia-fixed (UTC-5, no DST). Both are documented exceptions, not bugs.

See `docs/architecture/store-timezone.md` for the full design and rationale.

## Anti-Patterns

- `new Date(dateOnly).toLocaleDateString()` without timezone.
- Angular `DatePipe` for date-only values without UTC handling.
- Component-local date formatter duplication.
- `new Date('2026-04-12T00:00:00')` without `Z` when UTC was intended.

## Related Skills

- `vendix-angular-forms`
- `vendix-frontend-data-display`
- `vendix-prisma-schema`
