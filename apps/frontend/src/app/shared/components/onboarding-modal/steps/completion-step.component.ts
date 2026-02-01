import {
  Component,
  Input,
  Output,
  EventEmitter,
  ChangeDetectionStrategy,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { ButtonComponent, IconComponent } from '../../index';

@Component({
  selector: 'app-completion-step',
  standalone: true,
  imports: [CommonModule, ButtonComponent, IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [
    `
      .completion-step {
        padding: 0;
        min-height: auto;
        display: block;
      }

      .completion-container {
        max-width: 100%;
        margin: 0;
        padding: 0;
        text-align: center;
      }

      .success-animation {
        margin-bottom: 1rem;
        display: flex;
        justify-content: center;
      }

      .success-icon-wrapper {
        position: relative;
        display: inline-block;
      }

      .success-icon-bg {
        width: 64px;
        height: 64px;
        background: linear-gradient(135deg, var(--color-success) 0%, #16a34a 100%);
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        box-shadow: var(--shadow-lg);
        position: relative;
        z-index: 2;
        animation: successPop 0.6s ease-out;
      }

      @keyframes successPop {
        0% {
          transform: scale(0);
          opacity: 0;
        }
        50% {
          transform: scale(1.1);
        }
        100% {
          transform: scale(1);
          opacity: 1;
        }
      }

      .success-icon {
        color: var(--color-text-on-primary);
      }

      .success-ripple {
        position: absolute;
        top: -12px;
        left: -12px;
        right: -12px;
        bottom: -12px;
        border: 2px solid rgba(34, 197, 94, 0.2);
        border-radius: 50%;
        animation: ripple 2s ease-out infinite;
      }

      @keyframes ripple {
        0% {
          transform: scale(1);
          opacity: 1;
        }
        50% {
          transform: scale(1.15);
          opacity: 0.5;
        }
        100% {
          transform: scale(1);
          opacity: 1;
        }
      }

      .completion-title {
        font-size: var(--fs-xl);
        font-weight: var(--fw-bold);
        color: var(--color-text-primary);
        margin-bottom: 0.5rem;
        background: linear-gradient(135deg, var(--color-success) 0%, #16a34a 100%);
        -webkit-background-clip: text;
        -webkit-text-fill-color: transparent;
        background-clip: text;
      }

      .completion-subtitle {
        font-size: var(--fs-sm);
        color: var(--color-text-secondary);
        line-height: 1.5;
        margin-bottom: 1rem;
      }

      .success-stats {
        display: flex;
        justify-content: center;
        gap: 1.5rem;
        margin-bottom: 1rem;
      }

      .stat-item {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 0.25rem;
      }

      .stat-number {
        font-size: var(--fs-2xl);
        font-weight: var(--fw-bold);
        color: var(--color-success);
        line-height: 1;
      }

      .stat-label {
        font-size: var(--fs-xs);
        font-weight: var(--fw-semibold);
        color: var(--color-text-secondary);
      }

      .completion-summary {
        background: var(--color-surface);
        border: 1px solid var(--color-border);
        border-radius: var(--radius-lg);
        padding: 1rem;
        margin-bottom: 1rem;
        box-shadow: var(--shadow-sm);
        text-align: left;
        cursor: pointer;
        transition: all var(--transition-fast) ease;
      }

      .completion-summary:hover {
        border-color: var(--color-success);
        background: var(--color-background);
      }

      .summary-header {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        margin-bottom: 0.75rem;
        padding-bottom: 0.5rem;
        border-bottom: 1px solid var(--color-border);
      }

      .summary-icon {
        width: 28px;
        height: 28px;
        background: var(--color-success-light);
        border-radius: var(--radius-sm);
        display: flex;
        align-items: center;
        justify-content: center;
      }

      .summary-icon-element {
        color: var(--color-success);
      }

      .summary-title {
        font-size: var(--fs-base);
        font-weight: var(--fw-semibold);
        color: var(--color-text-primary);
        margin: 0;
      }

      .summary-items {
        display: grid;
        grid-template-columns: repeat(2, 1fr);
        gap: 0.5rem;
      }

      .summary-item {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        padding: 0.5rem;
        border-radius: var(--radius-md);
        background: var(--color-background);
      }

      .item-icon {
        width: 28px;
        height: 28px;
        background: var(--color-surface);
        border-radius: var(--radius-sm);
        display: flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
      }

      .item-icon-element {
        color: var(--color-success);
      }

      .item-content {
        flex: 1;
        text-align: left;
      }

      .item-label {
        display: block;
        font-size: var(--fs-xs);
        font-weight: var(--fw-medium);
        color: var(--color-text-primary);
        margin-bottom: 0.125rem;
      }

      .item-value {
        display: block;
        font-size: var(--fs-xs);
        color: var(--color-text-muted);
      }

      .item-check {
        flex-shrink: 0;
      }

      .check-icon {
        color: var(--color-success);
      }

      .next-steps {
        background: var(--color-background);
        border: 1px solid var(--color-border);
        border-radius: var(--radius-lg);
        padding: 1rem;
        margin-bottom: 1rem;
        cursor: pointer;
        transition: all var(--transition-fast) ease;
      }

      .next-steps:hover {
        border-color: var(--color-info);
        background: var(--color-surface);
      }

      .next-steps-header {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 0.5rem;
        margin-bottom: 0.75rem;
      }

      .next-steps-icon {
        width: 28px;
        height: 28px;
        background: var(--color-info-light);
        border-radius: var(--radius-sm);
        display: flex;
        align-items: center;
        justify-content: center;
      }

      .next-steps-icon-element {
        color: var(--color-info);
      }

      .next-steps-title {
        font-size: var(--fs-base);
        font-weight: var(--fw-semibold);
        color: var(--color-text-primary);
        margin: 0;
      }

      .next-steps-grid {
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        gap: 0.75rem;
      }

      .next-step-card {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 0.5rem;
        padding: 0.75rem;
        background: var(--color-surface);
        border-radius: var(--radius-md);
        border: 1px solid var(--color-border);
        text-align: center;
        cursor: default;
      }

      .step-card-icon {
        width: 36px;
        height: 36px;
        background: var(--color-info-light);
        border-radius: var(--radius-md);
        display: flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
      }

      .step-card-icon-element {
        color: var(--color-info);
      }

      .step-card-content {
        flex: 1;
      }

      .step-card-title {
        font-size: var(--fs-sm);
        font-weight: var(--fw-semibold);
        color: var(--color-text-primary);
        margin-bottom: 0.125rem;
      }

      .step-card-description {
        font-size: var(--fs-xs);
        color: var(--color-text-muted);
        line-height: 1.3;
      }

      .completion-action {
        margin-top: 1rem;
        padding-top: 1rem;
        border-top: 1px solid var(--color-border);
        display: flex;
        justify-content: center;
      }

      .action-button {
        min-width: 180px;
        height: 44px;
        font-size: var(--fs-base);
        font-weight: var(--fw-semibold);
      }

      @media (max-width: 1024px) {
        .next-steps-grid {
          grid-template-columns: 1fr;
        }
        .summary-items {
          grid-template-columns: 1fr;
        }
      }
    `,
  ],
  template: `
    <div class="step-content completion-step">
      <div class="completion-container">
        <!-- Success Animation -->
        <div class="success-animation">
          <div class="success-icon-wrapper">
            <div class="success-icon-bg">
              <app-icon name="check" size="32" class="success-icon"></app-icon>
            </div>
            <div class="success-ripple"></div>
          </div>
        </div>

        <!-- Title -->
        <h2 class="completion-title">¡Configuración completada!</h2>
        <div class="completion-messages">
          <p *ngFor="let msg of messages" class="completion-subtitle">
            {{ msg }}
          </p>
        </div>

        <!-- Action Button (Moved to top) -->
        <div class="flex justify-center mb-6">
          <app-button
            variant="primary"
            size="md"
            [disabled]="isCompleting"
            (click)="complete.emit()"
            class="action-button"
          >
            <span>{{ isCompleting ? 'Finalizando...' : 'Ir a mi tienda' }}</span>
          </app-button>
        </div>

        <!-- Success Stats -->
        <div class="success-stats">
          <div class="stat-item">
            <span class="stat-number">7</span>
            <span class="stat-label">Pasos</span>
          </div>
          <div class="stat-item">
            <span class="stat-number">100%</span>
            <span class="stat-label">Completado</span>
          </div>
        </div>

        <!-- Configuration Summary -->
        <div class="completion-summary" (click)="complete.emit()">
          <div class="summary-header">
            <div class="summary-icon">
              <app-icon
                name="clipboard-check"
                size="16"
                class="summary-icon-element"
              ></app-icon>
            </div>
            <h3 class="summary-title">Resumen de configuración</h3>
          </div>
          <div class="summary-items">
            <div class="summary-item">
              <div class="item-icon">
                <app-icon
                  name="user"
                  size="14"
                  class="item-icon-element"
                ></app-icon>
              </div>
              <div class="item-content">
                <span class="item-label">Usuario</span>
                <span class="item-value">{{ wizardData.user?.email || 'Configurado' }}</span>
              </div>
              <div class="item-check">
                <app-icon name="check" size="14" class="check-icon"></app-icon>
              </div>
            </div>
            <div class="summary-item">
              <div class="item-icon">
                <app-icon
                  name="building"
                  size="14"
                  class="item-icon-element"
                ></app-icon>
              </div>
              <div class="item-content">
                <span class="item-label">Organización</span>
                <span class="item-value">{{ wizardData.organization?.name || 'Configurada' }}</span>
              </div>
              <div class="item-check">
                <app-icon name="check" size="14" class="check-icon"></app-icon>
              </div>
            </div>
            <div class="summary-item">
              <div class="item-icon">
                <app-icon
                  name="store"
                  size="14"
                  class="item-icon-element"
                ></app-icon>
              </div>
              <div class="item-content">
                <span class="item-label">Tienda</span>
                <span class="item-value">{{ wizardData.store?.name || 'Configurada' }}</span>
              </div>
              <div class="item-check">
                <app-icon name="check" size="14" class="check-icon"></app-icon>
              </div>
            </div>
            <div class="summary-item">
              <div class="item-icon">
                <app-icon
                  name="palette"
                  size="14"
                  class="item-icon-element"
                ></app-icon>
              </div>
              <div class="item-content">
                <span class="item-label">Personalización</span>
                <span class="item-value">Aplicada</span>
              </div>
              <div class="item-check">
                <app-icon name="check" size="14" class="check-icon"></app-icon>
              </div>
            </div>
            <div class="summary-item">
              <div class="item-icon">
                <app-icon
                  name="map-pin"
                  size="14"
                  class="item-icon-element"
                ></app-icon>
              </div>
              <div class="item-content">
                <span class="item-label">Ubicación</span>
                <span class="item-value">Creada automáticamente</span>
              </div>
              <div class="item-check">
                <app-icon name="check" size="14" class="check-icon"></app-icon>
              </div>
            </div>
          </div>
        </div>

        <!-- Next Steps -->
        <div class="next-steps" (click)="complete.emit()">
          <div class="next-steps-header">
            <div class="next-steps-icon">
              <app-icon
                name="arrow-right"
                size="16"
                class="next-steps-icon-element"
              ></app-icon>
            </div>
            <h3 class="next-steps-title">Próximos pasos</h3>
          </div>
          <div class="next-steps-grid">
            <div class="next-step-card">
              <div class="step-card-icon">
                <app-icon
                  name="package"
                  size="18"
                  class="step-card-icon-element"
                ></app-icon>
              </div>
              <div class="step-card-content">
                <h4 class="step-card-title">Agregar productos</h4>
                <p class="step-card-description">
                  Crea tu catálogo de productos
                </p>
              </div>
            </div>
            <div class="next-step-card">
              <div class="step-card-icon">
                <app-icon
                  name="shopping-cart"
                  size="18"
                  class="step-card-icon-element"
                ></app-icon>
              </div>
              <div class="step-card-content">
                <h4 class="step-card-title">Primera venta</h4>
                <p class="step-card-description">
                  Realiza tu primera transacción
                </p>
              </div>
            </div>
            <div class="next-step-card">
              <div class="step-card-icon">
                <app-icon
                  name="chart-bar"
                  size="18"
                  class="step-card-icon-element"
                ></app-icon>
              </div>
              <div class="step-card-content">
                <h4 class="step-card-title">Ver reportes</h4>
                <p class="step-card-description">
                  Analiza tus ventas
                </p>
              </div>
            </div>
          </div>
        </div>

        <!-- Action Button removed from bottom -->
      </div>
    </div>
  `,
})
export class CompletionStepComponent {
  @Input() wizardData: any = {};
  @Input() isCompleting = false;
  @Output() complete = new EventEmitter<void>();

  messages = [
    'Tienda creada exitosamente',
    'Se ha creado una ubicación por defecto para tu tienda',
    'Puedes gestionar tus ubicaciones desde el panel de inventario'
  ];
}
