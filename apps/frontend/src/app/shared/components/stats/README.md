# Stats Component Usage Example

The new `app-stats` component can replace the repetitive stats card code throughout the application.

## Basic Usage

```html
<!-- Single stat card -->
<app-stats title="Total Products" [value]="totalProducts" iconName="package" iconBgColor="bg-primary/10" iconColor="text-primary"></app-stats>

<!-- With small text -->
<app-stats title="Revenue" [value]="formatCurrency(revenue)" smallText="vs last month" iconName="dollar-sign" iconBgColor="bg-green-100" iconColor="text-green-600"></app-stats>
```

## Replacing POS Stats Component

The original `pos-stats.component.ts` template with 77 lines can be reduced to:

```html
<div class="grid grid-cols-1 md:grid-cols-3 gap-6">
  <app-stats title="Productos en Carrito" [value]="cartState?.items?.length || 0" iconName="package" iconBgColor="bg-primary/10" iconColor="text-primary"></app-stats>

  <app-stats title="Cantidad Total" [value]="getTotalQuantity()" iconName="hash" iconBgColor="bg-blue-100" iconColor="text-blue-600"></app-stats>

  <app-stats title="Total Carrito" [value]="formatCurrency(getTotalAmount())" iconName="dollar-sign" iconBgColor="bg-green-100" iconColor="text-green-600"></app-stats>
</div>
```

## Replacing Store Stats Component

The original `store-stats.component.html` with 126 lines can be reduced to:

```html
<div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
  <app-stats title="Total Tienda" [value]="stats?.totalStores || 0" [smallText]="getGrowthPercentage(stats?.storesGrowthRate || 0) + ' vs mes anterior'" iconName="building" iconBgColor="bg-primary/10" iconColor="text-primary"></app-stats>

  <app-stats title="Activas" [value]="stats?.activeStores || 0" [smallText]="getGrowthPercentage(stats?.activeStoresGrowthRate || 0) + ' vs mes anterior'" iconName="check-circle" iconBgColor="bg-green-100" iconColor="text-green-600"></app-stats>

  <app-stats title="Total de Pedidos" [value]="formatNumber(stats?.totalOrders || 0)" [smallText]="getGrowthPercentage(stats?.ordersGrowthRate || 0) + ' vs mes anterior'" iconName="shopping-cart" iconBgColor="bg-pink-100" iconColor="text-pink-600"></app-stats>

  <app-stats title="Total Ganancias" [value]="formatCurrency(stats?.totalRevenue || 0)" [smallText]="getGrowthPercentage(stats?.revenueGrowthRate || 0) + ' vs mes anterior'" iconName="dollar-sign" iconBgColor="bg-blue-100" iconColor="text-blue-600"></app-stats>
</div>
```

## Component Properties

- `title` (required): The main title displayed above the value
- `value` (required): The main value to display (string or number)
- `smallText` (optional): Small text displayed below the value
- `iconName` (optional): Icon name from the icon registry (default: 'info')
- `iconBgColor` (optional): Background color for the icon container (default: 'bg-primary/10')
- `iconColor` (optional): Color class for the icon (default: 'text-primary')
- `clickable` (optional): Whether the card should have hover effects and cursor pointer (default: true)

## Benefits

1. **Reduced Code Duplication**: Eliminates repetitive HTML structure
2. **Consistency**: Ensures all stats cards have the same styling and behavior
3. **Maintainability**: Changes to stats card design only need to be made in one place
4. **Flexibility**: Easy to customize colors, icons, and content
5. **Type Safety**: Full TypeScript support with proper input types
