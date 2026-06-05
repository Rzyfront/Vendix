import { Routes } from '@angular/router';
import { FiscalOperationsComponent } from './fiscal-operations.component';

export const fiscalOperationsRoutes: Routes = [
  {
    path: '',
    pathMatch: 'full',
    redirectTo: 'dashboard',
  },
  {
    path: 'dashboard',
    loadComponent: () => Promise.resolve(FiscalOperationsComponent),
    data: { tab: 'dashboard' },
  },
  {
    path: 'obligations',
    loadComponent: () => Promise.resolve(FiscalOperationsComponent),
    data: { tab: 'obligations' },
  },
  {
    path: 'declarations',
    loadComponent: () => Promise.resolve(FiscalOperationsComponent),
    data: { tab: 'declarations' },
  },
  {
    path: 'close',
    loadComponent: () => Promise.resolve(FiscalOperationsComponent),
    data: { tab: 'close' },
  },
  {
    path: 'evidence',
    loadComponent: () => Promise.resolve(FiscalOperationsComponent),
    data: { tab: 'evidence' },
  },
  {
    path: 'history',
    loadComponent: () => Promise.resolve(FiscalOperationsComponent),
    data: { tab: 'history' },
  },
  {
    path: 'rules',
    loadComponent: () => Promise.resolve(FiscalOperationsComponent),
    data: { tab: 'rules' },
  },
];
