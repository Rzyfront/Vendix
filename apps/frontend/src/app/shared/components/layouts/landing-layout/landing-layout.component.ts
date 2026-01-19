import { Component, Input, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ConfigFacade } from '../../../../core/store/config';
import { IconComponent } from '../../icon/icon.component'; // Ensure IconComponent is imported

@Component({
  selector: 'app-landing-layout',
  standalone: true,
  imports: [CommonModule, IconComponent], // Add IconComponent to imports
  template: `
    <div
      class="landing-layout min-h-screen flex flex-col bg-[var(--color-background)]"
    >
      <!-- Header (Matching VendixLandingComponent style) -->
      <header
        class="fixed top-0 left-0 right-0 z-50 bg-white/80 backdrop-blur-xl border-b border-[var(--color-border)] shadow-sm"
      >
        <div class="container mx-auto px-4 sm:px-6 lg:px-8">
          <div class="flex items-center justify-between h-16">
            <!-- Logo / Brand Name -->
            <div class="flex items-center gap-3">
              <img
                *ngIf="logoUrl"
                [src]="logoUrl"
                [alt]="brandName"
                class="h-8 w-auto object-contain"
              />
              <!-- If no logo, show brand name or fallback icon like Vendix -->
              <div
                *ngIf="!logoUrl"
                class="w-10 h-10 bg-[var(--color-primary)] rounded-xl flex items-center justify-center"
              >
                <!-- Use a generic icon or the first letter if needed, or just the text next to it -->
                <app-icon name="cart" [size]="24" color="white"></app-icon>
              </div>
              <span
                *ngIf="!logoUrl"
                class="text-xl font-semibold text-[var(--color-text-primary)]"
              >
                {{ brandName }}
              </span>
            </div>

            <!-- Navigation Actions -->
            <nav class="hidden md:flex items-center space-x-8">
              <!-- Only Login button as requested -->
              <a
                (click)="navigateToLogin()"
                class="cursor-pointer text-[var(--color-text-secondary)] hover:text-[var(--color-primary)] transition-colors duration-200 font-medium"
              >
                Iniciar Sesión
              </a>
            </nav>

            <!-- Mobile Menu Button (Simplified for layout) -->
            <button
              class="md:hidden p-2 rounded-lg hover:bg-gray-100 transition-colors duration-200"
              (click)="navigateToLogin()"
            >
              <app-icon
                name="user"
                [size]="24"
                color="var(--color-text-primary)"
              ></app-icon>
            </button>
          </div>
        </div>
      </header>

      <!-- Main Content (Added padding-top because header is fixed) -->
      <main class="flex-grow pt-16">
        <ng-content></ng-content>
      </main>

      <!-- Simple Footer (Matching style) -->
      <footer
        class="bg-[var(--color-text-primary)] text-white py-8 border-t border-white/20"
      >
        <div class="container mx-auto px-4 text-center text-sm text-white/70">
          &copy; {{ currentYear }} {{ brandName }}. Powered by Vendix.
        </div>
      </footer>
    </div>
  `,
  styles: [],
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
}
