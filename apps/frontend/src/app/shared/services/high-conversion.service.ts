import { DestroyRef, Injectable, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { environment } from '../../../environments/environment';
import { catchError, map, of } from 'rxjs';

/**
 * Toggle "Experiencia de Alta Conversión (Visualización Promocional)"
 * leído de `settings.promotions.enable_high_conversion_ui`.
 *
 * Cuando es `false`, todos los consumers visuales (gamified bars, tier pills,
 * badges de celebración) deben ocultarse. Cuando es `true`, el comportamiento
 * es el normal (badges visibles).
 *
 * Lee SIEMPRE del endpoint público `GET /store/settings/public` (sin auth) para
 * que el toggle funcione tanto para guests como para usuarios autenticados.
 * El endpoint público solo expone flags no-sensibles (high_conversion_ui).
 */
@Injectable({ providedIn: 'root' })
export class HighConversionService {
  private readonly http = inject(HttpClient);
  private readonly destroyRef = inject(DestroyRef);

  readonly enabled = signal<boolean>(true);

  constructor() {
    this.http
      .get<{ success: boolean; data: { enable_high_conversion_ui: boolean } }>(
        `${environment.apiUrl}/store/settings/public`,
      )
      .pipe(
        map((response) => response?.data?.enable_high_conversion_ui !== false),
        catchError((err: unknown) => {
          // Fail-safe conservador: si el endpoint público también falla
          // (500, network), ocultamos los badges. Los usuarios al menos
          // no ven celebración falsa.
          // eslint-disable-next-line no-console
          console.warn(
            '[HCS] public settings.promotions fetch failed:',
            err instanceof HttpErrorResponse
              ? `${err.status} ${err.statusText}`
              : String(err),
          );
          return of(false);
        }),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((enabled) => {
        this.enabled.set(enabled);
      });
  }
}