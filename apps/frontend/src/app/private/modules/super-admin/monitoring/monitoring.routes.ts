import { Routes } from '@angular/router';
import { MonitoringService } from './services';

export const MONITORING_ROUTES: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./monitoring-layout.component').then(
        (c) => c.MonitoringLayoutComponent,
      ),
    providers: [MonitoringService],
    children: [
      {
        path: '',
        pathMatch: 'full',
        redirectTo: 'overview',
      },
      {
        path: 'overview',
        loadComponent: () =>
          import('./pages/overview/monitoring-overview.page').then(
            (c) => c.MonitoringOverviewPage,
          ),
      },
      {
        path: 'infrastructure',
        loadComponent: () =>
          import('./pages/infrastructure/monitoring-infrastructure.page').then(
            (c) => c.MonitoringInfrastructurePage,
          ),
      },
      {
        path: 'performance',
        loadComponent: () =>
          import('./pages/performance/monitoring-performance.page').then(
            (c) => c.MonitoringPerformancePage,
          ),
      },
      {
        path: 'health',
        loadComponent: () =>
          import('./pages/health/monitoring-health.page').then(
            (c) => c.MonitoringHealthPage,
          ),
      },
    ],
  },
];
