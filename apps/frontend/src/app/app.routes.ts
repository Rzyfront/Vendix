import { Routes } from '@angular/router';


/**
 * Rutas estáticas base de la aplicación.
 * El RouteManagerService se encarga de añadir las rutas dinámicas.
 */
export const routes: Routes = [
  // Ruta raíz - gestionada dinámicamente por DomainGuard para determinar el entorno inicial.
  // El componente real será cargado por el RouteManager.
  {
    path: '',
    pathMatch: 'full',
    // The component is just a placeholder that will be replaced by the RouteManager.
    loadComponent: () => import('./shared/components/development-placeholder/development-placeholder.component').then(c => c.DevelopmentPlaceholderComponent),
  },

  // Rutas de autenticación que siempre deben estar disponibles.
  {
    path: 'auth',
    children: [
      {
        path: 'login',
        loadComponent: () => import('./public/auth/components/contextual-login/contextual-login.component').then(c => c.ContextualLoginComponent),
        data: { isPublic: true }
      },
      {
        path: 'register',
        loadComponent: () => import('./public/auth/components/register-owner/register-owner.component').then(c => c.RegisterOwnerComponent),
        data: { isPublic: true }
      },
      {
        path: 'forgot-owner-password',
        loadComponent: () => import('./public/auth/components/forgot-owner-password/forgot-owner-password').then(c => c.ForgotOwnerPasswordComponent),
        data: { isPublic: true }
      },
      {
        path: 'reset-owner-password',
        loadComponent: () => import('./public/auth/components/reset-owner-password/reset-owner-password').then(c => c.ResetOwnerPasswordComponent),
        data: { isPublic: true }
      },
      {
        path: 'verify-email',
        loadComponent: () => import('./public/auth/components/email-verification/email-verification.component').then(c => c.EmailVerificationComponent),
        data: { isPublic: true }
      },
    ]
  },

  // Ruta wildcard (404) - se redirige a la raíz, donde el DomainGuard y el RouteManager decidirán qué mostrar.
  {
    path: '**',
    redirectTo: ''
  }
];
