import { Routes } from '@angular/router';
import { operatingScopeGuard } from '../../../../core/guards/operating-scope.guard';

export const orgInventoryRoutes: Routes = [
  {
    path: '',
    canActivate: [operatingScopeGuard],
    data: {
      requiredOperatingScope: 'ORGANIZATION',
      lockedTooltip:
        'Selecciona una tienda para administrar inventario en modo STORE.',
    },
    loadComponent: () =>
      import('./inventory.component').then((c) => c.OrgInventoryComponent),
    children: [
      {
        path: '',
        redirectTo: 'stock-levels',
        pathMatch: 'full',
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
      {
        path: 'serial-numbers',
        loadComponent: () =>
          import('./pages/serial-numbers/serial-numbers.component').then(
            (c) => c.OrgSerialNumbersComponent,
          ),
      },
      {
        path: 'batches',
        loadComponent: () =>
          import('./pages/batches/batches.component').then(
            (c) => c.OrgBatchesComponent,
          ),
      },
    ],
  },
];
