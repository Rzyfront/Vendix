import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { CardComponent } from '../../../../shared/components/card/card.component';

@Component({
  selector: 'app-analytics',
  standalone: true,
  imports: [CommonModule, CardComponent],
  template: `
    <div class="p-6">
      <div class="mb-6">
        <h2 class="text-2xl font-bold text-gray-900">Análisis</h2>
        <p class="text-gray-600">Reportes y métricas de la plataforma</p>
      </div>
      
      <app-card class="p-6">
        <div class="text-center py-12">
          <svg class="w-16 h-16 mx-auto text-gray-400 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"/>
          </svg>
          <h3 class="text-lg font-semibold text-gray-900 mb-2">Próximamente</h3>
          <p class="text-gray-500">Esta funcionalidad estará disponible pronto</p>
        </div>
      </app-card>
    </div>
  `
})
export class AnalyticsComponent {}
