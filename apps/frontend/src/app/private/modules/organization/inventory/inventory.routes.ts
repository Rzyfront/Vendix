import { Routes } from '@angular/router';

export const orgInventoryRoutes: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./inventory.component').then((c) => c.OrgInventoryComponent),
    children: [
      {
        path: '',
        loadComponent: () =>
          import('./pages/dashboard/dashboard.component').then(
            (c) => c.OrgInventoryDashboardComponent,
          ),
      },
      {
        path: 'stock-levels',
        loadComponent: () =>
          import('./pages/stock-levels/stock-levels.component').then(
            (c) => c.OrgStockLevelsComponent,
          ),
      },
      {
        path: 'locations',
        loadComponent: () =>
          import('./pages/locations/locations.component').then(
            (c) => c.OrgLocationsComponent,
          ),
      },
      {
        path: 'movements',
        loadComponent: () =>
          import('./pages/movements/movements.component').then(
            (c) => c.OrgMovementsComponent,
          ),
      },
      {
        path: 'suppliers',
        loadComponent: () =>
          import('./pages/suppliers/suppliers.component').then(
            (c) => c.OrgSuppliersComponent,
          ),
      },
      {
        path: 'transfers',
        loadComponent: () =>
          import('./pages/transfers/transfers.component').then(
            (c) => c.OrgTransfersComponent,
          ),
      },
      {
        path: 'adjustments',
        loadComponent: () =>
          import('./pages/adjustments/adjustments.component').then(
            (c) => c.OrgAdjustmentsComponent,
          ),
      },
    ],
  },
];
