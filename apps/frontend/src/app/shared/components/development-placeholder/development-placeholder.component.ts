import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';

@Component({
  selector: 'app-development-placeholder',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="flex items-center justify-center h-full min-h-96">
      <div class="text-center">
        <div
          class="w-24 h-24 mx-auto mb-6 flex items-center justify-center rounded-2xl bg-gradient-to-br from-[var(--color-primary)]/20 to-[var(--color-primary)]/10 border border-[var(--color-primary)]/30 shadow-lg"
        >
          <i class="fas fa-hard-hat text-3xl text-[var(--color-primary)]"></i>
        </div>
        <h2
          class="text-2xl font-semibold text-[var(--color-text-primary)] mb-2"
        >
          En Desarrollo
        </h2>
        <p class="text-[var(--color-text-muted)] max-w-md mb-6">
          Esta funcionalidad está actualmente en desarrollo y estará disponible
          pronto.
        </p>
        <button
          (click)="goBack()"
          class="px-6 py-2 bg-[var(--color-primary)] text-white rounded-lg hover:bg-[var(--color-primary-hover)] transition-colors duration-200 flex items-center gap-2 mx-auto"
        >
          <i class="fas fa-arrow-left"></i>
          Volver
        </button>
      </div>
    </div>
  `,
  styles: ``,
})
export class DevelopmentPlaceholderComponent {
  constructor(private router: Router) {}

  goBack(): void {
    window.history.back();
  }
}
