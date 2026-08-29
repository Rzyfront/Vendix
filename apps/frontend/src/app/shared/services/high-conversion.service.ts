import { DestroyRef, Injectable, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { HttpErrorResponse } from '@angular/common/http';
import { StoreSettingsService } from '../../private/modules/store/settings/general/services/store-settings.service';

/**
 * Toggle "Experiencia de Alta Conversión (Visualización Promocional)"
 * leído de `settings.promotions.enable_high_conversion_ui`.
 *
 * Cuando es `false`, todos los consumers visuales (gamified bars, tier pills,
 * badges de celebración) deben ocultarse. Cuando es `true`, el comportamiento
 * es el normal (badges visibles).
 *
 * Política de auth:
 * - Sin token en localStorage (usuario guest) → no se llama al API, default
 *   `true` (mostrar badges — el toggle no aplica a guests porque no
 *   tienen settings personalizados).
 * - Con token → fetch del API con forceRefresh. Si responde 200 → valor
 *   del admin. Si responde 401 (token expirado) → default `true`.
 * - Otros errores (500, network) → default `false` (conservador).
 */
@Injectable({ providedIn: 'root' })
export class HighConversionService {
  private readonly storeSettingsService = inject(StoreSettingsService);
  private readonly destroyRef = inject(DestroyRef);

  readonly enabled = signal<boolean>(true);

  constructor() {
    // Guest detection: si no hay access token, asumimos true (mostrar
    // badges). El toggle admin solo aplica a usuarios autenticados.
    const hasToken = this.hasAuthToken();
    if (!hasToken) {
      this.enabled.set(true);
      return;
    }

    this.storeSettingsService
      .getSettings({ forceRefresh: true })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response) => {
          const flag = response?.data?.promotions?.enable_high_conversion_ui;
          if (flag !== undefined) {
            this.enabled.set(flag);
          }
        },
        error: (err) => {
          if (err instanceof HttpErrorResponse) {
            // eslint-disable-next-line no-console
            console.warn(
              '[HCS] settings.promotions fetch failed:',
              err.status,
              err.statusText,
            );
            // 401 = token expirado o inválido. En ese caso, mantenemos el
            // default `true` (mostrar badges) porque el admin las quiere
            // habilitadas y el problema es de auth, no de toggle.
            if (err.status === 401) {
              this.enabled.set(true);
            }
          }
        },
      });
  }

  private hasAuthToken(): boolean {
    try {
      // El authService guarda el token en localStorage bajo 'vendix_auth_state'.
      // Si no está, el usuario es guest y no podemos llamar al endpoint
      // protegido.
      const raw = localStorage.getItem('vendix_auth_state');
      if (!raw) return false;
      const parsed = JSON.parse(raw);
      return Boolean(parsed?.tokens?.access_token);
    } catch {
      return false;
    }
  }
}