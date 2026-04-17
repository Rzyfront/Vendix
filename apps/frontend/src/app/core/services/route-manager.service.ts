import { Injectable, inject, DestroyRef } from '@angular/core';
import { Router, Routes } from '@angular/router';
import { Actions, ofType } from '@ngrx/effects';
import { Store } from '@ngrx/store';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { tap } from 'rxjs/operators';
import { ReplaySubject } from 'rxjs';
import { AppConfig } from './app-config.service';
import * as ConfigActions from '../store/config/config.actions';
import { AppType } from '../models/environment.enum';
import { vendixLandingPublicRoutes } from '../../routes/public/vendix_landing.public.routes';
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

  constructor() {
    // Initialize the route manager
    this.init();
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

    // Listen for app initialization FAILURE → recover with Vendix Landing fallback
    this.actions$
      .pipe(
        ofType(ConfigActions.initializeAppFailure),
        tap(({ error }) => {
          // Dispatch success with fallback config to clear the error state
          // and allow the router-outlet to render instead of the error screen
          this.store.dispatch(
            ConfigActions.initializeAppSuccess({
              config: {
                environment: AppType.VENDIX_LANDING,
                domainConfig: {
                  hostname: window.location.hostname,
                  domainType: 'PRIMARY',
                  environment: AppType.VENDIX_LANDING,
                  isVendixDomain: true,
                  isMainVendixDomain: true,
                } as any,
                routes: vendixLandingPublicRoutes,
                layouts: [],
                branding: {} as any,
              },
            }),
          );
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

  private getFallbackRoutes(): Routes {
    return [
      ...this.getStaticAuthRoutes(),
      {
        path: '',
        loadComponent: () =>
          import('../../public/landing/vendix-landing/vendix-landing.component').then(
            (c) => c.VendixLandingComponent,
          ),
        pathMatch: 'full',
      },
      { path: '**', redirectTo: '' },
    ];
  }

  /**
   * Configure fallback routes when initialization fails or times out.
   * This is called by APP_INITIALIZER when there's a timeout.
   */
  configureFallbackRoutes(): void {
    this.router.resetConfig(this.getFallbackRoutes());
    this.routesConfigured.next(true);
  }

}
