import { Injectable } from '@angular/core';
import { Store } from '@ngrx/store';
import { AuthState } from './auth.reducer';
import * as AuthActions from './auth.actions';

@Injectable({ providedIn: 'root' })
export class AuthInitService {
  private readonly LOCALSTORAGE_KEY = 'vendix_auth_state';

  constructor(private store: Store) {}

  initAuthState(): void {
    try {
      // Verificar si el usuario hizo logout recientemente (prevenir auto-login no deseado)
      const loggedOutRecently = localStorage.getItem(
        'vendix_logged_out_recently',
      );
      if (loggedOutRecently) {
        const logoutTime = parseInt(loggedOutRecently);
        const currentTime = Date.now();
        // Si hace menos de 5 minutos del logout, no restaurar sesión automáticamente
        if (currentTime - logoutTime < 5 * 60 * 1000) {
          console.log(
            '[AuthInitService] Logout reciente detectado, omitiendo restauración automática',
          );
          localStorage.removeItem('vendix_logged_out_recently');
          return;
        }
        // Si pasaron más de 5 minutos, limpiar la bandera
        localStorage.removeItem('vendix_logged_out_recently');
      }

      const raw = localStorage.getItem(this.LOCALSTORAGE_KEY);
      if (!raw) return;

      const parsed = JSON.parse(raw);

      // Validación adicional: asegurar que los datos de sesión sean válidos
      if (!parsed || !parsed.user || !parsed.tokens) {
        console.warn(
          '[AuthInitService] Datos de autenticación inválidos o incompletos',
        );
        localStorage.removeItem(this.LOCALSTORAGE_KEY);
        return;
      }

      // Validar que el token de acceso no esté vacío
      if (!parsed.tokens.accessToken) {
        console.warn('[AuthInitService] Token de acceso no encontrado');
        localStorage.removeItem(this.LOCALSTORAGE_KEY);
        return;
      }

      // Si pasa todas las validaciones, restaurar el estado
      this.store.dispatch(
        AuthActions.restoreAuthState({
          user: parsed.user,
          user_settings: parsed.user_settings,
          tokens: parsed.tokens,
          permissions: parsed.permissions || [],
          roles: parsed.roles || [],
        }),
      );
    } catch (e) {
      // Si hay error, limpiar datos corruptos y no restaurar nada
      console.warn(
        '[AuthInitService] Error restaurando estado de autenticación:',
        e,
      );
      localStorage.removeItem(this.LOCALSTORAGE_KEY);
      localStorage.removeItem('vendix_logged_out_recently');
    }
  }
}
