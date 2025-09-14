import { Injectable, inject } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { of, from } from 'rxjs';
import { map, mergeMap, catchError, tap } from 'rxjs/operators';
import { DomainDetectorService } from '../../services/domain-detector.service';
import { TenantConfigService } from '../../services/tenant-config.service';
import { TenantConfig } from '../../models/tenant-config.interface';
import * as TenantActions from './tenant.actions';

@Injectable()
export class TenantEffects {
  private actions$ = inject(Actions);
  private domainDetector = inject(DomainDetectorService);
  private tenantConfig = inject(TenantConfigService);

  initTenant$ = createEffect(() =>
    this.actions$.pipe(
      ofType(TenantActions.initTenant),
      mergeMap(({ domainConfig }) =>
        from(this.tenantConfig.loadTenantConfig(domainConfig)).pipe(
          map((tenantConfig: TenantConfig | null) => {
            if (!tenantConfig) {
              throw new Error('Failed to load tenant config');
            }
            return TenantActions.initTenantSuccess({ tenantConfig, domainConfig });
          }),
          catchError((error) =>
            of(TenantActions.initTenantFailure({ error }))
          )
        )
      )
    )
  );

  loadTenantConfig$ = createEffect(() =>
    this.actions$.pipe(
      ofType(TenantActions.loadTenantConfig),
      mergeMap(({ domainConfig }) =>
        from(this.tenantConfig.loadTenantConfig(domainConfig)).pipe(
          map((tenantConfig: TenantConfig | null) => {
            if (!tenantConfig) {
              throw new Error('Failed to load tenant config');
            }
            return TenantActions.loadTenantConfigSuccess({ tenantConfig });
          }),
          catchError((error) =>
            of(TenantActions.loadTenantConfigFailure({ error }))
          )
        )
      )
    )
  );

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