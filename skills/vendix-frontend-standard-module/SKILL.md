---
name: vendix-frontend-standard-module
description: >
  Standard layout for admin modules with 4 stats cards, search/filter header, and a data table.
  Mobile-first design with sticky headers and responsive data views.
  Trigger: When creating or refactoring an admin list module in STORE_ADMIN or ORG_ADMIN.
license: Apache-2.0
metadata:
  author: gentleman-programming
  version: "2.0"
  scope: [root, frontend]
  auto_invoke: "Creating or refactoring standard admin modules (stats + table)"
---

## When to Use

- Creating a new CRUD list module (e.g., Products, Orders, Customers).
- Standardizing existing modules to follow the Vendix Admin UI pattern.
- Implementing a dashboard-like view with quick stats and a primary data table.

## Critical Patterns

### 1. Mobile-First Layout Structure

The main component uses a mobile-first approach with sticky elements for optimal UX.

**Z-Index Stacking (Mobile):**

| Layer | Element | Z-Index | Top Position |
|-------|---------|---------|--------------|
| 1 | Stats Container | z-20 | top-0 |
| 2 | Search Section | z-10 | top-[99px] |
| 3 | Items Content | z-0 | (scrolls) |

```typescript
@Component({
  template: `
    <!-- Standard Module Layout (Mobile-First) -->
    <div class="w-full">

      <!-- Stats: Sticky on mobile, static on desktop -->
      <div class="stats-container !mb-0 md:!mb-8 sticky top-0 z-20 bg-background md:static md:bg-transparent">
        <app-stats
          title="Total Roles"
          [value]="stats.totalRoles"
          iconName="shield"
          iconBgColor="bg-blue-100"
          iconColor="text-blue-600"
        ></app-stats>
        <!-- ... other stats (max 4) ... -->
      </div>

      <!-- List Component (contains search + data view) -->
      <app-[entity]-list
        [items]="items()"
        [loading]="loading()"
        (edit)="onEdit($event)"
        (delete)="onDelete($event)"
      ></app-[entity]-list>
    </div>
  `
})
```

### 2. Stats Container Behavior

**Mobile (<640px):**
- Flex horizontal with scroll
- Fixed card width: 160px
- Gap: 12px
- Sticky: `sticky top-0 z-20`
- Solid background: `bg-background`

**Desktop (>=640px):**
- Grid: 4 columns
- Gap: 16px (24px in lg)
- Static positioning: `md:static`
- Transparent background: `md:bg-transparent`

```html
<div class="stats-container !mb-0 md:!mb-8 sticky top-0 z-20 bg-background md:static md:bg-transparent">
  <!-- app-stats cards -->
</div>
```

### 3. Header/Search Section (Mobile-First)

The search section is sticky on mobile and positioned below the stats.

**Mobile (<768px):**
- Sticky: `sticky top-[99px] z-10`
- Title: `text-[13px] font-bold text-gray-600 tracking-wide`
- Search + Options: Row layout with `gap-2`
- Shadow on inputs: `shadow-[0_2px_8px_rgba(0,0,0,0.07)]`
- Background: `bg-background`

**Desktop (>=768px):**
- Static: `md:static md:bg-transparent`
- Title: `md:text-lg md:font-semibold md:text-text-primary`
- Layout: `md:flex-row md:justify-between`
- No shadow on inputs: `md:shadow-none`
- Border bottom: `md:border-b md:border-border`

```html
<!-- Search Section (inside list component) -->
<div class="sticky top-[99px] z-10 bg-background px-2 py-1.5 -mt-[5px]
            md:mt-0 md:static md:bg-transparent md:px-6 md:py-4 md:border-b md:border-border">
  <div class="flex flex-col gap-2 md:flex-row md:justify-between md:items-center md:gap-4">
    <!-- Title with count -->
    <h2 class="text-[13px] font-bold text-gray-600 tracking-wide
               md:text-lg md:font-semibold md:text-text-primary">
      [Entidad] ({{ items.length }})
    </h2>

    <!-- Search + Options Row -->
    <div class="flex items-center gap-2 w-full md:w-auto">
      <app-inputsearch
        class="flex-1 md:w-64 shadow-[0_2px_8px_rgba(0,0,0,0.07)] md:shadow-none rounded-[10px]"
        placeholder="Buscar..."
        [debounceTime]="300"
        (searchChange)="onSearch($event)"
      />
      <app-options-dropdown
        class="shadow-[0_2px_8px_rgba(0,0,0,0.07)] md:shadow-none rounded-[10px]"
        [options]="filterOptions"
        (optionSelected)="onFilter($event)"
      />
    </div>
  </div>
</div>
```

**Important:** The `top-[99px]` value must match the height of the stats cards (~104px minus margin adjustments).

### 4. Container Styling (Mobile-First)

**Mobile:** Transparent, no borders (items float individually)
**Desktop:** Surface background, rounded, shadow, border

```html
<!-- Content container (wraps ResponsiveDataView) -->
<div class="md:bg-surface md:rounded-xl md:shadow-[0_2px_8px_rgba(0,0,0,0.07)]
            md:border md:border-border md:min-h-[600px] md:overflow-hidden">
  <app-responsive-data-view
    [data]="items"
    [columns]="columns"
    [cardConfig]="cardConfig"
    [actions]="actions"
    [loading]="loading"
  />
</div>
```

**Consistent Shadow Value:** `0 2px 8px rgba(0,0,0,0.07)` - used across:
- Stats cards
- Search inputs (mobile only)
- Item cards (mobile only)
- Main container (desktop only)

### 5. Data Display Container

Use `ResponsiveDataViewComponent` for automatic mobile/desktop switching:

```html
<div class="relative min-h-[400px] p-2 md:p-4">
  <!-- Loading Overlay -->
  @if (isLoading) {
    <div class="absolute inset-0 bg-surface/50 z-10 flex items-center justify-center">
      <div class="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
    </div>
  }

  <!-- Responsive Data View (Table on desktop, Cards on mobile) -->
  <app-responsive-data-view
    [data]="items"
    [columns]="columns"
    [cardConfig]="cardConfig"
    [actions]="actions"
    [loading]="loading"
    emptyMessage="No hay datos"
    emptyIcon="inbox"
  />
</div>
```

### 6. Stats Component Usage

**RULE:** Use `iconBgColor` and `iconColor` inputs directly. Do NOT rely on generic `variant` unless absolutely necessary.
**Data Rule:** Stats data properties usually come as camelCase from the API (e.g., `totalRoles`, `systemRoles`). Match the interface exactly.

```html
<app-stats
  title="System Roles"
  [value]="stats.systemRoles"
  iconName="lock"
  iconBgColor="bg-purple-100"
  iconColor="text-purple-600"
></app-stats>
```

### 7. Angular Signals

All new logic MUST use Angular Signals.
- `input()` instead of `@Input()`
- `output()` instead of `@Output()`
- Use `inject()` for dependency injection.

### 8. Complete List Component Example

```typescript
@Component({
  selector: 'app-product-list',
  standalone: true,
  imports: [
    ResponsiveDataViewComponent,
    InputSearchComponent,
    OptionsDropdownComponent,
  ],
  template: `
    <!-- Search Section -->
    <div class="sticky top-[99px] z-10 bg-background px-2 py-1.5 -mt-[5px]
                md:mt-0 md:static md:bg-transparent md:px-6 md:py-4 md:border-b md:border-border">
      <div class="flex flex-col gap-2 md:flex-row md:justify-between md:items-center md:gap-4">
        <h2 class="text-[13px] font-bold text-gray-600 tracking-wide
                   md:text-lg md:font-semibold md:text-text-primary">
          Productos ({{ items().length }})
        </h2>
        <div class="flex items-center gap-2 w-full md:w-auto">
          <app-inputsearch
            class="flex-1 md:w-64 shadow-[0_2px_8px_rgba(0,0,0,0.07)] md:shadow-none rounded-[10px]"
            placeholder="Buscar producto..."
            (searchChange)="onSearch($event)"
          />
          <app-options-dropdown
            class="shadow-[0_2px_8px_rgba(0,0,0,0.07)] md:shadow-none rounded-[10px]"
            [options]="filterOptions"
          />
        </div>
      </div>
    </div>

    <!-- Content Container -->
    <div class="md:bg-surface md:rounded-xl md:shadow-[0_2px_8px_rgba(0,0,0,0.07)]
                md:border md:border-border md:min-h-[600px] md:overflow-hidden">
      <app-responsive-data-view
        [data]="filteredItems()"
        [columns]="columns"
        [cardConfig]="cardConfig"
        [actions]="actions"
        [loading]="loading()"
      />
    </div>
  `,
})
export class ProductListComponent {
  items = input.required<Product[]>();
  loading = input<boolean>(false);

  edit = output<Product>();
  delete = output<Product>();

  cardConfig: ItemListCardConfig = {
    titleKey: 'name',
    subtitleKey: 'brand',
    avatarKey: 'image_url',
    avatarShape: 'square',
    badgeKey: 'state',
    footerKey: 'base_price',
    footerLabel: 'Precio',
    footerStyle: 'prominent',
    detailKeys: [
      { key: 'sku', label: 'SKU' },
      { key: 'stock', label: 'Stock' },
    ],
  };

  actions: TableAction[] = [
    { label: 'Editar', icon: 'edit', variant: 'primary', action: (item) => this.edit.emit(item) },
    { label: 'Eliminar', icon: 'trash-2', variant: 'danger', action: (item) => this.delete.emit(item) },
  ];
}
```

### 9. Role Stats Interface (camelCase)

```typescript
export interface RoleStats {
  totalRoles: number;
  systemRoles: number;
  customRoles: number;
  totalPermissions: number;
}
```

## Resources

- **Reference Module**: `apps/frontend/src/app/private/modules/store/products/` (Gold Standard - Mobile-First)
- **Legacy Reference**: `apps/frontend/src/app/private/modules/super-admin/roles/` (Desktop-first)
- **Theme**: Use `vendix-frontend-theme` variables.

## Related Skills

- `vendix-frontend-data-display` - ResponsiveDataView configuration
- `vendix-frontend-stats-cards` - Stats card patterns and sticky behavior
