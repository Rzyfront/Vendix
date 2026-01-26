import { Component, inject, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterOutlet } from '@angular/router';
import { GlobalUserModalsComponent } from './shared/components/global-user-modals/global-user-modals.component';
import { RouteManagerService } from './core/services/route-manager.service';
import { ToastService } from './shared/components/toast/toast.service';
import { AppLoadingComponent } from './shared/components/app-loading/app-loading.component';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [
    CommonModule,
    RouterOutlet,
    GlobalUserModalsComponent,
    AppLoadingComponent,
  ],
  template: `
    @if (is_loading()) {
      <app-loading />
    } @else {
      <main>
        <router-outlet></router-outlet>
        <app-global-user-modals></app-global-user-modals>
      </main>
    }
  `,
})
export class AppComponent implements OnInit {
  private routeManager = inject(RouteManagerService);
  private toastService = inject(ToastService);

  // Signal para controlar el estado de carga
  is_loading = signal(true);

  ngOnInit() {
    // NO llamar a this.routeManager.init() aquí
    // El servicio ya se inicializa en su constructor
    this.setupRouteErrorHandling();
  }

  private setupRouteErrorHandling(): void {
    this.routeManager.routesConfigured$.subscribe({
      next: (configured) => {
        if (configured) {
          this.is_loading.set(false);
        } else {
          this.is_loading.set(false);
          this.toastService.error(
            'Error cargando las rutas de la aplicación. Por favor recarga la página.',
            'Error de Configuración',
            10000,
          );
        }
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
