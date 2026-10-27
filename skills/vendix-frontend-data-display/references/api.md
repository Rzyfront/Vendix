# Data display — API catalog

Verify against source when an input matters: `apps/frontend/src/app/shared/components/{table,item-list,responsive-data-view}/` (each has a README).

## ResponsiveDataView inputs/outputs

- Data/table: `data` (current page slice), `columns: TableColumn[]`, `tableSize`, `showHeader`, `striped`, `hoverable`, `bordered`, `compact`, `sortable`, `actionsDisplay: 'buttons' | 'dropdown'`, `rowClass(item, i)`.
- Cards: `cardConfig` (required), `itemListSize`, `emptyIcon`.
- Shared: `actions`, `mobileActions` (mobile-only override; desktop always `actions`), `mobileDirectActionsCount` (default 2), `loading` (alias), `emptyMessage`, `emptyTitle`, `emptyDescription`, `emptyActionText`, `emptyActionIcon`, `showEmptyAction`, `showEmptyClearFilters`, `showEmptyRefresh`.
- Multi-selection (opt-in): `selectable`, `rowIdKey` (dot notation), `rowLabelKey` (accessible name of action buttons), `[(selectedIds)]` `Set<string|number>` shared by table and cards (survives breakpoint switch).
- Outputs: `sort`, `rowClick`, `actionClick`, `emptyActionClick`, `emptyClearFiltersClick`, `emptyRefreshClick`.

```html
<app-responsive-data-view
  [data]="items()" [columns]="columns" [cardConfig]="cardConfig" [actions]="actions"
  [loading]="loading()" [sortable]="true" emptyMessage="Sin datos" emptyIcon="inbox"
  (sort)="onSort($event)" (rowClick)="onRowClick($event)" (actionClick)="onActionClick($event)" />
```

## TableColumn / TableAction

- `TableColumn`: `key`, `label`, `sortable`, `width`, `align`, `template`, `transform`, `cellClass`, `cellStyle`, `defaultValue`, `badge`, `badgeConfig`, `priority`, `type`, `imageClick`, `badgeTransform`.
- Priority: `priority >= 2` hidden on mobile, `>= 3` hidden on tablet; without priorities, wide tables hide later columns automatically.
- `TableAction`: `label`, `icon`, `action`, `variant`, `disabled`, `show`, `tooltip`. `show`/`disabled` may be booleans or item functions.
- Variants: `primary | secondary | danger | ghost (default) | success | warning | info | gaming | royal | muted | order-pending | order-processing | order-ready | order-delivered | order-cancelled` or `(item) => string`.

## ItemListCardConfig

```typescript
const cardConfig: ItemListCardConfig = {
  titleKey: 'name', titleTransform: (item) => item.name,
  subtitleKey: 'sku', subtitleTransform: (item) => item.brand,
  avatarKey: 'image_url', avatarFallbackIcon: 'package', avatarShape: 'square',
  badgeKey: 'state', badgeConfig: { type: 'status', size: 'sm' }, badgeTransform: (v) => String(v),
  detailKeys: [
    { key: 'sku', label: 'SKU', icon: 'barcode' },
    { key: 'stock', label: 'Stock', icon: 'boxes' },
  ],
  footerKey: 'base_price', footerLabel: 'Precio',
  footerTransform: (v) => currencyService.format(v),
};
```

`ItemListDetailField` also supports `infoIcon`, `infoIconTransform`, `infoIconVariant`, `infoIconVariantTransform`. `footerStyle: 'default' | 'prominent'` exists in the interface but the item-list template/SCSS does not branch on it: do not promise special styling.

## Card config references

- Products: `apps/frontend/src/app/private/modules/store/products/components/product-list/product-list.component.ts`
- Orders: `apps/frontend/src/app/private/modules/store/orders/components/orders-list/orders-list.component.ts`
- Store roles: `apps/frontend/src/app/private/modules/store/settings/roles/components/store-roles-list.component.ts`
