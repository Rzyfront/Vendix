import { Component, Input, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ButtonComponent } from '../../index';
import { ConfigFacade } from '../../../../core/store/config';

@Component({
    selector: 'app-landing-layout',
    standalone: true,
    imports: [CommonModule, ButtonComponent],
    template: `
    <div class="landing-layout min-h-screen flex flex-col bg-[var(--color-background)]">
      <!-- Header -->
      <header class="sticky top-0 z-50 w-full border-b border-[rgba(0,0,0,0.05)] backdrop-blur-md bg-[rgba(255,255,255,0.8)] dark:bg-[rgba(0,0,0,0.8)] transition-all">
        <div class="container mx-auto px-4 h-16 flex items-center justify-between">
          
          <!-- Logo / Brand Name -->
          <div class="flex items-center gap-3">
             <img
              *ngIf="logoUrl"
              [src]="logoUrl"
              [alt]="brandName"
              class="h-8 w-auto object-contain"
            />
            <span *ngIf="!logoUrl" class="text-xl font-bold tracking-tight text-[var(--color-text-primary)]">
              {{ brandName }}
            </span>
          </div>

          <!-- Navigation Actions -->
          <nav class="flex items-center gap-4">
            <app-button 
                variant="ghost" 
                (clicked)="navigateToLogin()">
              Iniciar Sesión
            </app-button>
            <app-button 
                variant="primary" 
                (clicked)="navigateToShop()">
              Tienda
            </app-button>
          </nav>
        </div>
      </header>

      <!-- Main Content -->
      <main class="flex-grow">
        <ng-content></ng-content>
      </main>

      <!-- Simple Footer -->
      <footer class="border-t border-[rgba(0,0,0,0.05)] py-8 bg-[var(--color-surface)]">
        <div class="container mx-auto px-4 text-center text-sm text-[var(--color-text-muted)]">
          &copy; {{ currentYear }} {{ brandName }}. Powered by Vendix.
        </div>
      </footer>
    </div>
  `,
    styles: []
})
export class LandingLayoutComponent {
    @Input() brandName: string = 'Store';
    @Input() logoUrl?: string;

    private configFacade = inject(ConfigFacade);

    get currentYear() {
        return new Date().getFullYear();
    }

    navigateToLogin() {
        window.location.href = '/auth/login';
    }

    navigateToShop() {
        window.location.href = '/shop'; // Or resolve dynamically via router
    }
}
