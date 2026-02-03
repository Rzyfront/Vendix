import { Injectable, inject, signal, computed } from '@angular/core';
import { Router } from '@angular/router';
import { Store } from '@ngrx/store';
import { ToastService } from '../../shared/components/toast/toast.service';
import * as AuthActions from '../store/auth/auth.actions';

export type LogoutReason = 'explicit' | 'session_expired' | 'token_refresh_failed';

/**
 * SessionService - Coordina el cierre de sesión de forma centralizada.
 *
 * Responsabilidades:
 * - Evitar múltiples logouts simultáneos
 * - Mostrar UN solo toast apropiado según la razón del cierre
 * - Suprimir notificaciones redundantes de otros componentes
 * - Coordinar la navegación post-logout
 *
 * NOTA: No inyecta TokenRefreshTimerService para evitar dependencia circular.
 * El timer es detenido por auth.effects.ts en logoutSuccess$.
 */
@Injectable({ providedIn: 'root' })
export class SessionService {
  private router = inject(Router);
  private store = inject(Store);
  private toast = inject(ToastService);

  // Signal para rastrear si la sesión se está terminando
  private _isTerminating = signal(false);
  private _terminationReason = signal<LogoutReason | null>(null);

  // Computed signals públicos (readonly)
  readonly isTerminating = this._isTerminating.asReadonly();
  readonly terminationReason = computed(() => this._terminationReason());

  // Flag interno para evitar múltiples logouts simultáneos
  private logoutInProgress = false;

  /**
   * Termina la sesión de forma limpia y controlada.
   * Solo se ejecuta una vez, llamadas subsecuentes son ignoradas.
   *
   * @param reason - Razón del cierre de sesión:
   *   - 'explicit': Usuario hizo clic en "Cerrar sesión"
   *   - 'session_expired': La sesión expiró naturalmente
   *   - 'token_refresh_failed': El refresh token falló
   */
  terminateSession(reason: LogoutReason): void {
    // Evitar múltiples ejecuciones
    if (this.logoutInProgress || this._isTerminating()) {
      console.log('[SessionService] Logout already in progress, ignoring');
      return;
    }

    this.logoutInProgress = true;
    this._isTerminating.set(true);
    this._terminationReason.set(reason);

    console.log(`[SessionService] Terminating session. Reason: ${reason}`);

    // 1. Limpiar toasts existentes para evitar confusión
    this.toast.clear();

    // 2. Mostrar toast apropiado según la razón
    this.showTerminationToast(reason);

    // 3. Limpiar estado de auth y localStorage
    this.store.dispatch(AuthActions.logout({ redirect: false }));

    // 4. Limpiar user environment para que la app use el domain app_type al recargar
    this.clearUserEnvironment();

    // 5. Hacer un hard redirect a "/" para reiniciar la app con el environment correcto
    //    Delay de 1.5s para que el usuario pueda ver el toast antes del redirect
    setTimeout(() => {
      this._isTerminating.set(false);
      this._terminationReason.set(null);
      this.logoutInProgress = false;
      console.log('[SessionService] Session terminated, redirecting to landing');

      // Hard redirect para reiniciar la app con el environment del dominio
      window.location.href = '/';
    }, 1500);
  }

  /**
   * Limpia el user environment del localStorage.
   * Esto permite que AppConfigService use el domain app_type al reiniciar.
   */
  private clearUserEnvironment(): void {
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem('vendix_user_environment');
      localStorage.removeItem('vendix_app_config');
      console.log('[SessionService] User environment cleared');
    }
  }

  /**
   * Muestra el toast apropiado según la razón del cierre.
   */
  private showTerminationToast(reason: LogoutReason): void {
    switch (reason) {
      case 'explicit':
        this.toast.success(
          'Has cerrado sesión correctamente',
          'Sesión cerrada',
        );
        break;
      case 'session_expired':
      case 'token_refresh_failed':
        this.toast.info(
          'Tu sesión ha expirado. Por favor inicia sesión nuevamente.',
          'Sesión expirada',
        );
        break;
    }
  }

  /**
   * Verifica si se deben suprimir notificaciones/acciones
   * durante el proceso de cierre de sesión.
   *
   * Usar en guards, interceptors y componentes para evitar
   * mostrar toasts redundantes durante el logout.
   */
  shouldSuppressNotifications(): boolean {
    return this._isTerminating();
  }
}
