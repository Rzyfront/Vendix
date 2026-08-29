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
 * Se auto-inicializa cuando se inyecta por primera vez. Usa `forceRefresh: true`
 * para que un cambio en admin (toggle ON/OFF) se refleje inmediatamente al
 * recargar cualquier página que consuma este servicio, sin esperar al TTL
 * del cache de 60s del StoreSettingsService.
 *
 * Default `false` (fail-safe: si la API falla por 401 o cualquier error, los
 * badges se ocultan en vez de mostrarse con un valor que no pudimos verificar).
 */
@Injectable({ providedIn: 'root' })
export class HighConversionService {
  private readonly storeSettingsService = inject(StoreSettingsService);
  private readonly destroyRef = inject(DestroyRef);

  readonly enabled = signal<boolean>(false);

  constructor() {
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
          // Política de fail-safe:
          // - 401 Unauthorized: el cart drawer probablemente no tiene el auth
          //   token configurado. Default a `true` (asumimos que el admin sí
          //   quiere la feature habilitada — el toggle real se está leyendo
          //   en otro contexto que sí tiene auth).
          // - Otros errores (500, network, etc.): default a `false` (conservador).
          if (err instanceof HttpErrorResponse) {
            // eslint-disable-next-line no-console
            console.warn(
              '[HCS] settings.promotions fetch failed:',
              err.status,
              err.statusText,
            );
            if (err.status === 401) {
              this.enabled.set(true);
            }
          }
        },
      });
  }
}