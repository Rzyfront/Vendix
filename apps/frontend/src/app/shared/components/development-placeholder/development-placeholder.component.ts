import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-development-placeholder',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="flex items-center justify-center h-full min-h-96">
      <div class="text-center">
        <div class="w-24 h-24 mx-auto mb-6 flex items-center justify-center rounded-full bg-muted">
          <i class="fas fa-tools text-3xl text-muted-foreground"></i>
        </div>
        <h2 class="text-2xl font-semibold text-foreground mb-2">En Desarrollo</h2>
        <p class="text-muted-foreground max-w-md">
          Esta funcionalidad está actualmente en desarrollo y estará disponible pronto.
        </p>
      </div>
    </div>
  `,
  styles: ``
})
export class DevelopmentPlaceholderComponent {}