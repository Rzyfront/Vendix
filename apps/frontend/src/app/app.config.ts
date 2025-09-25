import { ApplicationConfig, provideBrowserGlobalErrorListeners, provideZoneChangeDetection, APP_INITIALIZER, inject, isDevMode } from '@angular/core';
import { provideRouter } from '@angular/router';
import { provideHttpClient, withFetch, withInterceptorsFromDi, HTTP_INTERCEPTORS } from '@angular/common/http';
import { provideStore } from '@ngrx/store';
import { provideEffects } from '@ngrx/effects';
import { provideStoreDevtools } from '@ngrx/store-devtools';
import { provideState } from '@ngrx/store';
import { AuthInterceptor } from './core/interceptors/auth.interceptor';
import { AppInitializerService } from './core/services/app-initializer.service';
import { tenantReducer, TenantState } from './core/store/tenant';
import { TenantEffects } from './core/store/tenant';
import { authReducer, AuthState } from './core/store/auth';
import { AuthEffects } from './core/store/auth';
import { STORE_PERSISTENCE_PROVIDER, createTenantMetaReducers, createAuthMetaReducers, hydrateTenantState, hydrateAuthState } from './core/store/persistence.module';

import { routes } from './app.routes';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideZoneChangeDetection({ eventCoalescing: true }),
    provideRouter(routes),
    provideHttpClient(withFetch(), withInterceptorsFromDi()),

    // Store Persistence Service
    STORE_PERSISTENCE_PROVIDER,

    // NgRx Store Configuration
    provideStore({}, {
      runtimeChecks: {
        strictStateImmutability: true,
        strictActionImmutability: true,
        strictStateSerializability: true,
        strictActionSerializability: true,
        strictActionWithinNgZone: true,
        strictActionTypeUniqueness: true
      }
    }),
    provideState('tenant', tenantReducer, { initialState: hydrateTenantState() }),
    provideState('auth', authReducer, { initialState: hydrateAuthState() }),
    provideEffects([TenantEffects, AuthEffects]),
    provideStoreDevtools({
      maxAge: 25,
      logOnly: !isDevMode(),
      autoPause: true,
      trace: false,
      traceLimit: 75
    }),

    {
      provide: HTTP_INTERCEPTORS,
      useClass: AuthInterceptor,
      multi: true
    },
    {
      provide: APP_INITIALIZER,
      // Usar inject() dentro de la factory evita el uso de deps y es el patrón recomendado en Angular standalone
      useFactory: () => {
        const appInitializer = inject(AppInitializerService);
        return () => appInitializer.initializeApp();
      },
      multi: true
    }
  ]
};
