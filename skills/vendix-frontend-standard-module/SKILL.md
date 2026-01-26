---
name: vendix-frontend-standard-module
description: >
  Standard layout for admin modules with 4 stats cards, search/filter header, and a data table.
  Trigger: When creating or refactoring an admin list module in STORE_ADMIN or ORG_ADMIN.
license: Apache-2.0
metadata:
  author: gentleman-programming
  version: "1.0"
  scope: [root, frontend]
  auto_invoke: "Creating or refactoring standard admin modules (stats + table)"
---

## When to Use

- Creating a new CRUD list module (e.g., Products, Orders, Customers).
- Standardizing existing modules to follow the Vendix Admin UI pattern.
- Implementing a dashboard-like view with quick stats and a primary data table.

## Critical Patterns

### 1. Main Component Structure

The main component should orchestrate the stats and the list component.

```typescript
@Component({
  template: `
    <div class="w-full">
      <!-- 4 Stats Cards Grid -->
      <div class="grid grid-cols-4 gap-2 md:gap-4 lg:gap-6 mb-4 md:mb-6 lg:mb-8">
        <app-stats title="Total" [value]="stats.total" iconName="package"></app-stats>
        <app-stats title="Active" [value]="stats.active" iconName="check-circle"></app-stats>
        <app-stats title="Alerts" [value]="stats.alerts" iconName="alert-triangle"></app-stats>
        <app-stats title="Value" [value]="stats.value" iconName="dollar-sign"></app-stats>
      </div>

      <!-- List Component -->
      <app-item-list
        [items]="items"
        [isLoading]="isLoading"
        (search)="onSearch($event)"
        (filter)="onFilter($event)"
        (create)="openCreateModal()"
      ></app-item-list>

      <!-- Quick Interaction Modals -->
      <app-item-create-modal [(isOpen)]="isCreateModalOpen"></app-item-create-modal>
    </div>
  `
})
```

### 2. List Component Layout

The list component must use the standard container and header styling.

```html
<div
  class="bg-surface rounded-card shadow-card border border-border min-h-[600px]"
>
  <!-- Header -->
  <div class="p-2 md:px-6 md:py-4 border-b border-border">
    <div
      class="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4"
    >
      <div class="flex-1 min-w-0">
        <h2 class="text-lg font-semibold text-text-primary">
          Title ({{ items.length }})
        </h2>
      </div>

      <div
        class="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 w-full sm:w-auto"
      >
        <!-- Search -->
        <app-inputsearch
          class="w-full sm:w-64"
          (ngModelChange)="onSearch($event)"
        ></app-inputsearch>

        <!-- Filters -->
        <app-item-filter-dropdown
          (filterChange)="onFilter($event)"
        ></app-item-filter-dropdown>

        <!-- Actions -->
        <div class="flex gap-2">
          <app-button variant="outline" (clicked)="refresh.emit()"
            ><app-icon name="refresh"></app-icon
          ></app-button>
          <app-button variant="primary" (clicked)="create.emit()"
            ><app-icon name="plus"></app-icon> New</app-button
          >
        </div>
      </div>
    </div>
  </div>

  <!-- Table -->
  <div class="p-2 md:p-4">
    <app-table
      [data]="items"
      [columns]="tableColumns"
      [actions]="tableActions"
    ></app-table>
  </div>
</div>
```

### 3. Component Communication

- **Main to List:** Pass data (`items`, `isLoading`) and configurations.
- **List to Main:** Emit events for `search`, `filter`, `create`, `edit`, `delete`.
- **Main to Modals:** Control visibility with `isOpen` (two-way binding).

## Code Examples

### Table Column Configuration

```typescript
tableColumns: TableColumn[] = [
  { key: 'name', label: 'Name', sortable: true, priority: 1 },
  {
    key: 'status',
    label: 'Status',
    badge: true,
    badgeConfig: {
      type: 'custom',
      colorMap: { active: '#22c55e', inactive: '#f59e0b' }
    }
  },
  { key: 'created_at', label: 'Date', transform: (val) => formatDate(val) }
];
```

## Resources

- **Core Components**: `app-stats`, `app-table`, `app-button`, `app-inputsearch`.
- **Reference**: `apps/frontend/src/app/private/modules/store/products/`
