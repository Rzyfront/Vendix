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

- Use UTC methods (`getUTCMonth`, `getUTCDate`, etc.) for date math.
- Be explicit when converting query strings into inclusive ranges.
- Do not assume one centralized backend parser exists everywhere; inspect the domain utility currently in use.
- Store timestamps as UTC; treat date-only business fields as midnight UTC values for display purposes.

## Anti-Patterns

- `new Date(dateOnly).toLocaleDateString()` without timezone.
- Angular `DatePipe` for date-only values without UTC handling.
- Component-local date formatter duplication.
- `new Date('2026-04-12T00:00:00')` without `Z` when UTC was intended.

## Related Skills

- `vendix-angular-forms`
- `vendix-frontend-data-display`
- `vendix-prisma-schema`
