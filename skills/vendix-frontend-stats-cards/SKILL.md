---
name: vendix-frontend-stats-cards
description: >
  Responsive stats cards pattern with horizontal scroll on mobile and grid on desktop.
  Uses the shared StatsComponent for consistent styling across all admin modules.
  Trigger: When implementing stats cards, dashboard metrics, or KPI displays in admin modules.
license: Apache-2.0
metadata:
  author: gentleman-programming
  version: "1.0"
  scope: [root, frontend]
  auto_invoke: "Implementing stats cards or dashboard metrics with mobile scroll"
---

## When to Use

- Creating stats/KPI cards in any admin module (STORE_ADMIN, ORG_ADMIN, SUPER_ADMIN)
- Implementing dashboard metrics with responsive behavior
- Adding summary statistics above data tables
- Need horizontal scroll on mobile with grid layout on desktop

## Critical Patterns

### 1. Stats Container Structure

The container uses `stats-container` class which enables:
- **Desktop (>=640px)**: CSS Grid with 4 columns
- **Mobile (<640px)**: Flexbox with horizontal scroll

```html
<!-- Parent component template -->
<div class="stats-container">
  <app-stats title="..." [value]="..." ...></app-stats>
  <app-stats title="..." [value]="..." ...></app-stats>
  <app-stats title="..." [value]="..." ...></app-stats>
  <app-stats title="..." [value]="..." ...></app-stats>
</div>
```

**Global CSS for `stats-container`** (in `styles.scss`):

```scss
.stats-container {
  // Mobile: Horizontal scroll
  @apply flex gap-3 overflow-x-auto pb-2 -mx-4 px-4;
  scrollbar-width: none;
  -ms-overflow-style: none;
  &::-webkit-scrollbar {
    display: none;
  }

  // Desktop: Grid layout
  @media (min-width: 640px) {
    @apply grid grid-cols-2 lg:grid-cols-4 gap-4 overflow-visible mx-0 px-0 pb-0;
  }
}
```

### 2. StatsComponent Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `title` | `string` | required | Card title (e.g., "Órdenes") |
| `value` | `string \| number` | `''` | Main value (formatted) |
| `smallText` | `string` | optional | Secondary text (e.g., growth rate) |
| `iconName` | `string` | `'info'` | Lucide icon name |
| `iconBgColor` | `string` | `'bg-primary/10'` | Tailwind bg class |
| `iconColor` | `string` | `'text-primary'` | Tailwind text class |
| `clickable` | `boolean` | `true` | Enable hover effects |

### 3. Color Palette (Standard)

Use these consistent color combinations:

| Stat Type | iconBgColor | iconColor | Icon |
|-----------|-------------|-----------|------|
| Primary/Total | `bg-blue-100` | `text-blue-500` | `shopping-cart`, `users`, `box` |
| Warning/Pending | `bg-amber-100` | `text-amber-500` | `clock`, `alert-circle` |
| Success/Complete | `bg-emerald-100` | `text-emerald-500` | `check-circle`, `check` |
| Revenue/Money | `bg-purple-100` | `text-purple-500` | `dollar-sign`, `credit-card` |
| Danger/Critical | `bg-red-100` | `text-red-500` | `x-circle`, `alert-triangle` |
| Info/Secondary | `bg-gray-100` | `text-gray-500` | `info`, `help-circle` |

### 4. Mobile Layout Details

Each `<app-stats>` card has these mobile styles (in `stats.component.scss`):

```scss
:host {
  display: block;

  @media (max-width: 639px) {
    width: 160px;      // Fixed width for scroll
    flex-shrink: 0;    // Prevent shrinking
  }
}

.stat-card {
  // Mobile: Block layout with absolute icon
  @media (max-width: 639px) {
    @apply p-3 block relative w-full h-full;
  }
}

.stat-icon {
  // Mobile: Top-right corner positioning
  @media (max-width: 639px) {
    @apply absolute top-3 right-3 w-auto h-auto bg-transparent !important;
  }
}

.stat-title {
  // Mobile: Uppercase bold compact
  @media (max-width: 639px) {
    @apply text-[10px] font-bold uppercase tracking-wide;
    max-width: calc(100% - 24px); // Space for icon
  }
}
```

### 5. Desktop Layout Details

```scss
.stat-card {
  // Desktop: Horizontal flex with icon on right
  @apply p-3.5 flex items-center;
}

.stat-icon {
  // Desktop: Ordered to right side
  @apply w-8 h-8 ml-1.5 order-2;
}

.stat-content {
  @apply flex-1 overflow-hidden order-1;
}
```

## Code Examples

### Creating a Stats Wrapper Component

```typescript
// order-stats.component.ts
import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { StatsComponent } from '@shared/components';

interface OrderStats {
  total_orders: number;
  pending_orders: number;
  completed_orders: number;
  total_revenue: number;
  // Growth rates (calculated on frontend)
  ordersGrowthRate?: number;
  pendingGrowthRate?: number;
  completedGrowthRate?: number;
  revenueGrowthRate?: number;
}

@Component({
  selector: 'app-order-stats',
  standalone: true,
  imports: [CommonModule, StatsComponent],
  template: `
    <div class="stats-container">
      <app-stats
        title="Órdenes"
        [value]="formatNumber(stats.total_orders)"
        [smallText]="getGrowthText(stats.ordersGrowthRate)"
        iconName="shopping-cart"
        iconBgColor="bg-blue-100"
        iconColor="text-blue-500"
      />

      <app-stats
        title="Pendientes"
        [value]="formatNumber(stats.pending_orders)"
        [smallText]="getGrowthText(stats.pendingGrowthRate)"
        iconName="clock"
        iconBgColor="bg-amber-100"
        iconColor="text-amber-500"
      />

      <app-stats
        title="Completadas"
        [value]="formatNumber(stats.completed_orders)"
        [smallText]="getGrowthText(stats.completedGrowthRate)"
        iconName="check-circle"
        iconBgColor="bg-emerald-100"
        iconColor="text-emerald-500"
      />

      <app-stats
        title="Ingresos"
        [value]="formatCurrency(stats.total_revenue)"
        [smallText]="getGrowthText(stats.revenueGrowthRate)"
        iconName="dollar-sign"
        iconBgColor="bg-purple-100"
        iconColor="text-purple-500"
      />
    </div>
  `,
})
export class OrderStatsComponent {
  @Input() stats: OrderStats = {
    total_orders: 0,
    pending_orders: 0,
    completed_orders: 0,
    total_revenue: 0,
  };

  formatNumber(num: number): string {
    if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
    if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
    return num.toString();
  }

  formatCurrency(value: number): string {
    if (value >= 1000000) return '$' + (value / 1000000).toFixed(1) + 'M';
    if (value >= 1000) return '$' + (value / 1000).toFixed(1) + 'K';
    return '$' + value.toFixed(0);
  }

  getGrowthText(rate?: number): string {
    if (rate === undefined) return '';
    const sign = rate >= 0 ? '+' : '';
    return `${sign}${rate.toFixed(1)}% vs mes ant.`;
  }
}
```

### Usage in Parent Module

```typescript
// orders.component.ts
@Component({
  standalone: true,
  imports: [OrderStatsComponent, /* ... */],
  template: `
    <div class="space-y-4">
      <!-- Stats Cards (scroll on mobile, grid on desktop) -->
      <app-order-stats [stats]="orderStats" />

      <!-- Main Content Card -->
      <div class="bg-surface rounded-xl border border-border shadow-sm">
        <!-- ... table content ... -->
      </div>
    </div>
  `,
})
export class OrdersComponent {
  orderStats = signal<OrderStats>({ /* ... */ });

  constructor(private ordersService: OrdersService) {
    this.loadStats();
  }

  loadStats() {
    this.ordersService.getStats().subscribe({
      next: (response) => {
        this.orderStats.set({
          ...response.data,
          // Calculate growth rates if needed
          ordersGrowthRate: this.calculateGrowth(/* ... */),
        });
      },
    });
  }
}
```

### Minimal Stats (Without Wrapper)

For simple cases, use `<app-stats>` directly:

```html
<div class="stats-container">
  <app-stats
    title="Total"
    [value]="totalCount"
    iconName="box"
    iconBgColor="bg-blue-100"
    iconColor="text-blue-500"
  />
  <app-stats
    title="Activos"
    [value]="activeCount"
    iconName="check"
    iconBgColor="bg-emerald-100"
    iconColor="text-emerald-500"
  />
</div>
```

## Formatting Utilities

### Number Formatting

```typescript
// Use for counts, quantities
formatNumber(num: number): string {
  if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
  if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
  return num.toString();
}
```

### Currency Formatting

```typescript
// Use for revenue, prices
formatCurrency(value: number): string {
  if (value >= 1000000) return '$' + (value / 1000000).toFixed(1) + 'M';
  if (value >= 1000) return '$' + (value / 1000).toFixed(1) + 'K';
  return '$' + value.toFixed(0);
}
```

### Growth Rate Text

```typescript
// Returns "+5.2% vs mes ant." or "-2.1% vs mes ant."
getGrowthText(rate?: number): string {
  if (rate === undefined) return '';
  const sign = rate >= 0 ? '+' : '';
  return `${sign}${rate.toFixed(1)}% vs mes ant.`;
}
```

## Common Implementation Mistakes ⚠️

**NEVER use these classes for stats containers:**

| ❌ Incorrect Class | ✅ Correct Class |
|-------------------|-----------------|
| `grid grid-cols-4 gap-2 md:gap-4 lg:gap-6` | `stats-container` |
| `grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4` | `stats-container` |
| `grid grid-cols-2 md:grid-cols-4 gap-4` | `stats-container` |
| `flex flex-wrap gap-4` | `stats-container` |

### Why These Are Wrong

1. **No mobile scroll**: Raw grid classes don't provide horizontal scroll on mobile
2. **Cards get compressed**: On narrow screens, 4 cards in a grid become unreadable
3. **Inconsistent UX**: Different modules will behave differently
4. **No snap scrolling**: Users can't easily scroll to specific cards

### Quick Fix Pattern

```html
<!-- BEFORE (wrong) -->
<div class="grid grid-cols-4 gap-2 md:gap-4 lg:gap-6">
  <app-stats ...></app-stats>
</div>

<!-- AFTER (correct) -->
<div class="stats-container">
  <app-stats ...></app-stats>
</div>
```

## Checklist

- [ ] Use `stats-container` class on parent div (NOT grid classes)
- [ ] Maximum 4 stats cards per row (standard)
- [ ] Use consistent color palette (see table above)
- [ ] Include `smallText` for growth/comparison metrics
- [ ] Format large numbers with K/M suffixes
- [ ] Test horizontal scroll on mobile viewport
- [ ] Verify cards are swipeable with snap behavior on mobile

## Resources

- **Reference Implementation**: `apps/frontend/src/app/private/modules/store/orders/components/order-stats/`
- **Shared Component**: `apps/frontend/src/app/shared/components/stats/`
- **Global Styles**: `apps/frontend/src/styles.scss` (`.stats-container`)
