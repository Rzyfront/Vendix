import { Routes } from '@angular/router';

export const INVENTORY_ROUTES: Routes = [
    {
        path: '',
        loadComponent: () =>
            import('./inventory.component').then((m) => m.InventoryComponent),
        children: [
            {
                path: '',
                loadComponent: () =>
                    import('./inventory-dashboard.component').then(
                        (m) => m.InventoryDashboardComponent
                    ),
            },
            {
                path: 'suppliers',
                loadComponent: () =>
                    import('./suppliers/suppliers.component').then(
                        (m) => m.SuppliersComponent
                    ),
            },
            {
                path: 'orders',
                loadComponent: () =>
                    import('./purchase-orders/purchase-orders.component').then(
                        (m) => m.PurchaseOrdersComponent
                    ),
            },
            {
                path: 'orders/new',
                loadComponent: () =>
                    import('./purchase-orders/pop/pop.component').then(
                        (m) => m.PopComponent
                    ),
            },
            {
                path: 'locations',
                loadComponent: () =>
                    import('./locations/locations.component').then(
                        (m) => m.LocationsComponent
                    ),
            },
            {
                path: 'adjustments',
                loadComponent: () =>
                    import('./operations/stock-adjustments.component').then(
                        (m) => m.StockAdjustmentsComponent
                    ),
            },
        ],
    },
];
