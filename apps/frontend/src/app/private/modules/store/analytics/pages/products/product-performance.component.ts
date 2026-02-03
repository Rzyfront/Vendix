import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { IconComponent } from '../../../../../../shared/components/icon/icon.component';

@Component({
  selector: 'vendix-product-performance',
  standalone: true,
  imports: [CommonModule, RouterModule, IconComponent],
  template: `
    <div class="space-y-6 w-full max-w-[1600px] mx-auto py-4">
      <div class="flex items-center gap-2 text-sm text-text-secondary mb-1">
        <a routerLink="/admin/reports" class="hover:text-primary">Reportes</a>
        <app-icon name="chevron-right" [size]="14"></app-icon>
        <span>Productos</span>
      </div>
      <h1 class="text-2xl font-bold text-text-primary">Rendimiento de Productos</h1>
      <div class="bg-surface border border-border rounded-xl p-8 text-center">
        <app-icon name="bar-chart-2" [size]="48" class="text-text-tertiary mx-auto mb-4"></app-icon>
        <h3 class="text-lg font-semibold text-text-primary">Próximamente</h3>
        <p class="text-text-secondary mt-2">El reporte de rendimiento de productos estará disponible pronto.</p>
      </div>
    </div>
  `,
})
export class ProductPerformanceComponent {}
