import { Routes } from '@angular/router';
import { AdminGuard } from './core/guards/admin.guard';

export const routes: Routes = [
  // Landing page - main route
  {
    path: '',
    loadComponent: () => import('./modules/landing/landing.component').then(c => c.LandingComponent)
  },
  
  // Store/Ecommerce routes (main storefront)
  {
    path: 'store',
    loadChildren: () => import('./modules/store/store.routes').then(r => r.storeRoutes)
  },
    // Authentication routes
  {
    path: 'auth',
    loadChildren: () => import('./modules/auth/auth.routes').then(r => r.authRoutes)
  },
    // Admin routes
  {
    path: 'admin',
    loadChildren: () => import('./modules/admin/admin.routes').then(r => r.adminRoutes),
    canActivate: [AdminGuard]
  },
  
  // Organization routes
  {
    path: 'organization',
    loadChildren: () => import('./modules/organization/organization.routes').then(r => r.organizationRoutes)
  },
  
  // Wildcard route - 404 page
  {
    path: '**',
    redirectTo: '/'
  }
];
