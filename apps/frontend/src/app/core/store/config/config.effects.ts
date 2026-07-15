import { Injectable, inject } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { from, of, Observable } from 'rxjs';
import { switchMap, map, catchError, tap } from 'rxjs/operators';
import { Action, Store } from '@ngrx/store';
import {
  AppConfigService,
  DomainResolutionError,
} from '../../services/app-config.service';
import { ThemeService } from '../../services/theme.service';
import { ManifestService } from '../../services/manifest.service';
import * as ConfigActions from './config.actions';
import * as TenantActions from '../tenant/tenant.actions';

@Injectable()
export class ConfigEffects {
  private actions$ = inject(Actions);
  private appConfigService = inject(AppConfigService);
  private themeService = inject(ThemeService);
  private manifestService = inject(ManifestService);
  private store = inject(Store);

  /**
   * Cadena de resolución compartida por `initializeApp` y `retryResolution`.
   * Convierte la Promise de setupConfig en Observable y mapea cualquier fallo
   * a un payload tipado con `kind`. Un `DomainResolutionError` conserva su
   * clasificación; cualquier otro error se trata como `transient` (permite
   * reintento). NUNCA se degrada a VENDIX_LANDING.
   */
  private runResolution$(): Observable<Action> {
    return from(this.appConfigService.setupConfig()).pipe(
      map((config) => ConfigActions.initializeAppSuccess({ config })),
      catchError((error: unknown) =>
        of(
          ConfigActions.initializeAppFailure({
            error: {
              kind:
                error instanceof DomainResolutionError
                  ? error.kind
                  : 'transient',
              message: error instanceof Error ? error.message : undefined,
            },
          }),
        ),
      ),
    );
  }

  initializeApp$ = createEffect(() =>
    this.actions$.pipe(
      ofType(ConfigActions.initializeApp),
      switchMap(() => this.runResolution$()),
    ),
  );

  retryResolution$ = createEffect(() =>
    this.actions$.pipe(
      ofType(ConfigActions.retryResolution),
      switchMap(() => this.runResolution$()),
    ),
  );

  initializeAppSuccess$ = createEffect(
    () =>
      this.actions$.pipe(
        ofType(ConfigActions.initializeAppSuccess),
        tap(({ config }) => {
          // Una vez que la configuración es exitosa, podemos realizar tareas secundarias
          // como aplicar el tema y actualizar otros stores.
          this.themeService.applyAppConfiguration(config);
          // Inyecta el Web App Manifest dinámico por hostname/tenant para que la
          // SPA sea instalable con la marca correcta (nombre, iconos, color).
          this.manifestService.applyManifest(config.domainConfig);
          this.store.dispatch(
            TenantActions.setDomainConfig({
              domainConfig: config.domainConfig,
            }),
          );
        }),
      ),
    { dispatch: false }, // No despachamos nuevas acciones desde aquí
  );
}
