import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { CardComponent } from '../../../../shared/components/card/card.component';

@Component({
  selector: 'app-organizations',
  standalone: true,
  imports: [CommonModule, CardComponent],
  template: `
    <div class="p-6">
      <div class="mb-6">
        <h2 class="text-2xl font-bold text-gray-900">Organizaciones</h2>
        <p class="text-gray-600">Gestiona las organizaciones registradas en la plataforma</p>
      </div>
      
      <app-card class="p-6">
        <div class="text-center py-12">
          <svg class="w-16 h-16 mx-auto text-gray-400 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4"/>
          </svg>
          <h3 class="text-lg font-semibold text-gray-900 mb-2">Próximamente</h3>
          <p class="text-gray-500">Esta funcionalidad estará disponible pronto</p>
        </div>
      </app-card>
    </div>  `
})
export class OrganizationsComponent {}
