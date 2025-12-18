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

  constructor() {
    this.actions$
      .pipe(
        ofType(ConfigActions.initializeAppSuccess),
        tap(({ config }) => this.configureDynamicRoutes(config)),
        takeUntil(this.destroy$),
      )
      .subscribe();
  }

  private configureDynamicRoutes(appConfig: AppConfig): void {
    if (!appConfig || !appConfig.routes) {
      console.error('[RouteManager] Invalid app config or routes.');
      this.router.resetConfig(this.getFallbackRoutes());
      this.routesConfigured.next(true); // Notificar incluso en caso de error para no bloquear la app
      return;
    }

    const finalRoutes = this.buildFinalRoutes(appConfig);
    this.router.resetConfig(finalRoutes);

    // Notificar que las rutas están listas
    this.routesConfigured.next(true);
  }

  private buildFinalRoutes(appConfig: AppConfig): Routes {
    const staticAuthRoutes = this.getStaticAuthRoutes();
    const dynamicAppRoutes = appConfig.routes;

    return [
      ...staticAuthRoutes,
      ...dynamicAppRoutes,
      {
        path: '**',
        loadComponent: () =>
          import(
            '../../shared/components/development-placeholder/development-placeholder.component'
          ).then((c) => c.DevelopmentPlaceholderComponent),
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

  ngOnDestroy() {
    this.destroy$.next();
    this.destroy$.complete();
  }
}
