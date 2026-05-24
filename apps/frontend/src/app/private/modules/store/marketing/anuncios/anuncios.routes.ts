import { Routes } from '@angular/router';

export const anunciosRoutes: Routes = [
  {
    path: 'create',
    loadComponent: () =>
      import('./pages/anuncio-create-page.component').then(
        (c) => c.AnuncioCreatePageComponent,
      ),
  },
  {
    path: '',
    pathMatch: 'full',
    loadComponent: () =>
      import('./anuncios.component').then((c) => c.AnunciosComponent),
  },
];
