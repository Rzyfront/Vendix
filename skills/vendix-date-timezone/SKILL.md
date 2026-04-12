---
name: vendix-date-timezone
description: >
  Date and timezone handling patterns: UTC-safe display, date-only vs timestamp fields, shared utilities, form inputs, chart labels, print services, and anti-patterns that cause off-by-one day bugs.
  Trigger: When displaying dates, formatting date labels, working with date inputs, querying by date ranges, or handling any Date object in frontend or backend.
license: MIT
metadata:
  author: rzyfront
  version: "1.0"
  scope: [root]
  auto_invoke:
    - "Displaying or formatting dates in frontend"
    - "Creating date inputs in forms"
    - "Working with toLocaleDateString or DatePipe"
    - "Formatting chart axis labels with dates"
    - "Querying by date ranges in backend"
    - "Parsing date strings from query parameters"
    - "Working with date.util.ts utilities"
    - "Printing documents with date fields"
    - "Adding new DateTime fields to Prisma schema"
    - "Fixing date display off-by-one bugs"
---

## When to Use

- Displaying dates from the backend in tables, cards, charts, or print views
- Creating `<input type="date">` form fields
- Writing `toLocaleDateString()` or Angular `DatePipe` calls
- Building date range queries (analytics, reports, filters)
- Adding new `DateTime` fields to `schema.prisma`
- Formatting chart axis labels (ECharts, etc.)
- Debugging dates that show "yesterday" instead of "today"

## The Core Problem

JavaScript's `new Date("2026-04-12")` (date-only string) creates **UTC midnight** (`2026-04-12T00:00:00Z`). When displayed with `toLocaleDateString()` without `timeZone: 'UTC'`, browsers in **negative UTC offsets** (like Colombia UTC-5) shift the date **one day back**:

```
new Date("2026-04-12")                          → 2026-04-12T00:00:00Z
  .toLocaleDateString('es-CO')                   → "11/4/2026" ← WRONG (shifted to Apr 11)
  .toLocaleDateString('es-CO', {timeZone:'UTC'}) → "12/4/2026" ← CORRECT
```

This affects **all date-only fields** from the backend (stored as midnight UTC in PostgreSQL).

## Critical Rules

### Rule 1: Date-Only vs Timestamp — Know the Difference

| Type | Examples | Stored As | Display Rule |
|------|----------|-----------|-------------|
| **Date-only** | `expense_date`, `order_date`, `valid_until`, `expiry_date`, `period` strings | Midnight UTC (`T00:00:00Z`) | **ALWAYS** use `timeZone: 'UTC'` |
| **Timestamp** | `created_at`, `updated_at`, `deleted_at` | Full UTC datetime | Local timezone OK if showing time; use `timeZone: 'UTC'` if showing date-only |

**When in doubt → use `timeZone: 'UTC'`**. It never produces wrong dates; omitting it can.

### Rule 2: NEVER Use `toLocaleDateString()` Without `timeZone: 'UTC'` on Backend Dates

```typescript
// ✗ WRONG — shifts one day back in UTC-5
new Date(record.expense_date).toLocaleDateString('es-CO')

// ✓ CORRECT — always shows correct date
new Date(record.expense_date).toLocaleDateString('es-CO', { timeZone: 'UTC' })
```

### Rule 3: ALWAYS Use Shared Utilities

| Function | Location | Purpose |
|----------|----------|---------|
| `formatDateOnlyUTC(value)` | `shared/utils/date.util.ts` | Display date-only fields: `"12/4/2026"` |
| `formatChartPeriod(period, granularity)` | `shared/utils/date.util.ts` | Chart axis labels: `"12 abr"` |
| `toLocalDateString(date)` | `shared/utils/date.util.ts` | Form defaults (today's date): `"2026-04-12"` |
| `toUTCDateString(date)` | `shared/utils/date.util.ts` | Convert backend Date to input value |
| `getDefaultStartDate()` | `shared/utils/date.util.ts` | First day of current month |
| `getDefaultEndDate()` | `shared/utils/date.util.ts` | Today's date |

### Rule 4: NEVER Create Private `formatPeriodLabel` / `formatDate` in Components

Use the shared utilities. Don't duplicate date formatting logic — this is how the off-by-one bug spread to 7+ files.

### Rule 5: Use `'es-CO'` Locale, Not `'es-ES'`

Colombia stores must use `'es-CO'`. Never hardcode `'es-ES'` or `'en-US'`.

## Frontend Patterns

### Displaying Dates in Tables/Lists

```typescript
// ✓ CORRECT — use formatDateOnlyUTC for date-only fields
import { formatDateOnlyUTC } from 'path/to/shared/utils/date.util';

columns = [
  {
    key: 'expense_date',
    label: 'Fecha',
    transform: (val: string) => formatDateOnlyUTC(val),
  },
];
```

### Displaying Dates in Chart Labels

```typescript
// ✓ CORRECT — use formatChartPeriod
import { formatChartPeriod } from 'path/to/shared/utils/date.util';

const labels = trends.map((t) => formatChartPeriod(t.period, granularity));
```

### Date Input Fields in Forms

```typescript
// ✓ CORRECT — toLocalDateString for "today" default
import { toLocalDateString } from 'path/to/shared/utils/date.util';

// Setting default value
this.expenseDate.set(toLocalDateString()); // "2026-04-12" in local timezone
```

```html
<!-- ✓ CORRECT — input[type=date] works with YYYY-MM-DD strings -->
<input type="date" [ngModel]="expenseDate()" (ngModelChange)="onDateChange($event)" />
```

### Populating Inputs from Backend Values

```typescript
// ✓ CORRECT — use toUTCDateString for existing backend dates
import { toUTCDateString } from 'path/to/shared/utils/date.util';

const inputValue = toUTCDateString(new Date(record.expense_date)); // "2026-04-12"
```

### Print Services

```typescript
// ✓ CORRECT — date-only fields with timeZone: 'UTC'
const date = new Date(order.order_date).toLocaleDateString('es-CO', {
  day: '2-digit', month: 'short', year: 'numeric',
  timeZone: 'UTC',
});

// ✓ OK — timestamps can use local timezone IF showing time
const datetime = new Date(order.created_at).toLocaleString('es-CO');
```

### Angular DatePipe in Templates

```html
<!-- ✗ AVOID for date-only fields — uses local timezone -->
{{ expense.expense_date | date:'dd/MM/yyyy' }}

<!-- ✓ PREFER component method with formatDateOnlyUTC -->
{{ formatDate(expense.expense_date) }}
```

## Backend Patterns

### Prisma Schema

```prisma
// Date-only fields — stored at midnight UTC
expense_date    DateTime  @db.Timestamp(6)
order_date      DateTime? @default(now()) @db.Timestamp(6)
valid_until     DateTime? @db.Timestamp(6)

// Timestamp fields — full UTC datetime
created_at      DateTime  @default(now()) @db.Timestamp(6)
updated_at      DateTime  @updatedAt @db.Timestamp(6)
```

### DTO Validation

```typescript
// Query parameters (YYYY-MM-DD strings)
@IsOptional()
@IsDateString()
date_from?: string;

// Request body (auto-transformed to Date)
@IsDate()
@Type(() => Date)
expense_date: Date;
```

### Parsing Date Ranges

```typescript
// ✓ CORRECT — use parseDateRange from analytics utils
import { parseDateRange } from '../utils/date.util';

const { startDate, endDate } = parseDateRange(query);

// endDate is set to 23:59:59.999 UTC for inclusive range
```

### Backend Date Math — ALWAYS Use UTC Methods

```typescript
// ✗ WRONG — getMonth(), getDate() use server local timezone
const today = new Date();
const month = today.getMonth();

// ✓ CORRECT — getUTCMonth(), getUTCDate() are timezone-safe
const today = new Date();
const month = today.getUTCMonth();
const utcToday = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
```

### Raw SQL Queries

```typescript
// ✓ CORRECT — DATE_TRUNC operates on UTC timestamps by default in PostgreSQL
const results = await prisma.$queryRaw`
  SELECT DATE_TRUNC('day', created_at) AS period, COUNT(*) AS total
  FROM orders
  WHERE created_at >= ${startDate} AND created_at <= ${endDate}
  GROUP BY DATE_TRUNC('day', created_at)
`;
```

## `new Date()` Constructor Gotchas

```typescript
// Date-only strings → parsed as UTC midnight (safe for backend dates)
new Date("2026-04-12")          // → 2026-04-12T00:00:00.000Z ✓

// Date + time WITHOUT "Z" → parsed as LOCAL timezone (DANGEROUS)
new Date("2026-04-12T00:00:00") // → depends on browser timezone ✗

// Date + time WITH "Z" → explicit UTC (safe)
new Date("2026-04-12T00:00:00Z") // → 2026-04-12T00:00:00.000Z ✓

// Date.UTC constructor → explicit UTC (safe for date math)
new Date(Date.UTC(2026, 3, 12))  // → 2026-04-12T00:00:00.000Z ✓
// Note: month is 0-indexed (3 = April)
```

## Anti-Patterns Checklist

| Anti-Pattern | Fix |
|-------------|-----|
| `new Date(field).toLocaleDateString()` without `timeZone` | Add `{ timeZone: 'UTC' }` or use `formatDateOnlyUTC()` |
| Private `formatPeriodLabel()` in components | Use shared `formatChartPeriod()` from `date.util.ts` |
| `{{ field \| date:'dd/MM/yyyy' }}` for date-only fields | Use component method with `formatDateOnlyUTC()` |
| `'es-ES'` locale for Colombia stores | Use `'es-CO'` |
| `getMonth()` / `getDate()` in backend date math | Use `getUTCMonth()` / `getUTCDate()` |
| `new Date("2026-04-12T00:00:00")` without `Z` suffix | Add `Z` or use `new Date("2026-04-12")` |

## Key Files

- **Frontend date utilities**: `apps/frontend/src/app/shared/utils/date.util.ts`
- **Backend analytics date utilities**: `apps/backend/src/domains/store/analytics/utils/date.util.ts`
- **Backend fill-time-series**: `apps/backend/src/domains/store/analytics/utils/fill-time-series.util.ts`
