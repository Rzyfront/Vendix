import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { CardComponent } from '../../../../shared/components/card/card.component';

@Component({
  selector: 'app-users',
  standalone: true,
  imports: [CommonModule, CardComponent],
  template: `
    <div class="p-6">
      <div class="mb-6">
        <h2 class="text-2xl font-bold text-gray-900">Usuarios</h2>
        <p class="text-gray-600">Gestiona los usuarios del sistema</p>
      </div>
      
      <app-card class="p-6">
        <div class="text-center py-12">
          <svg class="w-16 h-16 mx-auto text-gray-400 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197m13.5-9a2.5 2.5 0 11-5 0 2.5 2.5 0 015 0z"/>
          </svg>
          <h3 class="text-lg font-semibold text-gray-900 mb-2">Próximamente</h3>
          <p class="text-gray-500">Esta funcionalidad estará disponible pronto</p>
        </div>
      </app-card>
    </div>
  `
})
export class UsersComponent {}
