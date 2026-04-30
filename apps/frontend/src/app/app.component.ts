import {Component, effect, inject, signal} from '@angular/core';
import {toSignal} from '@angular/core/rxjs-interop';
import { RouterOutlet } from '@angular/router';
import { ConfigFacade } from './core/store/config';
import { RouteManagerService } from './core/services/route-manager.service';
import { ToastService } from './shared/components/toast/toast.service';
import { ToastContainerComponent } from './shared/components/toast/toast-container.component';
import { GlobalUserModalsComponent } from './shared/components/global-user-modals/global-user-modals.component';
import { AppLoadingComponent } from './shared/components/app-loading/app-loading.component';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [
    RouterOutlet,
    ToastContainerComponent,
    GlobalUserModalsComponent,
    AppLoadingComponent,
  ],
  template: `
    @if (is_loading()) {
      <app-loading />
    } @else if (config_error()) {
      <div class="min-h-screen flex items-center justify-center bg-background">
        <div class="w-full max-w-md mx-4 text-center py-8">
          <div class="text-6xl mb-4">&#x26A0;&#xFE0F;</div>
          <h2 class="text-xl font-semibold text-text-primary mb-2">
            Error de Aplicaci&oacute;n
          </h2>
          <p class="text-text-secondary mb-6">{{ config_error() }}</p>
        </div>
      </div>
    } @else {
      <main>
        <router-outlet></router-outlet>
      </main>
      <app-toast-container></app-toast-container>
      <app-global-user-modals></app-global-user-modals>
    }
  `,
  styles: `
    :host {
      color-scheme: light;
    }
  `,
})
export class AppComponent {
  private routeManager = inject(RouteManagerService);
  private configFacade = inject(ConfigFacade);
  private toastService = inject(ToastService);

  is_loading = signal(true);
  config_error = toSignal(this.configFacade.error$, {
    initialValue: null as any,
  });

  private readonly routesConfigured = toSignal(this.routeManager.routesConfigured$, {
    initialValue: false,
  });

  constructor() {
    // Track whether the boot-timeout warning is still relevant. Once routes
    // are configured (the happy path) we cancel the timeout so the spurious
    // "Boot timeout - routes did not configure" error never logs after a
    // successful boot.
    let bootTimeoutId: ReturnType<typeof setTimeout> | null = null;

    effect(() => {
      if (this.routesConfigured()) {
        this.is_loading.set(false);
        this.removePrerenderGate();
        if (bootTimeoutId !== null) {
          clearTimeout(bootTimeoutId);
          bootTimeoutId = null;
        }
      }
    });

    bootTimeoutId = setTimeout(() => {
      bootTimeoutId = null;
      // Only fire the failure path if routes actually never configured.
      if (this.routesConfigured()) return;
      this.is_loading.set(false);
      console.error('[AppComponent] Boot timeout - routes did not configure');
    }, 10000);
  }

  private removePrerenderGate(): void {
    if (typeof document === 'undefined') return;

    document.documentElement.classList.remove('vendix-prerender-hidden');
    document.getElementById('vendix-prerender-gate')?.remove();
    document.querySelector('.vendix-gate-spinner')?.remove();
  }
}
