import { Component, computed, inject, signal } from '@angular/core';
import { NavigationEnd, Router, RouterLink, RouterOutlet } from '@angular/router';
import { filter } from 'rxjs/operators';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { IconComponent } from '../../../../shared/components';

@Component({
  selector: 'app-config',
  standalone: true,
  imports: [RouterOutlet, RouterLink, IconComponent],
  template: `
    <div class="w-full">
      @if (showGrid()) {
        <h1 class="text-2xl font-bold mb-6">Configuración de la organización</h1>

        <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          <a
            routerLink="/organization/config/application"
            class="block p-6 bg-white rounded-lg shadow hover:shadow-md transition-shadow"
          >
            <div class="flex items-center gap-3 mb-2">
              <app-icon name="sliders" size="20" class="text-primary"></app-icon>
              <h3 class="text-lg font-semibold">
                Configuración de la aplicación
              </h3>
            </div>
            <p class="text-gray-600">Configuración general de la aplicación</p>
          </a>

          <a
            routerLink="/organization/config/policies"
            class="block p-6 bg-white rounded-lg shadow hover:shadow-md transition-shadow"
          >
            <div class="flex items-center gap-3 mb-2">
              <app-icon name="file-text" size="20" class="text-primary"></app-icon>
              <h3 class="text-lg font-semibold">Políticas</h3>
            </div>
            <p class="text-gray-600">Políticas y reglas organizacionales</p>
          </a>

          <a
            routerLink="/organization/config/integrations"
            class="block p-6 bg-white rounded-lg shadow hover:shadow-md transition-shadow"
          >
            <div class="flex items-center gap-3 mb-2">
              <app-icon name="link-2" size="20" class="text-primary"></app-icon>
              <h3 class="text-lg font-semibold">Integraciones</h3>
            </div>
            <p class="text-gray-600">Integraciones de terceros</p>
          </a>

          <a
            routerLink="/organization/config/taxes"
            class="block p-6 bg-white rounded-lg shadow hover:shadow-md transition-shadow"
          >
            <div class="flex items-center gap-3 mb-2">
              <app-icon name="credit-card" size="20" class="text-primary"></app-icon>
              <h3 class="text-lg font-semibold">Impuestos</h3>
            </div>
            <p class="text-gray-600">Configuración y tasas de impuestos</p>
          </a>

          <a
            routerLink="/organization/config/inventory"
            class="block p-6 bg-white rounded-lg shadow hover:shadow-md transition-shadow"
          >
            <div class="flex items-center gap-3 mb-2">
              <app-icon name="warehouse" size="20" class="text-primary"></app-icon>
              <h3 class="text-lg font-semibold">Inventario</h3>
            </div>
            <p class="text-gray-600">Modo de inventario y configuración de stock</p>
          </a>

          <a
            routerLink="/organization/config/domains"
            class="block p-6 bg-white rounded-lg shadow hover:shadow-md transition-shadow"
          >
            <div class="flex items-center gap-3 mb-2">
              <app-icon name="globe-2" size="20" class="text-primary"></app-icon>
              <h3 class="text-lg font-semibold">Dominios</h3>
            </div>
            <p class="text-gray-600">Gestión de dominios</p>
          </a>

          <a
            routerLink="/organization/config/payment-methods"
            class="block p-6 bg-white rounded-lg shadow hover:shadow-md transition-shadow"
          >
            <div class="flex items-center gap-3 mb-2">
              <app-icon name="credit-card" size="20" class="text-primary"></app-icon>
              <h3 class="text-lg font-semibold">Métodos de pago</h3>
            </div>
            <p class="text-gray-600">Configuración de pago</p>
          </a>

          <a
            routerLink="/organization/config/orphan-settings"
            class="block p-6 bg-white rounded-lg shadow hover:shadow-md transition-shadow"
          >
            <div class="flex items-center gap-3 mb-2">
              <app-icon name="settings" size="20" class="text-primary"></app-icon>
              <h3 class="text-lg font-semibold">Configuración adicional</h3>
            </div>
            <p class="text-gray-600">Publicación, fuentes, flujos y panel</p>
          </a>
        </div>
      } @else {
        <router-outlet />
      }
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
      }
    `,
  ],
})
export class ConfigComponent {
  private router = inject(Router);
  readonly currentUrl = signal(this.router.url);
  readonly showGrid = computed(() => {
    const url = this.currentUrl();
    return url === '/organization/config' || url === '/organization/config/';
  });

  constructor() {
    this.router.events
      .pipe(
        filter((event) => event instanceof NavigationEnd),
        takeUntilDestroyed(),
      )
      .subscribe((event) => {
        this.currentUrl.set((event as NavigationEnd).urlAfterRedirects);
      });
  }
}
