import { Routes } from '@angular/router';

export const INVENTORY_ROUTES: Routes = [
    {
        path: '',
        loadComponent: () =>
            import('./inventory.component').then((m) => m.InventoryComponent),
        children: [
            {
                path: '',
                pathMatch: 'full',
                redirectTo: 'pop',
            },
            // Punto de Compra (POP) - Creating purchase orders
            {
                path: 'pop/:id?',
                loadComponent: () =>
                    import('./pop/pop.component').then(
                        (m) => m.PopComponent
                    ),
            },
            {
                path: 'suppliers',
                loadComponent: () =>
                    import('./suppliers/suppliers.component').then(
                        (m) => m.SuppliersComponent
                    ),
            },
            /* PopComponent kept, orders removed */
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
