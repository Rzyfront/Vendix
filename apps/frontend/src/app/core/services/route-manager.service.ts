import { Injectable, inject, OnDestroy } from '@angular/core';
import { Router, Routes } from '@angular/router';
import { Actions, ofType } from '@ngrx/effects';
import { takeUntil, tap } from 'rxjs/operators';
import { ReplaySubject, Subject } from 'rxjs';
import { AppConfig } from './app-config.service';
import * as ConfigActions from '../store/config/config.actions';

@Injectable({
  providedIn: 'root',
})
export class RouteManagerService implements OnDestroy {
  private router = inject(Router);
  private actions$ = inject(Actions);
  private destroy$ = new Subject<void>();

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
        takeUntil(this.destroy$),
      )
      .subscribe();

    // Listen for app initialization FAILURE
    this.actions$
      .pipe(
        ofType(ConfigActions.initializeAppFailure),
        tap(({ error }) => {
          console.error('[RouteManager] App initialization failed:', error);
          // Usar rutas de fallback para no bloquear la app
          this.router.resetConfig(this.getFallbackRoutes());
          this.routesConfigured.next(true);
        }),
        takeUntil(this.destroy$),
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
      console.error('[RouteManager] Invalid app config or routes.');
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
          import(
            '../../shared/components/not-found-redirect/not-found-redirect.component'
          ).then((c) => c.NotFoundRedirectComponent),
      },
    ];
  }

  private getStaticAuthRoutes(): Routes {
    return [
      {
        path: 'auth',
        children: [
          {
            path: 'login',
            loadComponent: () =>
              import(
                '../../public/auth/components/contextual-login/contextual-login.component'
              ).then((c) => c.ContextualLoginComponent),
          },
          {
            path: 'register',
            loadComponent: () =>
              import(
                '../../public/auth/components/register-owner/register-owner.component'
              ).then((c) => c.RegisterOwnerComponent),
          },
          {
            path: 'forgot-owner-password',
            loadComponent: () =>
              import(
                '../../public/auth/components/forgot-owner-password/forgot-owner-password'
              ).then((c) => c.ForgotOwnerPasswordComponent),
          },
          {
            path: 'reset-owner-password',
            loadComponent: () =>
              import(
                '../../public/auth/components/reset-owner-password/reset-owner-password'
              ).then((c) => c.ResetOwnerPasswordComponent),
          },
          {
            path: 'verify-email',
            loadComponent: () =>
              import(
                '../../public/auth/components/email-verification/email-verification.component'
              ).then((c) => c.EmailVerificationComponent),
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
          import(
            '../../public/landing/vendix-landing/vendix-landing.component'
          ).then((c) => c.VendixLandingComponent),
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
    console.warn('[RouteManager] Configuring fallback routes due to timeout');
    this.router.resetConfig(this.getFallbackRoutes());
    this.routesConfigured.next(true);
  }

  ngOnDestroy() {
    this.destroy$.next();
    this.destroy$.complete();
  }
}
