import { Routes } from '@angular/router';

/**
 * STORE_HOME public routes (Apps · Fase 5): the entry page of the store's
 * `{tienda}-store` domain once the owner publishes the store home. Only `/`;
 * `/auth/login` is the shared static auth route, unchanged.
 */
export const storeHomePublicRoutes: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('../../public/store-home/store-home.component').then(
        (c) => c.StoreHomeComponent,
      ),
  },
  {
    // Flujos: public request form by link (no login; store from the domain).
    path: 'flujos/:token',
    loadComponent: () =>
      import('../../public/ecommerce/pages/workflow-public-form/workflow-public-form.component').then(
        (c) => c.WorkflowPublicFormComponent,
      ),
  },
];
