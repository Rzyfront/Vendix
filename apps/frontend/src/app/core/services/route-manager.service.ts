import { Injectable, inject, DestroyRef } from '@angular/core';
import { Router, Routes } from '@angular/router';
import { Actions, ofType } from '@ngrx/effects';
import { Store } from '@ngrx/store';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { tap } from 'rxjs/operators';
import { ReplaySubject } from 'rxjs';
import { AppConfig } from './app-config.service';
import * as ConfigActions from '../store/config/config.actions';
import { LandingOnlyGuard } from '../guards/landing-only.guard';

@Injectable({
  providedIn: 'root',
})
export class RouteManagerService {
  private router = inject(Router);
  private actions$ = inject(Actions);
  private store = inject(Store);
  private destroyRef = inject(DestroyRef);

  private routesConfigured = new ReplaySubject<boolean>(1);
  public routesConfigured$ = this.routesConfigured.asObservable();

  private initialized = false;
  private bootTimeout: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    // Initialize the route manager
    this.init();
    this.startBootTimeout();
  }

  private startBootTimeout(): void {
    if (typeof window === 'undefined') return;

    this.bootTimeout = setTimeout(() => {
      // Bug fix: previously this checked `!this.routesConfigured`, but
      // `routesConfigured` is a ReplaySubject (always truthy), so the
      // fallback never fired. Use the explicit `initialized_complete`
      // flag which flips to true the moment configureDynamicRoutes runs.
      this.bootTimeout = null;
      if (!this.initialized_complete) {
        console.warn(
          '[RouteManagerService] Boot timeout - routes not configured after 5s, marking transient failure',
        );
        // NO degradar a landing. Marcamos un fallo transitorio tipado; el
        // handler de initializeAppFailure configura rutas neutras y libera
        // el APP_INITIALIZER, y la UI mostrará el estado de error.
        this.store.dispatch(
          ConfigActions.initializeAppFailure({ error: { kind: 'transient' } }),
        );
      }
    }, 5000);
  }

  /**
   * Initialize the route manager and start listening for configuration changes
   */
  init(): void {
    // Prevenir doble inicialización
    if (this.initialized) {
      return;
    }
    this.initialized = true;

    // Listen for app initialization SUCCESS
    this.actions$
      .pipe(
        ofType(ConfigActions.initializeAppSuccess),
        tap(({ config }) => this.configureDynamicRoutes(config)),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe();

    // Listen for app initialization FAILURE.
    // NO degradar a VENDIX_LANDING: el fallo debe quedar como fallo. El store
    // ya expone `resolutionError` (tipado) para que la UI muestre la pantalla
    // de error. Aquí solo configuramos rutas NEUTRAS (auth + catch-all, sin el
    // landing) para que el router no rompa y para liberar el APP_INITIALIZER.
    this.actions$
      .pipe(
        ofType(ConfigActions.initializeAppFailure),
        tap(() => {
          this.configureFallbackRoutes();
        }),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe();
  }

  /**
   * Configure dynamic routes based on the provided app configuration.
   * Public method to allow manual reconfiguration (e.g., during environment switch).
   */
  public configureDynamicRoutes(appConfig: AppConfig): void {
    if (this.bootTimeout) {
      clearTimeout(this.bootTimeout);
      this.bootTimeout = null;
    }

    // Si no tenemos config válida, fallback inmediato
    if (!appConfig || !appConfig.routes) {
      this.router.resetConfig(this.getFallbackRoutes());
      this.routesConfigured.next(true);
      return;
    }

    const finalRoutes = this.buildFinalRoutes(appConfig);

    // Si es la inicialización (la app no está lista), hacerlo síncrono
    // para no romper el APP_INITIALIZER
    if (!this.initialized_complete) {
      this.router.resetConfig(finalRoutes);
      this.initialized_complete = true;
      this.routesConfigured.next(true);
    } else {
      // Si es un cambio en caliente (switch de entorno), poner loading y usar delay para fluidez
      this.routesConfigured.next(false);
      setTimeout(() => {
        this.router.resetConfig(finalRoutes);
        this.routesConfigured.next(true);
      }, 100);
    }
  }

  private initialized_complete = false;

  private buildFinalRoutes(appConfig: AppConfig): Routes {
    const staticAuthRoutes = this.getStaticAuthRoutes();
    const dynamicAppRoutes = appConfig.routes;

    return [
      ...staticAuthRoutes,
      ...dynamicAppRoutes,
      // Catch-all route: redirect to home and show toast via component
      {
        path: '**',
        loadComponent: () =>
          import('../../shared/components/not-found-redirect/not-found-redirect.component').then(
            (c) => c.NotFoundRedirectComponent,
          ),
      },
    ];
  }

  private getStaticAuthRoutes(): Routes {
    return [
      {
        path: 'auth',
        canActivate: [LandingOnlyGuard],
        children: [
          {
            path: 'login',
            loadComponent: () =>
              import('../../public/auth/components/contextual-login/contextual-login.component').then(
                (c) => c.ContextualLoginComponent,
              ),
          },
          {
            path: 'register',
            loadComponent: () =>
              import('../../public/auth/components/register-owner/register-owner.component').then(
                (c) => c.RegisterOwnerComponent,
              ),
          },
          {
            path: 'forgot-owner-password',
            loadComponent: () =>
              import('../../public/auth/components/forgot-owner-password/forgot-owner-password').then(
                (c) => c.ForgotOwnerPasswordComponent,
              ),
          },
          {
            path: 'reset-owner-password',
            loadComponent: () =>
              import('../../public/auth/components/reset-owner-password/reset-owner-password').then(
                (c) => c.ResetOwnerPasswordComponent,
              ),
          },
          {
            path: 'verify-email',
            loadComponent: () =>
              import('../../public/auth/components/email-verification/email-verification.component').then(
                (c) => c.EmailVerificationComponent,
              ),
          },
        ],
      },
    ];
  }

  /**
   * Rutas NEUTRAS de recuperación cuando la resolución falla o expira.
   *
   * CRÍTICO: NUNCA montan `VendixLandingComponent`. El landing de Vendix SOLO
   * debe montarse cuando la resolución devuelve app_type = VENDIX_LANDING
   * explícitamente (vía initializeAppSuccess → configureDynamicRoutes).
   *
   * Se limitan a las rutas de auth + una raíz vacía sin contenido y un
   * catch-all que redirige a ella, de modo que el router no rompa mientras la
   * UI (app.component) muestra el estado de error tipado sobre el outlet.
   */
  private getFallbackRoutes(): Routes {
    return [
      ...this.getStaticAuthRoutes(),
      { path: '', children: [] },
      { path: '**', redirectTo: '' },
    ];
  }

  /**
   * Configure neutral recovery routes when initialization fails or times out.
   * Called by the initializeAppFailure handler (and as a safety net). Does NOT
   * mount the Vendix landing.
   */
  configureFallbackRoutes(): void {
    if (this.bootTimeout) {
      clearTimeout(this.bootTimeout);
      this.bootTimeout = null;
    }
    this.router.resetConfig(this.getFallbackRoutes());
    this.routesConfigured.next(true);
  }

}
