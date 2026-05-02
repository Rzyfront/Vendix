---
name: vendix-frontend-standard-module
description: >
  Standard mobile-first admin list module layout for Vendix: stats, sticky search/header,
  Card wrapper, and ResponsiveDataView. Trigger: When creating or refactoring STORE_ADMIN,
  SUPER_ADMIN, or other private admin list modules.
license: Apache-2.0
metadata:
  author: rzyfront
  version: "2.1"
  scope: [root]
  auto_invoke: "Creating or refactoring standard admin modules (stats + table)"
---

## When to Use

- Creating or refactoring CRUD/list modules such as products, orders, customers, roles, plans, or subscriptions.
- Standardizing a private admin page around stats, search/filter controls, and `ResponsiveDataViewComponent`.
- Deciding whether a page should use the standard list pattern or the form/detail `app-sticky-header` pattern.

## Current References

- `apps/frontend/src/app/private/modules/store/products/products.component.ts`
- `apps/frontend/src/app/private/modules/store/products/components/product-list/product-list.component.html`
- `apps/frontend/src/app/private/modules/store/orders/components/orders-list/orders-list.component.html`
- `apps/frontend/src/app/private/modules/store/settings/roles/store-roles-settings.component.ts`
- `apps/frontend/src/app/private/modules/store/settings/roles/components/store-roles-list.component.ts`

Products is a strong reference for list layout and product cards, but it is not a perfect forms or signals reference. For forms, prefer settings/general and typed subscription pages.

## Standard Layout

The parent page owns stats and module-level state. The child list component owns search/filter UI and the data view.

```html
<div class="w-full">
  <div class="stats-container sticky top-0 z-20 bg-background md:static md:bg-transparent">
    <app-stats
      title="Products"
      [value]="stats().total"
      smallText="Products in catalog"
      iconName="package"
      iconBgColor="bg-blue-100"
      iconColor="text-blue-500"
    />
  </div>

  <app-product-list
    [items]="products()"
    [loading]="loading()"
    (edit)="onEdit($event)"
    (delete)="onDelete($event)"
  />
</div>
```

## Sticky Stack

| Layer | Element | Common Classes |
| --- | --- | --- |
| 1 | Stats | `stats-container sticky top-0 z-20 bg-background md:static md:bg-transparent` |
| 2 | Search/filter | `sticky top-[99px] z-10 bg-background ... md:static md:bg-transparent` |
| 3 | Data | `px-2 pb-2 pt-3 md:p-4` inside the card |

`top-[99px]` is common in current standard list modules with sticky stats. It is not universal; adjust only if the actual stats/header height changes.

## List Component Pattern

```html
<app-card [responsive]="true" [padding]="false">
  <div
    class="sticky top-[99px] z-10 bg-background px-2 py-1.5 -mt-[5px]
           md:mt-0 md:static md:bg-transparent md:px-6 md:py-4 md:border-b md:border-border"
  >
    <div class="flex flex-col gap-2 md:flex-row md:justify-between md:items-center md:gap-4">
      <h2 class="text-[13px] font-bold text-gray-600 tracking-wide md:text-lg md:font-semibold md:text-text-primary">
        Products ({{ items().length }})
      </h2>

      <div class="flex items-center gap-2 w-full md:w-auto">
        <app-inputsearch
          class="flex-1 md:w-64 shadow-[0_2px_8px_rgba(0,0,0,0.07)] md:shadow-none rounded-[10px]"
          placeholder="Search..."
          (searchChange)="onSearch($event)"
        />
      </div>
    </div>
  </div>

  <div class="px-2 pb-2 pt-3 md:p-4">
    <app-responsive-data-view
      [data]="filteredItems()"
      [columns]="columns"
      [actions]="actions"
      [cardConfig]="cardConfig"
      [loading]="loading()"
      [sortable]="true"
    />
  </div>
</app-card>
```

## Rules

- Keep the page root unpadded: use `<div class="w-full">`; parent layouts already provide spacing.
- Use `app-card [responsive]="true" [padding]="false"` around list content when matching current store modules.
- Use `ResponsiveDataViewComponent` for mixed desktop/mobile data lists.
- Use `input()`, `output()`, `signal()`, `computed()`, and `inject()` for new Angular code.
- Keep stats to four cards for the standard row unless the product/design requirement says otherwise.
- Use `smallText` on stats where meaningful; it is recommended and common, but `StatsComponent` does not require it in code.
- Do not copy old super-admin roles as the standard pattern; it is a legacy/non-standard layout.

## When to Use `app-sticky-header` Instead

Use `app-sticky-header` for form/detail pages with save/cancel actions, such as product create/edit and settings pages. List modules usually use sticky stats plus sticky search instead.

## Related Skills

- `vendix-frontend-data-display` - Table, ItemList, and ResponsiveDataView configuration
- `vendix-frontend-stats-cards` - StatsComponent and `.stats-container`
- `vendix-frontend-sticky-header` - Reusable sticky header for form/detail pages
- `vendix-zoneless-signals` - Angular 20 signals and zoneless rules
