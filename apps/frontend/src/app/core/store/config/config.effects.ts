import { Injectable, inject } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { from, of } from 'rxjs';
import { switchMap, map, catchError, tap } from 'rxjs/operators';
import { Store } from '@ngrx/store';
import { AppConfigService } from '../../services/app-config.service';
import { ThemeService } from '../../services/theme.service';
import * as ConfigActions from './config.actions';
import * as TenantActions from '../tenant/tenant.actions';

@Injectable()
export class ConfigEffects {
  private actions$ = inject(Actions);
  private appConfigService = inject(AppConfigService);
  private themeService = inject(ThemeService);
  private store = inject(Store);

  initializeApp$ = createEffect(() =>
    this.actions$.pipe(
      ofType(ConfigActions.initializeApp),
      switchMap(() =>
        // Usamos from() para convertir la Promise de setupConfig en un Observable
        from(this.appConfigService.setupConfig()).pipe(
          map(config => ConfigActions.initializeAppSuccess({ config })),
          catchError(error => of(ConfigActions.initializeAppFailure({ error })))
        )
      )
    )
  );

  initializeAppSuccess$ = createEffect(() =>
    this.actions$.pipe(
      ofType(ConfigActions.initializeAppSuccess),
      tap(({ config }) => {
        // Una vez que la configuración es exitosa, podemos realizar tareas secundarias
        // como aplicar el tema y actualizar otros stores.
        this.themeService.applyAppConfiguration(config);
        this.store.dispatch(TenantActions.setDomainConfig({ domainConfig: config.domainConfig }));
      })
    ),
    { dispatch: false } // No despachamos nuevas acciones desde aquí
  );
}
