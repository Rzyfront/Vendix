# Analytics Hardcoded Headers Inventory

## Context

The analytics shell now uses `app-sticky-header` for category title, subtitle, icon, and route tabs. Individual analytics pages still contain repeated sticky filter/header bars with local title markup plus date/export controls. Many of those page files were already modified in the worktree before this refactor, so they should be migrated in a separate pass after reviewing their current diffs.

## Candidate Files

### Overview

- `apps/frontend/src/app/private/modules/store/analytics/pages/overview/overview-summary/overview-summary.component.html` — filter bar with title, date range, export.

### Sales

- `apps/frontend/src/app/private/modules/store/analytics/pages/sales/sales-summary/sales-summary.component.html` — filter bar with title, date range, export.
- `apps/frontend/src/app/private/modules/store/analytics/pages/sales/sales-trends.component.ts` — filter bar with title, date range, granularity selector, export.
- `apps/frontend/src/app/private/modules/store/analytics/pages/sales/sales-by-product.component.ts` — filter bar with title, date range, export.
- `apps/frontend/src/app/private/modules/store/analytics/pages/sales/sales-by-category.component.ts` — filter bar with title, date range, export.
- `apps/frontend/src/app/private/modules/store/analytics/pages/sales/sales-by-customer.component.ts` — filter bar with title, date range, export.
- `apps/frontend/src/app/private/modules/store/analytics/pages/sales/sales-by-payment.component.ts` — filter bar with title, date range, export.

### Inventory

- `apps/frontend/src/app/private/modules/store/analytics/pages/inventory/overview/inventory-overview.component.html` — filter bar with title, date range, export.
- `apps/frontend/src/app/private/modules/store/analytics/pages/inventory/low-stock.component.ts` — filter bar with title, date range, export.
- `apps/frontend/src/app/private/modules/store/analytics/pages/inventory/stock-movements.component.ts` — filter bar with title, date range, export.
- `apps/frontend/src/app/private/modules/store/analytics/pages/inventory/inventory-valuation.component.ts` — filter bar with title, date range, valuation controls, export.
- `apps/frontend/src/app/private/modules/store/analytics/pages/inventory/movement-analysis.component.ts` — filter bar with title, date range, export.

### Products

- `apps/frontend/src/app/private/modules/store/analytics/pages/products/product-performance.component.html` — filter bar with title, date range, export.
- `apps/frontend/src/app/private/modules/store/analytics/pages/products/top-sellers.component.html` — filter bar with title, date range, export.
- `apps/frontend/src/app/private/modules/store/analytics/pages/products/product-profitability.component.html` — filter bar with title, date range, export.

### Purchases

- `apps/frontend/src/app/private/modules/store/analytics/pages/purchases/purchase-summary.component.ts` — filter bar with title, date range, export.
- `apps/frontend/src/app/private/modules/store/analytics/pages/purchases/purchases-by-supplier.component.ts` — filter bar with title, date range, export.

### Customers

- `apps/frontend/src/app/private/modules/store/analytics/pages/customers/customer-summary.component.html` — filter bar with title, date range, export.
- `apps/frontend/src/app/private/modules/store/analytics/pages/customers/customer-acquisition.component.html` — filter bar with title, date range, export.
- `apps/frontend/src/app/private/modules/store/analytics/pages/customers/abandoned-carts.component.html` — filter bar with title, date range, export.

### Reviews

- `apps/frontend/src/app/private/modules/store/analytics/pages/reviews/review-summary.component.ts` — filter bar with title, date range, export.

### Financial

- `apps/frontend/src/app/private/modules/store/analytics/pages/financial/profit-loss.component.ts` — filter bar with title, date range, export.
- `apps/frontend/src/app/private/modules/store/analytics/pages/financial/tax-summary.component.ts` — filter bar with title, date range, export.
- `apps/frontend/src/app/private/modules/store/analytics/pages/financial/refunds-summary.component.ts` — filter bar with title, date range, export.

### Backward-Compatible Expenses Routes

- `apps/frontend/src/app/private/modules/store/analytics/pages/expenses/expense-summary.component.ts` — filter bar with title, date range, export.
- `apps/frontend/src/app/private/modules/store/analytics/pages/expenses/expenses-by-category.component.ts` — filter bar with title, date range, export.

## Next-Pass Guidance

- Review `git status --short -- apps/frontend/src/app/private/modules/store/analytics` before editing these files.
- Migrate page titles/icons/subtitles to `app-sticky-header` first.
- Keep date-range selectors, custom selectors, and export controls in a dedicated filter row until `app-sticky-header` intentionally supports projected toolbar content or typed custom controls.
- Preserve the analytics registry as the source of route-tab labels and icons.
