# Analytics Module

## Overview

The Analytics module provides a centralized catalog of analytics views organized by category with a shell+tabs pattern for navigation.

## Architecture

### Shell + Tabs Pattern

```
┌─ Sidebar entry (ej. "Ventas") ──► /admin/analytics/sales
│
└─ AnalyticsShellComponent (wrapper reutilizable)
   ├─ Header: título + descripción del módulo
   ├─ TabBar: tabs horizontales scrollables (mobile-first)
   └─ <router-outlet>  ◄── hija activa según tab seleccionada
```

### Key Files

| File | Purpose |
|------|---------|
| `config/analytics-registry.ts` | Central registry with all views and categories |
| `components/analytics-shell/` | Wrapper component with tabs layout |
| `components/analytics-tab-bar/` | Horizontal scrollable tab bar |
| `components/analytics-card/` | Card component for view catalog |
| `pages/*/` | Individual view components |

## Categories and Views

| Category | Route | Views |
|----------|-------|-------|
| **overview** | `/admin/analytics/overview` | Resumen General |
| **sales** | `/admin/analytics/sales` | Resumen, Por Producto, Por Categoría, Tendencias, Por Cliente, Por Método de Pago |
| **inventory** | `/admin/analytics/inventory` | Resumen, Info Stock, Movimientos, Valoración, Análisis |
| **products** | `/admin/analytics/products` | Rendimiento, Top Sellers, Rentabilidad |
| **purchases** | `/admin/analytics/purchases` | Resumen, Por Proveedor |
| **customers** | `/admin/analytics/customers` | Resumen, Adquisición, Carritos Abandonados |
| **reviews** | `/admin/analytics/reviews` | Resumen |
| **financial** | `/admin/analytics/financial` | Estado de Resultados, Impuestos, Reembolsos |

## Registry Structure

```typescript
// config/analytics-registry.ts
export interface AnalyticsView {
  key: string;           // "sales_by_product"
  title: string;         // "Por Producto"
  description: string;
  detailedDescription?: string;
  route: string;         // "/admin/analytics/sales/by-product"
  category: AnalyticsCategoryId;
  icon: string;          // lucide icon name
  comingSoon?: boolean;
}

export interface AnalyticsCategory {
  id: AnalyticsCategoryId;
  label: string;
  description: string;
  icon: string;
  color: string;
}
```

## Adding a New View

1. **Add to registry** (`config/analytics-registry.ts`):

```typescript
{
  key: 'new_view',
  title: 'Nueva Vista',
  description: 'Descripción',
  route: '/admin/analytics/category/new-view',
  category: 'categoryId',
  icon: 'chart-bar',
}
```

2. **Add route** in `analytics.routes.ts`:

```typescript
{
  path: 'new-view',
  loadComponent: () => import('./pages/category/new-view.component')
    .then(m => m.NewViewComponent),
}
```

3. **Create component** in `pages/category/`:

```typescript
// Use AnalyticsService for data fetching
// Follow the same pattern as other summary components
```

## Backend Endpoints

All analytics endpoints use the base path `/store/analytics`:

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/overview/summary` | Overview KPIs |
| GET | `/overview/trends` | Overview trends |
| GET | `/sales/summary` | Sales KPIs |
| GET | `/sales/by-product` | Sales by product |
| GET | `/inventory/summary` | Inventory KPIs |
| GET | `/customers/summary` | Customer KPIs |
| GET | `/purchases/summary` | Purchases KPIs |
| GET | `/reviews/summary` | Reviews KPIs |
| GET | `/financial/profit-loss` | P&L report |
| GET | `/financial/tax-summary` | Tax summary |

## State Management

Some categories use NgRx for state management:

| Category | State | Effects |
|----------|-------|---------|
| overview | `overviewSummary` | OverviewSummaryEffects |
| sales | `salesSummary` | SalesSummaryEffects |
| products | `productsAnalytics` | ProductsAnalyticsEffects |
| inventory | `inventoryOverview` | InventoryOverviewEffects |
| customers | `customersAnalytics` | CustomersAnalyticsEffects |

Other categories use direct service calls via `AnalyticsService`.

## Mobile UX

- Tab bar is sticky on mobile
- Horizontal scroll with scroll-snap
- Fade indicators on edges when scrollable
- Active tab auto-centers on navigation