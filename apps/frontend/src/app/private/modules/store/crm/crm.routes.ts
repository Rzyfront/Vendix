import { Routes } from '@angular/router';

export const crmRoutes: Routes = [
  {
    path: '',
    loadComponent: () =>
      import(
        './pages/crm-main-page/crm-main-page.component'
      ).then((c) => c.CrmMainPageComponent),
  },
  {
    path: 'builder',
    loadComponent: () =>
      import(
        './pages/crm-builder/crm-builder.component'
      ).then((c) => c.CrmBuilderComponent),
  },
];
