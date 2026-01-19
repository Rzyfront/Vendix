import { Injectable, inject } from '@angular/core';
import { CanActivate, Router, UrlTree } from '@angular/router';
import { ToastService } from '../../shared/components/toast/toast.service';
import { AuthFacade } from '../store/auth/auth.facade';
import { Observable } from 'rxjs';
import { map, take, withLatestFrom } from 'rxjs/operators';

@Injectable({
  providedIn: 'root',
})
export class NotFoundGuard implements CanActivate {
  private router = inject(Router);
  private toastService = inject(ToastService);
  private authFacade = inject(AuthFacade);

  canActivate(): Observable<boolean | UrlTree> {
    return this.authFacade.isAuthenticated$.pipe(
      take(1),
      withLatestFrom(this.authFacade.userSettings$),
      map(([isAuthenticated, userSettings]) => {
        this.toastService.error('La ruta solicitada no existe', 'Error 404');

        if (!isAuthenticated) {
          return this.router.parseUrl('/auth/login');
        }

        const appType = userSettings?.config?.app?.toUpperCase();

        switch (appType) {
          case 'ORG_ADMIN':
            return this.router.parseUrl('/admin/dashboard');
          case 'STORE_ADMIN':
            return this.router.parseUrl('/store/dashboard');
          case 'VENDIX_ADMIN':
            return this.router.parseUrl('/superadmin/dashboard');
          case 'STORE_ECOMMERCE':
            return this.router.parseUrl('/home');
          default:
            return this.router.parseUrl('/');
        }
      }),
    );
  }
}
