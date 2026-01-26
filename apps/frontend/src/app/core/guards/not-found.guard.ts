import { Injectable, inject } from '@angular/core';
import { CanActivate, Router, UrlTree } from '@angular/router';
import { ToastService } from '../../shared/components/toast/toast.service';

/**
 * NotFoundGuard - Simple guard for catch-all route.
 *
 * Strategy:
 * - If someone navigates to a route that doesn't exist in their current app,
 *   redirect them to "/" (the initial route of their app) and show a toast.
 * - No need to check authentication here - AuthGuard handles protected routes.
 * - Keep it simple to avoid initialization issues.
 */
@Injectable({
  providedIn: 'root',
})
export class NotFoundGuard implements CanActivate {
  private router = inject(Router);
  private toastService = inject(ToastService);

  canActivate(): UrlTree {
    // Show toast notification
    this.toastService.warning(
      'La ruta solicitada no existe o no está disponible',
      'Ruta no encontrada',
    );

    // Always redirect to home - the initial route of the current app
    return this.router.parseUrl('/');
  }
}
