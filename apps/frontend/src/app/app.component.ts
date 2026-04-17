import {Component, effect, inject, OnInit, signal, DestroyRef} from '@angular/core';
import {toSignal, takeUntilDestroyed} from '@angular/core/rxjs-interop';
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
export class AppComponent implements OnInit {
  private destroyRef = inject(DestroyRef);
  private routeManager = inject(RouteManagerService);
  private configFacade = inject(ConfigFacade);
  private toastService = inject(ToastService);

  is_loading = signal(true);
  config_error = toSignal(this.configFacade.error$, {
    initialValue: null as any,
  });

  constructor() {
    effect(() => {
      if (!this.is_loading()) {
        this.removePrerenderGate();
      }
    });
  }

  ngOnInit() {
    this.setupRouteErrorHandling();
  }

  private removePrerenderGate(): void {
    if (typeof document === 'undefined') return;

    document.documentElement.classList.remove('vendix-prerender-hidden');
    document.getElementById('vendix-prerender-gate')?.remove();
    document.querySelector('.vendix-gate-spinner')?.remove();
  }

  private setupRouteErrorHandling(): void {
    this.routeManager.routesConfigured$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (configured) => {
        this.is_loading.set(!configured);
      },
      error: (error) => {
        console.error('[AppComponent] Route manager error:', error);
        this.is_loading.set(false);
        this.toastService.error(
          'Ocurrió un error al cargar la aplicación',
          'Error de Inicialización',
          10000,
        );
      },
    });
  }
}
