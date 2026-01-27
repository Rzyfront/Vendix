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

The main component acts as the orchestrator. It holds the data state and manages modals.
**RULE:** Use a single `div` container with `flex flex-col gap-6`.

```typescript
@Component({
  template: `
    <!-- Standard Module Layout -->
    <div class="flex flex-col gap-6">

      <!-- Stats Grid -->
      <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <!-- stats must use system colors -->
        <app-stats
          title="Total Roles"
          [value]="stats.totalRoles"
          iconName="shield"
          iconBgColor="bg-blue-100"
          iconColor="text-blue-600"
        ></app-stats>
        <!-- ... other stats ... -->
      </div>

      <!-- Main Content Card -->
      <div class="flex flex-col bg-surface border border-border rounded-xl shadow-sm overflow-hidden">
        <!-- Header (Title & Controls) -->
        <!-- SEE SECTION 2 BELOW FOR HEADER DETAILS -->

        <!-- Table Content -->
        <!-- SEE SECTION 3 BELOW FOR TABLE DETAILS -->
      </div>
    </div>
  `
})
```

### 2. Header Layout (Compact & Symmetric)

The header MUST follow this exact structure for symmetry and compactness.

**Container Style:** `p-2 md:px-6 md:py-4 border-b border-border flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between bg-surface`

**Left Side (Title & Help):**
```html
<div class="flex-1 min-w-0">
  <h3 class="text-lg font-semibold text-text-primary">
    Listado de [Entidad]
  </h3>
  <p class="hidden sm:block text-xs text-text-secondary mt-0.5">
    [Descripción breve]
  </p>
</div>
```

**Right Side (Controls):**
- Container: `flex flex-col sm:flex-row items-stretch sm:items-center gap-3 w-full sm:w-auto`
- **Search**: `w-full sm:w-60`. MUST use `size="sm"` and `fullWidth="true"`.
- **Selector**: `w-full sm:w-48`. MUST use `size="sm"` and `label=""` (no label).
- **Actions**: Flex container `flex gap-2 items-center sm:ml-auto`. Buttons MUST be `size="sm"`.

```html
<!-- Search -->
<div class="w-full sm:w-60">
  <app-inputsearch
    placeholder="Buscar..."
    [debounceTime]="300"
    (searchChange)="onSearch($event)"
    size="sm"
    fullWidth="true"
  ></app-inputsearch>
</div>

<!-- Selector (No Label, No margin-top) -->
<div class="w-full sm:w-48">
  <app-selector
    placeholder="Filtrar..."
    [options]="options"
    [formControl]="control"
    size="sm"
    variant="outline"
  ></app-selector>
</div>

<!-- Actions -->
<div class="flex gap-2 items-center sm:ml-auto">
  <app-button variant="primary" size="sm" iconName="plus" (clicked)="create()">
    <span class="hidden sm:inline">Nuevo</span>
    <span class="sm:hidden">Plus</span>
  </app-button>
</div>
```

### 3. Table Container

The table container MUST have padding to separate it from the card edges.

**Style:** `relative min-h-[400px] p-2 md:p-4`

```html
<div class="relative min-h-[400px] p-2 md:p-4">
  <!-- Loading Overlay -->
  <div *ngIf="isLoading" class="absolute inset-0 bg-surface/50 z-10 flex items-center justify-center">
    <div class="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
  </div>

  <!-- Table -->
  <app-table [data]="items" ...>
    <!-- Empty State internal slot -->
    <div class="p-8 flex justify-center w-full" *ngIf="!isLoading && items.length === 0">
       <app-empty-state ...></app-empty-state>
    </div>
  </app-table>
</div>
```

### 4. Stats Component Usage

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

### 5. Angular Signals

All new logic MUST use Angular Signals.
- `input()` instead of `@Input()`
- `output()` instead of `@Output()`
- Use `inject()` for dependency injection.

### 6. Code Examples

**Role Stats Interface (camelCase):**
```typescript
export interface RoleStats {
  totalRoles: number;
  systemRoles: number;
  customRoles: number;
  totalPermissions: number;
}
```

## Resources

- **Reference Module**: `apps/frontend/src/app/private/modules/super-admin/roles/` (Gold Standard)
- **Theme**: Use `vendix-frontend-theme` variables.
