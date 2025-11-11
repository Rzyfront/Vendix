import {
  ApplicationConfig,
  provideZoneChangeDetection,
  APP_INITIALIZER,
  inject,
  isDevMode,
} from '@angular/core';
import { provideRouter } from '@angular/router';
import {
  provideHttpClient,
  withFetch,
  withInterceptorsFromDi,
  HTTP_INTERCEPTORS,
} from '@angular/common/http';
import { provideStore, Store } from '@ngrx/store';
import { provideEffects } from '@ngrx/effects';
import { provideStoreDevtools } from '@ngrx/store-devtools';
import { provideState } from '@ngrx/store';
import { firstValueFrom } from 'rxjs';
import { AuthInterceptor } from './core/interceptors/auth.interceptor';
import { RouteManagerService } from './core/services/route-manager.service';
import { tenantReducer, TenantEffects } from './core/store/tenant';
import { authReducer, AuthEffects } from './core/store/auth';
import { configReducer } from './core/store/config/config.reducer';
import { ConfigEffects } from './core/store/config/config.effects';
import { hydrateAuthState } from './core/store/persistence';
import * as ConfigActions from './core/store/config/config.actions';

import { routes } from './app.routes';

export const appConfig: ApplicationConfig = {
  providers: [
    provideZoneChangeDetection({ eventCoalescing: true }),
    provideRouter(routes),
    provideHttpClient(withFetch(), withInterceptorsFromDi()),

    // NgRx Store Configuration
    provideStore(
      {},
      {
        runtimeChecks: {
          strictStateImmutability: true,
          strictActionImmutability: true,
          strictStateSerializability: false,
          strictActionSerializability: false,
          strictActionWithinNgZone: true,
          strictActionTypeUniqueness: true,
        },
      },
    ),
    provideState('tenant', tenantReducer),
    provideState('auth', authReducer, { initialState: hydrateAuthState() }),
    provideState('config', configReducer),
    provideEffects([TenantEffects, AuthEffects, ConfigEffects]),
    provideStoreDevtools({
      maxAge: 25,
      logOnly: !isDevMode(),
      autoPause: true,
      trace: false,
      traceLimit: 75,
    }),

    {
      provide: HTTP_INTERCEPTORS,
      useClass: AuthInterceptor,
      multi: true,
    },
  ],
};
