import { DestroyRef, Injectable, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
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
 * Default `true` mientras la primera lectura no responde, para mantener
 * comportamiento existente en stores que aún no tienen la sección `promotions`.
 */
@Injectable({ providedIn: 'root' })
export class HighConversionService {
  private readonly storeSettingsService = inject(StoreSettingsService);
  private readonly destroyRef = inject(DestroyRef);

  readonly enabled = signal<boolean>(true);

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
        error: () => {
          // Default true ya está seteado
        },
      });
  }
}