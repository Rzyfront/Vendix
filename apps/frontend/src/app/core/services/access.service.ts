import { Injectable, inject } from '@angular/core';
import { AuthFacade } from '../store/auth/auth.facade';
import { ToastService } from '../../shared/components/toast/toast.service';
import { Observable, of } from 'rxjs';
import { map, take, switchMap } from 'rxjs/operators';

@Injectable({ providedIn: 'root' })
export class AccessService {
  private authFacade = inject(AuthFacade);
  private toast = inject(ToastService);

  /**
   * Verifica si el usuario está autenticado
   */
  isAuthenticated(): Observable<boolean> {
    return this.authFacade.isAuthenticated$.pipe(take(1));
  }

  /**
   * Verifica si el usuario tiene al menos uno de los roles requeridos
   */
  hasRole(roles: string[] = []): Observable<boolean> {
    return this.authFacade.userRoles$.pipe(
      take(1),
      map(userRoles => roles.length === 0 || userRoles.some(r => roles.includes(r)))
    );
  }

  /**
   * Verifica acceso y gestiona notificación/acción
   * @param roles Roles requeridos
   * @param onDenied Acción si no tiene acceso (toast)
   * @returns Observable<boolean>
   */
  checkAccess(roles: string[] = [], onDenied?: () => void): Observable<boolean> {
    return this.isAuthenticated().pipe(
      map((isAuth: boolean) => {
        if (!isAuth) return false;
        return true;
      }),
      switchMap((isAuth: boolean) => {
        if (!isAuth) return of(false);
        return this.hasRole(roles).pipe(
          map((hasRole: boolean) => {
            if (!hasRole && onDenied) {
              this.toast.error('No tienes acceso a esta sección.');
            }
            return hasRole;
          })
        );
      })
    );
  }
}
