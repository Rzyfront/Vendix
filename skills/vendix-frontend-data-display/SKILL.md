---
name: vendix-frontend-data-display
description: >
  Responsive data display patterns using TableComponent, ItemListComponent, and
  ResponsiveDataViewComponent. Trigger: When displaying lists of records, creating
  responsive admin tables, or configuring mobile card views.
license: Apache-2.0
metadata:
  author: rzyfront
  version: "2.3"
  scope: [root]
  auto_invoke: "Displaying data lists, implementing responsive tables, creating mobile card views"
---

# Vendix Frontend Data Display

Use for record lists (products, orders, customers, roles, plans, invoices), responsive tables + mobile cards, and `TableColumn` / `TableAction` / `ItemListCardConfig` config. Check the component READMEs in `apps/frontend/src/app/shared/components/{table,item-list,responsive-data-view}/` first.

Detail: `references/api.md` (inputs/outputs, column/action/card catalog, multi-selection; read on demand).

## Component choice

| Need | Component |
| --- | --- |
| Desktop table only | `TableComponent` (`app-table`) |
| Mobile cards only | `ItemListComponent` (`app-item-list`) |
| Both (default for admin lists) | `ResponsiveDataViewComponent` (`app-table` in `hidden md:block`, `app-item-list` in `block md:hidden`) |

## Mandatory — server-side pagination on every list

No list is loaded whole and rendered client-side.

1. Backend accepts `page`/`limit` and returns `ResponseService.paginated()` → `{ success, message, data, meta: { total, page, limit, totalPages, hasNextPage, hasPreviousPage } }`.
2. Frontend service types it as `PaginatedApiResponse<T>`.
3. Parent owns `filters = signal({ page, limit })` (reset `page` to 1 on any search/filter change), `totalItems` from `meta.total`, `totalPages = computed(...)`, `onPageChange(page)`.
4. `<app-pagination>` (`shared/components/pagination/`) right after the data view. It self-hides when `totalPages <= 1`; no `@if`.

Reference: `apps/frontend/src/app/private/modules/store/price-tiers/pages/price-tiers-list-page/price-tiers-list-page.component.ts`.

Exceptions only: embedded child rows of an already paginated parent (dispatch-note items, layaway installments), or reference data hard-limited by the backend (e.g. `getRecentAuditLog(orgId, 10)`). Any other exception → `// Pagination exception:` comment in the component and call it out in the PR.

## Rules

- `cardConfig` is required on `ResponsiveDataView`; `actions` are shared by table and cards (override mobile with `mobileActions`).
- Mobile cards render `mobileDirectActionsCount` (default 2) actions directly; the rest go into a `more-horizontal` dropdown.
- Use `priority` on columns to control mobile/tablet hiding.
- Money transforms via `vendix-currency-formatting`; dates via `vendix-date-timezone`; icons must be registered (`vendix-frontend-icons`).
- Row multi-selection: prefer the built-in `selectable` + `[(selectedIds)]` over a custom checkbox column.

## Related

`vendix-frontend-standard-module`, `vendix-frontend-icons`, `vendix-date-timezone`, `vendix-currency-formatting`, `vendix-bulk-operations`, `vendix-backend`.
