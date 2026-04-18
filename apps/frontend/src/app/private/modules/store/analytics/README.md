# Analytics Module

## Overview

Módulo de analíticas con patrón **Shell + Tabs** que expone 8 categorías y 26 vistas de forma organizada y accesible.

## Architecture

```
┌─────────────────────────────────────────────────────┐
│ AnalyticsShellComponent                             │
│ ┌─────────────────────────────────────────────────┐ │
│ │ Header (icon + title + description) - sticky    │ │
│ ├─────────────────────────────────────────────────┤ │
│ │ TabBar (scroll horizontal mobile, centered desk)│ │
│ ├─────────────────────────────────────────────────┤ │
│ │ <router-outlet> (child view)                   │ │
│ └─────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────┘
```

- **Shell**: Wrapper común con header y tab bar. Lee `categoryId` desde `route.data`
- **TabBar**: Navegación horizontal con scroll suave y scroll-to-active
- **Overview**:standalone (sin shell) - catálogo completo de todas las vistas

## Categories

| ID | Label | panel_ui Key | Views |
|----|-------|--------------|-------|
| overview | Resumen | analytics_overview | 1 |
| sales | Ventas | analytics_sales | 6 |
| inventory | Inventario | analytics_inventory | 5 |
| products | Productos | analytics_products | 3 |
| purchases | Compras | analytics_purchases | 2 |
| customers | Clientes | analytics_customers | 3 |
| reviews | Reseñas | analytics_reviews | 1 |
| financial | Financiero | analytics_financial | 3 |

**Total: 26 vistas**

## Adding a New View

1. **Add to registry** (`config/analytics-registry.ts`):
   ```ts
   export const ANALYTICS_VIEWS: AnalyticsView[] = [
     // ... existing views
     {
       key: 'category_viewname',
       title: 'Display Title',
       description: 'What this view shows',
       route: '/admin/analytics/{category}/view-slug',
       category: '{categoryId}',
       icon: 'lucide-icon-name',
     },
   ];
   ```

2. **Add route** (`analytics.routes.ts`):
   ```ts
   {
     path: '{category}',
     loadComponent: () => import('./components/analytics-shell/...'),
     data: { categoryId: '{categoryId}' as AnalyticsCategoryId },
     children: [
       { path: 'view-slug', loadComponent: () => import('./pages/...') },
     ],
   },
   ```

3. **Add breadcrumbs** (optional, `breadcrumb.service.ts`):
   ```ts
   {
     path: '/admin/analytics/{category}/view-slug',
     title: 'Display Title',
     parent: '{Category}',
     icon: 'icon-name',
   },
   ```

**No other files needed** - sidebar, chips, and catalog auto-update from registry.

## Routing

- `/admin/analytics/overview` - Standalone, catálogo de todas las vistas
- `/admin/analytics/{category}` - Shell con tabs, redirect a primera vista
- `/admin/analytics/{category}/{view}` - Vista individual

## panel_ui Keys

Keys que controlan visibilidad en sidebar:

| Key | Descripción |
|-----|-------------|
| analytics | Padre - sección completa |
| analytics_overview | Resumen |
| analytics_sales | Ventas |
| analytics_inventory | Inventario |
| analytics_products | Productos |
| analytics_purchases | Compras |
| analytics_customers | Clientes |
| analytics_reviews | Reseñas |
| analytics_financial | Financiero |

## File Structure

```
analytics/
├── config/
│   └── analytics-registry.ts     # Central registry (categories, views, helpers)
├── components/
│   ├── analytics-shell/         # Shell wrapper (header + tabs + outlet)
│   ├── analytics-tab-bar/       # Horizontal tab navigation
│   ├── analytics-card/          # View card for catalog
│   └── analytics-category-chips/ # Category filter chips
├── pages/
│   ├── overview/                # Standalone overview with full catalog
│   ├── sales/                    # 6 views
│   ├── inventory/               # 5 views
│   ├── products/                # 3 views
│   ├── purchases/               # 2 views
│   ├── customers/              # 3 views
│   ├── reviews/                # 1 view
│   ├── expenses/              # Standalone (no shell)
│   └── financial/             # 3 views
├── interfaces/
│   └── analytics.interface.ts
├── services/
├── analytics.routes.ts
└── index.ts
```

## Components

### AnalyticsShellComponent

- **Selector**: `app-analytics-shell`
- **Inputs**: none (reads from route data)
- **Responsibilities**: Header con categoría, tab bar, router-outlet

### AnalyticsTabBarComponent

- **Selector**: `app-analytics-tab-bar`
- **Inputs**: `tabs: AnalyticsView[]`
- **Responsibilities**: Scroll horizontal, fade gradients, scroll-to-active

### AnalyticsCardComponent

- **Selector**: `app-analytics-card`
- **Inputs**: `view: AnalyticsView`, `color: string`
- **Responsibilities**: Display card con icono, título, descripción, link

### AnalyticsCategoryChipsComponent

- **Selector**: `app-analytics-category-chips`
- **Inputs**: `categories: AnalyticsCategory[]`, `selected: string`
- **Outputs**: `categoryChange: EventEmitter<string>`
- **Responsibilities**: Single-select chips con "Todas" reset option
