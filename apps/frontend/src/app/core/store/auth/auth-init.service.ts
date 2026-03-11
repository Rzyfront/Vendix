import { Injectable, inject } from '@angular/core';
import { Store } from '@ngrx/store';
import { AuthState } from './auth.reducer';
import * as AuthActions from './auth.actions';
import { TokenRefreshTimerService } from '../../services/token-refresh-timer.service';

@Injectable({ providedIn: 'root' })
export class AuthInitService {
  private readonly LOCALSTORAGE_KEY = 'vendix_auth_state';
  private tokenRefreshTimer = inject(TokenRefreshTimerService);

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
          localStorage.removeItem('vendix_logged_out_recently');
          return;
        }
        // Si pasaron más de 5 minutos, limpiar la bandera
        localStorage.removeItem('vendix_logged_out_recently');
      }

      const raw = localStorage.getItem(this.LOCALSTORAGE_KEY);
      if (!raw) return;

      const parsed = JSON.parse(raw);

      if (!parsed || !parsed.user || !parsed.tokens) {
        localStorage.removeItem(this.LOCALSTORAGE_KEY);
        return;
      }

      // Validar que el token de acceso no esté vacío
      // Support both camelCase and snake_case token formats
      const accessToken =
        parsed.tokens.accessToken || parsed.tokens.access_token;
      if (!accessToken) {
        localStorage.removeItem(this.LOCALSTORAGE_KEY);
        return;
      }

      // Calculate remaining token lifetime and start proactive refresh timer
      const expiresInMs = this.calculateRemainingTokenTime(accessToken);
      if (expiresInMs > 0) {
        this.tokenRefreshTimer.startTimer(expiresInMs);
      } else {
        localStorage.removeItem(this.LOCALSTORAGE_KEY);
        return;
      }

      // Si pasa todas las validaciones, restaurar el estado
      this.store.dispatch(
        AuthActions.restoreAuthState({
          user: parsed.user,
          user_settings: parsed.user_settings,
          store_settings: parsed.store_settings,
          default_panel_ui: parsed.default_panel_ui,
          tokens: parsed.tokens,
          permissions: parsed.permissions || [],
          roles: parsed.roles || [],
        }),
      );
    } catch (e) {
      localStorage.removeItem(this.LOCALSTORAGE_KEY);
      localStorage.removeItem('vendix_logged_out_recently');
    }
  }

  /**
   * Decodes a JWT token and calculates the remaining time until expiration.
   * @param token - The JWT access token
   * @returns Remaining time in milliseconds, or 0 if token is expired or invalid
   */
  private calculateRemainingTokenTime(token: string): number {
    try {
      const payload = JSON.parse(atob(token.split('.')[1]));
      if (!payload.exp) {
        return 60 * 60 * 1000;
      }

      const expirationMs = payload.exp * 1000;
      const now = Date.now();
      const remainingMs = expirationMs - now;

      return remainingMs > 0 ? remainingMs : 0;
    } catch (error) {
      return 0;
    }
  }
}
