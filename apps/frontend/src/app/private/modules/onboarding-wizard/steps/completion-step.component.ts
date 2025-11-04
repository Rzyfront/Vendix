import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { OnboardingWizardService } from '../../../../core/services/onboarding-wizard.service';

@Component({
  selector: 'app-completion-step',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="max-w-2xl mx-auto text-center space-y-6">
      <div class="mb-8">
        <div class="text-6xl mb-4 animate-bounce">🎉</div>
        <h1 class="text-4xl font-bold text-gray-900 mb-4">
          ¡Tu negocio está listo! 🚀
        </h1>
        <p class="text-xl text-gray-600 mb-2">
          Has configurado tu tienda exitosamente
        </p>
        <p class="text-gray-500">
          En menos de 5 minutos tienes tu negocio operativo en Vendix
        </p>
      </div>

      <!-- Resumen de configuración -->
      <div class="bg-gray-50 p-6 rounded-lg text-left">
        <h3 class="font-semibold text-lg mb-4">Resumen de tu configuración:</h3>

        <div class="space-y-3">
          <div class="flex items-center space-x-3">
            <div class="text-green-500 text-xl">✅</div>
            <span>Cuenta verificada y activa</span>
          </div>
          <div class="flex items-center space-x-3" *ngIf="wizardData.user?.first_name">
            <div class="text-green-500 text-xl">✅</div>
            <span>Perfil: {{ wizardData.user.first_name }} {{ wizardData.user.last_name }}</span>
          </div>
          <div class="flex items-center space-x-3" *ngIf="wizardData.organization?.name">
            <div class="text-green-500 text-xl">✅</div>
            <span>Organización: {{ wizardData.organization.name }}</span>
          </div>
          <div class="flex items-center space-x-3" *ngIf="wizardData.store?.name">
            <div class="text-green-500 text-xl">✅</div>
            <span>Tienda: {{ wizardData.store.name }}</span>
          </div>
          <div class="flex items-center space-x-3" *ngIf="wizardData.appConfig?.subdomain">
            <div class="text-green-500 text-xl">✅</div>
            <span>Dominio configurado</span>
          </div>
          <div class="flex items-center space-x-3">
            <div class="text-green-500 text-xl">✅</div>
            <span>Branding personalizado</span>
          </div>
        </div>
      </div>

      <!-- Próximos pasos -->
      <div class="bg-blue-50 p-6 rounded-lg">
        <h3 class="font-semibold text-lg mb-3">¿Qué sigue?</h3>
        <div class="grid grid-cols-2 gap-4 text-left">
          <div>
            <div class="font-medium mb-2">📦 Agrega productos</div>
            <div class="text-sm text-gray-600">
              Comienza catalogando tus productos
            </div>
          </div>
          <div>
            <div class="font-medium mb-2">👥 Invita a tu equipo</div>
            <div class="text-sm text-gray-600">
              Añade staff y asigna roles
            </div>
          </div>
          <div>
            <div class="font-medium mb-2">💳 Configura pagos</div>
            <div class="text-sm text-gray-600">
              Activa métodos de pago
            </div>
          </div>
          <div>
            <div class="font-medium mb-2">📊 Revisa reportes</div>
            <div class="text-sm text-gray-600">
              Monitorea tu crecimiento
            </div>
          </div>
        </div>
      </div>

      <button
        (click)="completeWizard()"
        [disabled]="isCompleting"
        class="bg-blue-600 text-white px-8 py-4 rounded-lg text-lg font-semibold hover:bg-blue-700 disabled:opacity-50 transition-all transform hover:scale-105"
      >
        {{ isCompleting ? 'Configurando...' : 'Ir a mi panel 🚀' }}
      </button>

      <div *ngIf="isCompleting" class="mt-4">
        <div class="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto"></div>
        <p class="text-sm text-gray-600 mt-2">Finalizando configuración...</p>
      </div>
    </div>
  `,
  styles: [`
    @keyframes bounce {
      0%, 100% {
        transform: translateY(0);
      }
      50% {
        transform: translateY(-10px);
      }
    }

    .animate-bounce {
      animation: bounce 1s ease-in-out infinite;
    }
  `],
})
export class CompletionStepComponent {
  isCompleting = false;
  wizardData: any = {};

  constructor(
    private wizardService: OnboardingWizardService,
    private router: Router,
  ) {
    this.wizardData = this.wizardService.getWizardData();
  }

  completeWizard(): void {
    this.isCompleting = true;
    this.wizardService.completeWizard().subscribe({
      next: (response) => {
        if (response.success && response.data) {
          // Show success message
          setTimeout(() => {
            // Redirect to dashboard or specified location
            const redirectTo = response.data.redirect_to || '/dashboard';
            window.location.href = redirectTo; // Full reload to refresh user state
          }, 1000);
        }
      },
      error: (error) => {
        this.isCompleting = false;
        console.error('Error completing wizard:', error);
        alert('Error al completar el wizard. Por favor intenta de nuevo.');
      },
    });
  }
}
