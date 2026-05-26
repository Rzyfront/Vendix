import { Routes } from '@angular/router';

export const anunciosRoutes: Routes = [
  {
    path: 'create',
    loadComponent: () =>
      import('./pages/anuncio-create-wizard-page.component').then(
        (c) => c.AnuncioCreateWizardPageComponent,
      ),
  },
  {
    path: '',
    pathMatch: 'full',
    loadComponent: () =>
      import('./anuncios.component').then((c) => c.AnunciosComponent),
  },
];
