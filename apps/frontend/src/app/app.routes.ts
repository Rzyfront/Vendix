import { Routes } from '@angular/router';


/**
 * Rutas estáticas base de la aplicación.
 * El RouteManagerService se encarga de añadir las rutas dinámicas.
 *
 * IMPORTANTE: Estas rutas son temporales y serán reemplazadas por RouteManagerService
 * durante la inicialización de la aplicación.
 */
export const routes: Routes = [
  // Ruta temporal para evitar bucles de redirección durante la inicialización
  // Esta ruta será reemplazada por RouteManagerService con las rutas dinámicas
  {
    path: '**',
    loadComponent: () => import('./shared/components/development-placeholder/development-placeholder.component').then(c => c.DevelopmentPlaceholderComponent),
  }
];
