import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { CardComponent } from '../../../../shared/components/card/card.component';
import { ButtonComponent } from '../../../../shared/components/button/button.component';

@Component({
  selector: 'app-register',
  standalone: true,
  imports: [CommonModule, RouterModule, CardComponent, ButtonComponent],
  template: `
    <div class="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center py-12 px-4 sm:px-6 lg:px-8">
      <div class="max-w-md w-full space-y-8">
        <div class="text-center">
          <h1 class="text-3xl font-bold text-gray-900 mb-2">Vendix</h1>
          <h2 class="text-xl text-gray-600">Registro</h2>
          <p class="mt-2 text-sm text-gray-500">
            Crea tu cuenta para comenzar
          </p>
        </div>

        <app-card class="p-8">
          <div class="text-center">
            <div class="text-6xl mb-4">🚧</div>
            <h3 class="text-xl font-semibold text-gray-700 mb-2">Próximamente</h3>
            <p class="text-gray-500 mb-6">El registro estará disponible pronto</p>
            <app-button routerLink="/auth/login" variant="primary" class="w-full">
              Ir al Login
            </app-button>
          </div>
        </app-card>

        <div class="text-center">
          <a routerLink="/" class="text-sm text-gray-500 hover:text-gray-700 transition-colors">
            ← Volver al inicio
          </a>
        </div>
      </div>
    </div>
  `
})
export class RegisterComponent {}
