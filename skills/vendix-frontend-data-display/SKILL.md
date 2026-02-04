---
name: vendix-frontend-data-display
description: >
  Responsive data display patterns using Table, ItemList, and ResponsiveDataView components.
  Mobile-first card layouts with action button styling and prominent footer values.
  Trigger: When displaying lists of data, creating admin modules with tables, or implementing mobile-friendly data views.
license: Apache-2.0
metadata:
  author: gentleman-programming
  version: "2.0"
  scope: [frontend]
  auto_invoke: "Displaying data lists, implementing responsive tables, creating mobile card views"
---

## When to Use

- Displaying lists of records (customers, products, orders, etc.)
- Creating admin modules that need both desktop and mobile support
- Converting existing tables to responsive views
- Implementing card-based mobile layouts

---

## Component Decision Tree

| Scenario | Component | Reason |
|----------|-----------|--------|
| Desktop only | `TableComponent` | Full table functionality |
| Mobile only | `ItemListComponent` | Card-based layout |
| **Both (recommended)** | `ResponsiveDataViewComponent` | Auto-switches at 768px |
| Custom breakpoint | Manual implementation | Use CSS classes directly |

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│              ResponsiveDataViewComponent                │
│  ┌─────────────────────┐  ┌─────────────────────────┐  │
│  │   Desktop (≥768px)  │  │    Mobile (<768px)      │  │
│  │   ┌─────────────┐   │  │   ┌─────────────────┐   │  │
│  │   │    Table    │   │  │   │    ItemList     │   │  │
│  │   │  Component  │   │  │   │    Component    │   │  │
│  │   └─────────────┘   │  │   └─────────────────┘   │  │
│  │   hidden md:block   │  │   block md:hidden       │  │
│  └─────────────────────┘  └─────────────────────────┘  │
└─────────────────────────────────────────────────────────┘
```

---

## Critical Patterns

### 1. Always Define Both Configurations

When using `ResponsiveDataViewComponent`, you MUST provide:
- `columns` - For TableComponent (desktop)
- `cardConfig` - For ItemListComponent (mobile)

### 2. Shared Properties

These are passed to BOTH components:
- `data` - The array of items
- `actions` - TableAction[] for edit/delete/etc.
- `loading` - Loading state
- `emptyMessage` - Message when no data

### 3. Card Structure

**With Avatar (Square - for products):**
```
┌─────────────────────────────────────┐
│ [■ Img] Título         [Badge] [⋮] │
│         Subtítulo                   │
├─────────────────────────────────────┤
│ LABEL 1        │ LABEL 2           │
│ Valor 1        │ Valor 2           │
├─────────────────────────────────────┤
│ FOOTER LABEL         [Edit][Delete]│
│ $1,200.00 (prominent)              │
└─────────────────────────────────────┘
```

**With Avatar (Circle - for users/customers):**
```
┌─────────────────────────────────────┐
│ [● Img] Título         [Badge] [⋮] │
│         Subtítulo                   │
├─────────────────────────────────────┤
│ LABEL 1        │ LABEL 2           │
│ Valor 1        │ Valor 2           │
├─────────────────────────────────────┤
│ FOOTER LABEL         [Edit][Delete]│
│ $1,200.00                          │
└─────────────────────────────────────┘
```

**Avatar is OPTIONAL:** Only displayed when `avatarKey` or `avatarFallbackIcon` is configured.

### 4. New Card Config Properties

#### avatarShape - Avatar Form
- `'circle'` (default): For users, customers, people
- `'square'`: For products with images

#### footerStyle - Footer Value Style
- `'default'`: Normal value display
- `'prominent'`: Large value (22px, extra-bold) for prices/totals

```typescript
cardConfig: ItemListCardConfig = {
  titleKey: 'name',
  subtitleKey: 'brand',
  avatarKey: 'image_url',
  avatarShape: 'square',        // Square for product images
  badgeKey: 'state',
  footerKey: 'base_price',
  footerLabel: 'Precio',
  footerStyle: 'prominent',     // Large price display
  detailKeys: [
    { key: 'sku', label: 'SKU' },
    { key: 'stock', label: 'Stock' },
  ],
};
```

### 5. Action Button Styling

Action buttons have colors based on their variant:

| Variant | Color | Border | Hover BG |
|---------|-------|--------|----------|
| `default` | `#6B7280` (gray) | `#E5E7EB` | `#F9FAFB` |
| `primary` | `#3B82F6` (blue) | `#BFDBFE` | `#EFF6FF` |
| `danger` | `#EF4444` (red) | `#FECACA` | `#FEF2F2` |

**Menu Dropdown Rule:**
- ≤2 actions: Show buttons directly in footer, no menu
- \>2 actions: First 2 in footer + menu (⋮) for rest

```typescript
actions: TableAction[] = [
  { label: 'Editar', icon: 'edit', variant: 'primary', action: (item) => this.edit(item) },
  { label: 'Eliminar', icon: 'trash-2', variant: 'danger', action: (item) => this.delete(item) },
  // If 3+ actions, a menu button appears
];
```

---

## Code Examples

### Basic ResponsiveDataView Usage

```typescript
import {
  ResponsiveDataViewComponent,
  TableColumn,
  TableAction,
  ItemListCardConfig,
} from '@/shared/components';

@Component({
  imports: [ResponsiveDataViewComponent],
  template: `
    <app-responsive-data-view
      [data]="items"
      [columns]="columns"
      [cardConfig]="cardConfig"
      [actions]="actions"
      [loading]="loading"
      [emptyMessage]="'No hay datos'"
      [emptyIcon]="'inbox'"
    ></app-responsive-data-view>
  `,
})
export class MyListComponent {
  // Table columns (desktop)
  columns: TableColumn[] = [
    { key: 'name', label: 'Nombre', sortable: true, priority: 1 },
    { key: 'email', label: 'Correo', priority: 2 },
    { key: 'status', label: 'Estado', badge: true, badgeConfig: { type: 'status' } },
  ];

  // Card config (mobile) - with new properties
  cardConfig: ItemListCardConfig = {
    titleKey: 'name',
    subtitleKey: 'email',
    avatarFallbackIcon: 'user',
    avatarShape: 'circle',                // Circle for users
    badgeKey: 'status',
    badgeConfig: { type: 'status', size: 'sm' },
    detailKeys: [
      { key: 'phone', label: 'Teléfono', icon: 'phone' },
      { key: 'created_at', label: 'Fecha', transform: (v) => new Date(v).toLocaleDateString() },
    ],
    footerKey: 'total',
    footerLabel: 'Total',
    footerStyle: 'prominent',             // Large price display
    footerTransform: (v) => `$${v.toLocaleString()}`,
  };

  // Shared actions - with colored variants
  actions: TableAction[] = [
    { label: 'Editar', icon: 'edit', variant: 'primary', action: (item) => this.edit(item) },
    { label: 'Eliminar', icon: 'trash-2', variant: 'danger', action: (item) => this.delete(item) },
  ];
}
```

### ItemListCardConfig Interface

```typescript
interface ItemListCardConfig {
  // Header section
  titleKey: string;                           // Required: field for main title
  titleTransform?: (item: any) => string;     // Optional: combine fields
  subtitleKey?: string;                       // Secondary text (email, etc.)
  subtitleTransform?: (item: any) => string;

  // Avatar (OPTIONAL - only shown if either is set)
  avatarKey?: string;                         // Image URL field
  avatarFallbackIcon?: string;                // Icon when no image
  avatarShape?: 'circle' | 'square';          // NEW: Shape (default: 'circle')
  // NOTE: If neither avatarKey nor avatarFallbackIcon is set, no avatar is displayed

  // Badge
  badgeKey?: string;                          // Status field
  badgeConfig?: { type: 'status' | 'custom', size?: 'sm' | 'md' | 'lg' };
  badgeTransform?: (value: any) => string;    // Display text

  // Details grid (2 columns)
  detailKeys?: ItemListDetailField[];

  // Footer
  footerKey?: string;                         // Highlighted value
  footerLabel?: string;                       // Label above value
  footerStyle?: 'default' | 'prominent';      // NEW: Value style (default: 'default')
  footerTransform?: (value: any, item?: any) => string;
}

interface ItemListDetailField {
  key: string;
  label: string;
  transform?: (value: any, item?: any) => string;
  icon?: string;                              // Lucide icon name
}
```

### Transform Examples

```typescript
cardConfig: ItemListCardConfig = {
  // Combine fields for title
  titleKey: 'first_name',
  titleTransform: (item) => `${item.first_name} ${item.last_name}`,

  // Format currency
  footerKey: 'total_spend',
  footerTransform: (v) => new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    minimumFractionDigits: 0,
  }).format(v || 0),

  // Format date
  detailKeys: [
    {
      key: 'created_at',
      label: 'Registrado',
      transform: (v) => v ? new Date(v).toLocaleDateString() : '-',
    },
  ],

  // Status badge
  badgeKey: 'state',
  badgeTransform: (v) => v === 'active' ? 'Activo' : 'Inactivo',
};
```

---

## Migration: Table to ResponsiveDataView

### Before (Table only)

```typescript
import { TableComponent, TableColumn, TableAction } from '@/shared/components';

@Component({
  imports: [TableComponent],
  template: `
    <app-table
      [data]="items"
      [columns]="columns"
      [actions]="actions"
    ></app-table>
  `,
})
export class MyComponent {
  columns: TableColumn[] = [...];
  actions: TableAction[] = [...];
}
```

### After (ResponsiveDataView)

```typescript
import {
  ResponsiveDataViewComponent,
  TableColumn,
  TableAction,
  ItemListCardConfig,
} from '@/shared/components';

@Component({
  imports: [ResponsiveDataViewComponent],
  template: `
    <app-responsive-data-view
      [data]="items"
      [columns]="columns"
      [cardConfig]="cardConfig"
      [actions]="actions"
    ></app-responsive-data-view>
  `,
})
export class MyComponent {
  columns: TableColumn[] = [...];  // Keep existing
  actions: TableAction[] = [...];  // Keep existing

  // Add card config
  cardConfig: ItemListCardConfig = {
    titleKey: 'name',
    // ... configure based on your data
  };
}
```

---

## Badge Status Values

Pre-defined status classes that work automatically:

| Value | Color | Use Case |
|-------|-------|----------|
| `active` | Green | Active records |
| `inactive` | Orange | Disabled records |
| `pending` | Indigo | Awaiting action |
| `completed` | Green | Finished tasks |
| `suspended` | Red | Blocked accounts |
| `draft` | Gray | Unpublished |
| `warning` | Yellow | Needs attention |
| `error` | Red | Failed states |

---

## Size Variants

| Size | Card Padding | Avatar | Title | Use Case |
|------|-------------|--------|-------|----------|
| `sm` | 12px | 36px | 14px | Dense lists |
| `md` | 16px | 44px | 16px | Default |
| `lg` | 20px | 52px | 18px | Featured items |

```typescript
<app-responsive-data-view
  [itemListSize]="'sm'"
  [tableSize]="'sm'"
></app-responsive-data-view>
```

---

## Mobile Card Styles (<768px)

### Card Container
- Border-radius: 16px
- Shadow: `0 2px 8px rgba(0,0,0,0.07)`
- Gap between cards: 8px
- Background: White/Surface

### Typography

| Element | Size | Weight | Color |
|---------|------|--------|-------|
| Title | 15px | 700 | #1A1A1A |
| Subtitle | 12px | 400 | #9CA3AF |
| Detail Label | 10px | 700 | #6B7280 |
| Detail Value | 14px | 700 | #1A1A1A |
| Footer Label | 10px | 700 | #6B7280 |
| Footer Value (default) | 14px | 700 | #1A1A1A |
| Footer Value (prominent) | 22px | 800 | #1A1A1A |

### Avatar Square Variant (for products)
- Size: 56x56px
- Border-radius: 12px
- Background: #E5E7EB (when no image)

### Footer Section
- Background: Same as card (no separation line)
- Border-top: none
- Action buttons aligned to right with color variants

---

## File Locations

| Component | Path |
|-----------|------|
| TableComponent | `shared/components/table/table.component.ts` |
| ItemListComponent | `shared/components/item-list/item-list.component.ts` |
| ResponsiveDataViewComponent | `shared/components/responsive-data-view/responsive-data-view.component.ts` |
| Interfaces | `shared/components/item-list/item-list.interfaces.ts` |
| Exports | `shared/components/index.ts` |

---

## Checklist for Implementation

- [ ] Import `ResponsiveDataViewComponent` from shared components
- [ ] Define `columns: TableColumn[]` for desktop table
- [ ] Define `cardConfig: ItemListCardConfig` for mobile cards
- [ ] Define `actions: TableAction[]` (shared between both)
- [ ] Add transforms for dates, currency, status text
- [ ] Test on mobile viewport (<768px)
- [ ] Test on desktop viewport (≥768px)
- [ ] Verify actions work in both views

---

## Related Skills

- `vendix-frontend-component` - Component structure
- `vendix-frontend-standard-module` - Standard admin module layout
- `vendix-frontend-icons` - Icon usage in cards
