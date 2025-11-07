import { Component, Input, Output, EventEmitter, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ButtonComponent } from '../../../button/button.component';
import { IconComponent } from '../../../icon/icon.component';

@Component({
  selector: 'app-completion-step',
  standalone: true,
  imports: [CommonModule, ButtonComponent, IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="step-content completion-step">
      <div class="completion-icon">
        <app-icon name="check" size="48"></app-icon>
      </div>

      <h2 class="completion-title">¡Tu negocio está listo!</h2>
      <p class="completion-description">
        Has configurado tu tienda exitosamente en menos de 5 minutos
      </p>

      <div class="completion-summary">
        <h3 class="summary-title">Resumen de tu configuración:</h3>

        <div class="summary-item" *ngIf="wizardData.user?.first_name">
          <app-icon name="user" size="16"></app-icon>
          <span>Perfil: {{ wizardData.user.first_name }} {{ wizardData.user.last_name }}</span>
        </div>

        <div class="summary-item" *ngIf="wizardData.organization?.name">
          <app-icon name="building" size="16"></app-icon>
          <span>Organización: {{ wizardData.organization.name }}</span>
        </div>

        <div class="summary-item" *ngIf="wizardData.store?.name">
          <app-icon name="store" size="16"></app-icon>
          <span>Tienda: {{ wizardData.store.name }}</span>
        </div>

        <div class="summary-item">
          <app-icon name="globe" size="16"></app-icon>
          <span>Dominio configurado</span>
        </div>

        <div class="summary-item">
          <app-icon name="palette" size="16"></app-icon>
          <span>Branding personalizado</span>
        </div>
      </div>

      <div class="bg-[var(--color-primary)]/5 border border-[var(--color-primary)]/20 rounded-[var(--radius-lg)] p-4 mb-6">
        <h3 class="font-semibold text-[var(--color-text-primary)] mb-3">¿Qué sigue?</h3>
        <div class="grid grid-cols-2 gap-4 text-left">
          <div>
            <div class="font-medium mb-1 text-[var(--color-primary)]">
              <app-icon name="package" size="16" class="inline mr-1"></app-icon>
              Productos
            </div>
            <div class="text-sm text-[var(--color-text-secondary)]">
              Agrega tu catálogo de productos
            </div>
          </div>
          <div>
            <div class="font-medium mb-1 text-[var(--color-primary)]">
              <app-icon name="users" size="16" class="inline mr-1"></app-icon>
              Equipo
            </div>
            <div class="text-sm text-[var(--color-text-secondary)]">
              Invita a tu equipo y asigna roles
            </div>
          </div>
          <div>
            <div class="font-medium mb-1 text-[var(--color-primary)]">
              <app-icon name="credit-card" size="16" class="inline mr-1"></app-icon>
              Pagos
            </div>
            <div class="text-sm text-[var(--color-text-secondary)]">
              Configura métodos de pago
            </div>
          </div>
          <div>
            <div class="font-medium mb-1 text-[var(--color-primary)]">
              <app-icon name="bar-chart" size="16" class="inline mr-1"></app-icon>
              Reportes
            </div>
            <div class="text-sm text-[var(--color-text-secondary)]">
              Monitorea tu crecimiento
            </div>
          </div>
        </div>
      </div>

      <div class="flex justify-center">
        <app-button
          variant="primary"
          size="lg"
          (clicked)="complete.emit()"
          [disabled]="isCompleting"
        >
          <app-icon name="rocket" size="20" slot="icon"></app-icon>
          {{ isCompleting ? 'Finalizando...' : 'Ir a mi panel' }}
        </app-button>
      </div>

      <div *ngIf="isCompleting" class="loading-overlay">
        <div class="loading-spinner"></div>
        <div class="loading-text">Finalizando configuración...</div>
      </div>
    </div>
  `,
})
export class CompletionStepComponent {
  @Input() wizardData: any = {};
  @Input() isCompleting = false;
  @Output() complete = new EventEmitter<void>();
}