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
            // QUI-656 — perfil del proveedor. Ruta lazy y no modal, igual que
            // el perfil de cliente: da URL compartible y deep-link, que es lo
            // que un modal no puede ofrecer. Va DESPUÉS de 'suppliers' para
            // que la ruta literal gane sobre el parámetro.
            {
                path: 'suppliers/:id',
                loadComponent: () =>
                    import('./suppliers/supplier-details.component').then(
                        (m) => m.SupplierDetailsComponent
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
            {
                path: 'transfers',
                loadComponent: () =>
                    import('./transfers/transfers.component').then(
                        (m) => m.TransfersComponent
                    ),
            },
            {
                path: 'movements',
                loadComponent: () =>
                    import('./movements/movements.component').then(
                        (m) => m.MovementsComponent
                    ),
            },
            {
                path: 'stock/:productId',
                loadComponent: () =>
                    import('./stock/stock-detail.component').then(
                        (m) => m.StockDetailComponent
                    ),
            },
        ],
    },
];
