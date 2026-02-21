import {
  ApplicationConfig,
  provideZoneChangeDetection,
  APP_INITIALIZER,
  isDevMode,
} from '@angular/core';
import { provideRouter } from '@angular/router';
import {
  provideHttpClient,
  withFetch,
  withInterceptorsFromDi,
  HTTP_INTERCEPTORS,
} from '@angular/common/http';
import { provideStore, Store, provideState } from '@ngrx/store';
import { provideEffects } from '@ngrx/effects';
import { provideStoreDevtools } from '@ngrx/store-devtools';
import { firstValueFrom, timeout, catchError, of, filter } from 'rxjs';
import { AuthInterceptor } from './core/interceptors/auth.interceptor';
import { RouteManagerService } from './core/services/route-manager.service';
import { tenantReducer, TenantEffects } from './core/store/tenant';
import { authReducer, AuthEffects } from './core/store/auth';
import { configReducer } from './core/store/config/config.reducer';
import { ConfigEffects } from './core/store/config/config.effects';
import {
  notificationsReducer,
  NotificationsEffects,
} from './core/store/notifications';
import { hydrateAuthState } from './core/store/persistence';
import * as ConfigActions from './core/store/config/config.actions';
import { ThemeService } from './core/services/theme.service';
import { ToastService } from './shared/components/toast/toast.service';

import { routes } from './app.routes';

// Timeout for app initialization (10 seconds)
const APP_INIT_TIMEOUT_MS = 10000;

// Factory para el APP_INITIALIZER
export function initializeApp(
  store: Store,
  routeManager: RouteManagerService,
): () => Promise<boolean> {
  return () => {
    store.dispatch(ConfigActions.initializeApp());

    // Add timeout to prevent infinite blocking
    // CRITICAL: Wait specifically for routes to be TRUE
    return firstValueFrom(
      routeManager.routesConfigured$.pipe(
        filter((configured) => configured === true),
        timeout(APP_INIT_TIMEOUT_MS),
        catchError((error) => {
          console.error(
            '[APP_INITIALIZER] Timeout or error waiting for routes:',
            error,
          );
          // Return true to allow the app to continue with fallback routes
          routeManager.configureFallbackRoutes();
          return of(true);
        }),
      ),
    );
  };
}

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
    provideState('notifications', notificationsReducer),
    provideEffects([TenantEffects, AuthEffects, ConfigEffects, NotificationsEffects]),
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
    {
      provide: APP_INITIALIZER,
      useFactory: initializeApp,
      deps: [Store, RouteManagerService],
      multi: true,
    },
    ThemeService,
    ToastService,
  ],
};
