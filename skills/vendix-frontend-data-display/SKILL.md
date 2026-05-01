---
name: vendix-frontend-data-display
description: >
  Responsive data display patterns using TableComponent, ItemListComponent, and
  ResponsiveDataViewComponent. Trigger: When displaying lists of records, creating
  responsive admin tables, or configuring mobile card views.
license: Apache-2.0
metadata:
  author: rzyfront
  version: "2.1"
  scope: [root]
  auto_invoke: "Displaying data lists, implementing responsive tables, creating mobile card views"
---

## When to Use

- Displaying records such as products, orders, customers, roles, plans, or invoices.
- Replacing desktop-only tables with desktop table plus mobile cards.
- Configuring `TableColumn`, `TableAction`, or `ItemListCardConfig`.

Before implementing, check the component READMEs under `apps/frontend/src/app/shared/components/{table,item-list,responsive-data-view}/` and then verify against the component source when an input matters.

## Component Choice

| Need | Component |
| --- | --- |
| Desktop table only | `TableComponent` |
| Mobile card list only | `ItemListComponent` |
| Both desktop and mobile | `ResponsiveDataViewComponent` |

`ResponsiveDataViewComponent` is the default for admin lists. It renders `app-table` in `hidden md:block` and `app-item-list` in `block md:hidden`.

## ResponsiveDataView API

Required for useful output:

- `data`: records.
- `columns`: `TableColumn[]` for desktop.
- `cardConfig`: required `ItemListCardConfig` for mobile.
- `actions`: optional `TableAction[]`, shared across table and cards.
- `loading`: aliases to the component loading input.

Also supported: `tableSize`, `itemListSize`, `showHeader`, `striped`, `hoverable`, `bordered`, `compact`, `sortable`, `emptyMessage`, `emptyTitle`, `emptyDescription`, `emptyActionText`, `emptyActionIcon`, `showEmptyAction`, `showEmptyClearFilters`, and `showEmptyRefresh`.

Outputs include `sort`, `rowClick`, `actionClick`, and empty-state action outputs.

```html
<app-responsive-data-view
  [data]="items()"
  [columns]="columns"
  [cardConfig]="cardConfig"
  [actions]="actions"
  [loading]="loading()"
  [sortable]="true"
  emptyMessage="No data available"
  emptyIcon="inbox"
  (sort)="onSort($event)"
  (rowClick)="onRowClick($event)"
  (actionClick)="onActionClick($event)"
/>
```

## Table Configuration

`TableColumn` supports `key`, `label`, `sortable`, `width`, `align`, `template`, `transform`, `cellClass`, `cellStyle`, `defaultValue`, `badge`, `badgeConfig`, `priority`, `type`, and `badgeTransform`.

`TableAction` supports `label`, `icon`, `action`, `variant`, `disabled`, `show`, and `tooltip`.

Action variants currently include `primary`, `secondary`, `danger`, `ghost`, `success`, `warning`, `info`, `gaming`, `royal`, `muted`, or a function returning a class/string.

Table responsive priority behavior:

- `priority >= 2` hides on mobile.
- `priority >= 3` hides on tablet.
- Without explicit priorities, wide tables hide later columns automatically.

## Mobile Card Configuration

`ItemListCardConfig` supports:

```typescript
const cardConfig: ItemListCardConfig = {
  titleKey: 'name',
  titleTransform: (item) => item.name,
  subtitleKey: 'sku',
  subtitleTransform: (item) => item.brand,
  avatarKey: 'image_url',
  avatarFallbackIcon: 'package',
  avatarShape: 'square',
  badgeKey: 'state',
  badgeConfig: { type: 'status', size: 'sm' },
  badgeTransform: (value) => String(value),
  detailKeys: [
    { key: 'sku', label: 'SKU', icon: 'barcode' },
    { key: 'stock', label: 'Stock', icon: 'boxes' },
  ],
  footerKey: 'base_price',
  footerLabel: 'Price',
  footerStyle: 'prominent',
  footerTransform: (value) => formatCurrency(value),
};
```

`ItemListDetailField` also supports `infoIcon`, `infoIconTransform`, `infoIconVariant`, and `infoIconVariantTransform`.

Current caveat: `footerStyle` exists in the interface and is used by module configs, but the current item-list template does not visibly branch on it. Do not promise special styling unless verified in the component SCSS/template.

## Action Rendering

- Desktop actions render through the table.
- Mobile item cards render the first two visible actions directly.
- Additional visible actions move into a `more-horizontal` dropdown.
- `show` and `disabled` may be booleans or item-aware functions depending on the action config.

## References

- Products card config: `apps/frontend/src/app/private/modules/store/products/components/product-list/product-list.component.ts`
- Orders card config: `apps/frontend/src/app/private/modules/store/orders/components/orders-list/orders-list.component.ts`
- Store roles card config: `apps/frontend/src/app/private/modules/store/settings/roles/components/store-roles-list.component.ts`
- Shared components barrel: `apps/frontend/src/app/shared/components/index.ts`

## Related Skills

- `vendix-frontend-standard-module` - Full admin list layout
- `vendix-frontend-icons` - Icons used in actions, avatars, and detail fields
- `vendix-date-timezone` - Date transforms
- `vendix-currency-formatting` - Currency transforms
