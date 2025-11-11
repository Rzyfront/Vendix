import { Injectable, inject } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { tap } from 'rxjs/operators';
import * as TenantActions from './tenant.actions';

@Injectable()
export class TenantEffects {
  private actions$ = inject(Actions);

  // Los effects initTenant$ y loadTenantConfig$ han sido eliminados.
  // Su lógica ahora es manejada por ConfigEffects para centralizar la inicialización.

  initTenantSuccess$ = createEffect(() =>
    this.actions$.pipe(
      ofType(TenantActions.initTenantSuccess),
      tap(({ tenantConfig, domainConfig }) => {
        console.log('[Tenant Effects] Tenant initialized successfully:', {
          domain: domainConfig.hostname,
          environment: domainConfig.environment,
          hasConfig: !!tenantConfig
        });
      })
    ),
    { dispatch: false }
  );

  initTenantFailure$ = createEffect(() =>
    this.actions$.pipe(
      ofType(TenantActions.initTenantFailure),
      tap(({ error }) => {
        console.error('[Tenant Effects] Failed to initialize tenant:', error);
      })
    ),
    { dispatch: false }
  );
}
