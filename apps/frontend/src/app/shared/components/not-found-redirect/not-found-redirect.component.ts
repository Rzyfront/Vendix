import { Component, inject, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { Store } from '@ngrx/store';
import { take } from 'rxjs/operators';
import { combineLatest } from 'rxjs';
import { ToastService } from '../toast/toast.service';
import {
  selectIsAuthenticated,
  selectSelectedAppType,
} from '../../../core/store/auth/auth.selectors';
import { AppEnvironment } from '../../../core/models/domain-config.interface';

/**
 * NotFoundRedirectComponent - Smart redirect component for catch-all route.
 *
 * Strategy:
 * - If NOT authenticated → redirect to "/" (landing page)
 * - If authenticated → redirect to the initial route of their current app
 *
 * App initial routes:
 * - VENDIX_LANDING → /
 * - VENDIX_ADMIN → /superadmin/dashboard
 * - ORG_LANDING → /
 * - ORG_ADMIN → /admin/dashboard
 * - STORE_ADMIN → /admin/dashboard
 * - STORE_ECOMMERCE → /
 * - STORE_LANDING → /
 */
@Component({
  selector: 'app-not-found-redirect',
  standalone: true,
  template: '',
})
export class NotFoundRedirectComponent implements OnInit {
  private router = inject(Router);
  private toastService = inject(ToastService);
  private store = inject(Store);

  private readonly APP_REDIRECT_MAP: Record<string, string> = {
    [AppEnvironment.VENDIX_LANDING]: '/',
    [AppEnvironment.VENDIX_ADMIN]: '/super-admin/dashboard',
    [AppEnvironment.ORG_LANDING]: '/',
    [AppEnvironment.ORG_ADMIN]: '/admin/dashboard',
    [AppEnvironment.STORE_ADMIN]: '/admin/dashboard',
    [AppEnvironment.STORE_ECOMMERCE]: '/',
    [AppEnvironment.STORE_LANDING]: '/',
  };

  ngOnInit(): void {
    // Show toast notification
    this.toastService.warning(
      'La ruta solicitada no existe o no está disponible',
      'Ruta no encontrada',
    );

    // Get user state and redirect
    combineLatest([
      this.store.select(selectIsAuthenticated),
      this.store.select(selectSelectedAppType),
    ])
      .pipe(take(1))
      .subscribe(([isAuthenticated, appType]) => {
        const redirectUrl = this.getRedirectUrl(isAuthenticated, appType);
        this.router.navigate([redirectUrl]);
      });
  }

  private getRedirectUrl(isAuthenticated: boolean, appType: string): string {
    const defaultRedirect = '/';

    if (!isAuthenticated) {
      return defaultRedirect; // Redirect to landing
    }

    // Get redirect URL based on app type
    return this.APP_REDIRECT_MAP[appType] || '/admin/dashboard';
  }
}
