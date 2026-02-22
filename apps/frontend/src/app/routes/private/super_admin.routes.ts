import { Routes } from '@angular/router';
import { AuthGuard } from '../../core/guards/auth.guard';

export const superAdminRoutes: Routes = [
  {
    path: 'super-admin',
    loadComponent: () =>
      import(
        '../../private/layouts/super-admin/super-admin-layout.component'
      ).then((c) => c.SuperAdminLayoutComponent),
    canActivate: [AuthGuard], // O un guardia específico para Super Admin
    children: [
      {
        path: '',
        pathMatch: 'full',
        redirectTo: 'dashboard',
      },
      {
        path: 'dashboard',
        loadComponent: () =>
          import(
            '../../private/modules/super-admin/dashboard/dashboard.component'
          ).then((c) => c.DashboardComponent),
      },
      {
        path: 'organizations',
        loadComponent: () =>
          import(
            '../../private/modules/super-admin/organizations/organizations.component'
          ).then((c) => c.OrganizationsComponent),
      },
      {
        path: 'users',
        loadComponent: () =>
          import(
            '../../private/modules/super-admin/users/users.component'
          ).then((c) => c.UsersComponent),
      },
      {
        path: 'roles',
        loadComponent: () =>
          import(
            '../../private/modules/super-admin/roles/roles.component'
          ).then((c) => c.RolesComponent),
      },
      {
        path: 'payment-methods',
        loadComponent: () =>
          import(
            '../../private/modules/super-admin/payment-methods/payment-methods.component'
          ).then((c) => c.PaymentMethodsComponent),
      },
      {
        path: 'stores',
        loadComponent: () =>
          import(
            '../../private/modules/super-admin/stores/stores.component'
          ).then((c) => c.StoresComponent),
      },
      {
        path: 'audit',
        loadComponent: () =>
          import(
            '../../private/modules/super-admin/audit/audit.component'
          ).then((c) => c.AuditComponent),
      },
      {
        path: 'domains',
        loadComponent: () =>
          import(
            '../../private/modules/super-admin/domains/domains.component'
          ).then((c) => c.DomainsComponent),
      },
      {
        path: 'currencies',
        loadComponent: () =>
          import(
            '../../private/modules/super-admin/currencies/currencies.component'
          ).then((c) => c.CurrenciesComponent),
      },
      {
        path: 'system/templates',
        loadComponent: () =>
          import(
            '../../private/modules/super-admin/templates/templates.component'
          ).then((c) => c.TemplatesComponent),
      },
      {
        path: 'settings/shipping',
        loadComponent: () =>
          import(
            '../../private/modules/super-admin/shipping/shipping.component'
          ).then((c) => c.ShippingLayoutComponent),
      },
      {
        path: 'legal-documents',
        loadComponent: () =>
          import(
            '../../private/modules/super-admin/legal-documents/legal-documents.component'
          ).then((c) => c.LegalDocumentsComponent),
      },
      // Placeholder routes - modules under construction
      {
        path: 'billing',
        loadComponent: () =>
          import(
            '../../shared/components/under-construction/under-construction.component'
          ).then((c) => c.UnderConstructionComponent),
        data: { title: 'Facturación', description: 'El módulo de facturación está siendo desarrollado.' },
      },
      {
        path: 'support',
        loadChildren: () =>
          import('../../private/modules/super-admin/support/support.routes').then(
            (m) => m.SUPPORT_ROUTES
          ),
      },
      {
        path: 'analytics/platform',
        loadComponent: () =>
          import(
            '../../shared/components/under-construction/under-construction.component'
          ).then((c) => c.UnderConstructionComponent),
        data: { title: 'Analíticas de Plataforma', description: 'Las analíticas de plataforma estarán disponibles próximamente.' },
      },
      {
        path: 'analytics/users',
        loadComponent: () =>
          import(
            '../../shared/components/under-construction/under-construction.component'
          ).then((c) => c.UnderConstructionComponent),
        data: { title: 'Analíticas de Usuarios', description: 'Las analíticas de usuarios estarán disponibles próximamente.' },
      },
      {
        path: 'analytics/performance',
        loadComponent: () =>
          import(
            '../../shared/components/under-construction/under-construction.component'
          ).then((c) => c.UnderConstructionComponent),
        data: { title: 'Rendimiento', description: 'El módulo de rendimiento está siendo desarrollado.' },
      },
      {
        path: 'system/settings',
        loadComponent: () =>
          import(
            '../../shared/components/under-construction/under-construction.component'
          ).then((c) => c.UnderConstructionComponent),
        data: { title: 'Configuración del Sistema', description: 'La configuración del sistema está siendo desarrollada.' },
      },
      {
        path: 'system/logs',
        loadComponent: () =>
          import(
            '../../shared/components/under-construction/under-construction.component'
          ).then((c) => c.UnderConstructionComponent),
        data: { title: 'Registros del Sistema', description: 'Los registros del sistema estarán disponibles próximamente.' },
      },
      {
        path: 'system/backups',
        loadComponent: () =>
          import(
            '../../shared/components/under-construction/under-construction.component'
          ).then((c) => c.UnderConstructionComponent),
        data: { title: 'Copias de Seguridad', description: 'El módulo de copias de seguridad está siendo desarrollado.' },
      },
    ],
  },
];
