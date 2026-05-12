import {
  ApplicationConfig,
  provideZonelessChangeDetection,
  APP_INITIALIZER,
  isDevMode,
} from '@angular/core';
import { provideRouter } from '@angular/router';
import { provideClientHydration } from '@angular/platform-browser';
import {
  provideHttpClient,
  withFetch,
  withInterceptors,
} from '@angular/common/http';
import { provideStore, Store, provideState } from '@ngrx/store';
import { provideEffects } from '@ngrx/effects';
import { provideStoreDevtools } from '@ngrx/store-devtools';
import { firstValueFrom, timeout, catchError, of, filter } from 'rxjs';
import { authInterceptorFn } from './core/interceptors/auth.interceptor';
import { subscriptionPaywallInterceptor } from './core/interceptors/subscription-paywall.interceptor';
import { RouteManagerService } from './core/services/route-manager.service';
import { tenantReducer, TenantEffects } from './core/store/tenant';
import { authReducer, AuthEffects } from './core/store/auth';
import { configReducer } from './core/store/config/config.reducer';
import { ConfigEffects } from './core/store/config/config.effects';
import {
  notificationsReducer,
  NotificationsEffects,
} from './core/store/notifications';
import { aiChatReducer } from './core/store/ai-chat/ai-chat.reducer';
import { AIChatEffects } from './core/store/ai-chat/ai-chat.effects';
import { subscriptionReducer, SubscriptionEffects } from './core/store/subscription';
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
    // SSR: routes are already configured by the server APP_INITIALIZER — skip
    if (typeof window === 'undefined') {
      return Promise.resolve(true);
    }

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
    provideZonelessChangeDetection(),
    provideRouter(routes),
    provideClientHydration(),
    provideHttpClient(
      withFetch(),
      // Order matters: auth runs first (handles 401 + token refresh) and
      // the paywall interceptor runs last so it can react to the final
      // 402/403 response after retries.
      withInterceptors([authInterceptorFn, subscriptionPaywallInterceptor]),
    ),

    // NgRx Store Configuration
    provideStore(
      {},
      {
        runtimeChecks: {
          strictStateImmutability: true,
          strictActionImmutability: true,
          strictStateSerializability: false,
          strictActionSerializability: false,
          strictActionWithinNgZone: false, // Disabled for Zoneless migration
          strictActionTypeUniqueness: true,
        },
      },
    ),
    provideState('tenant', tenantReducer),
    provideState('auth', authReducer, { initialState: hydrateAuthState() }),
    provideState('config', configReducer),
    provideState('notifications', notificationsReducer),
    provideState('aiChat', aiChatReducer),
    provideState('subscription', subscriptionReducer),
    provideEffects([TenantEffects, AuthEffects, ConfigEffects, NotificationsEffects, AIChatEffects, SubscriptionEffects]),
    provideStoreDevtools({
      maxAge: 25,
      logOnly: !isDevMode(),
      autoPause: true,
      trace: false,
      traceLimit: 75,
    }),

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
