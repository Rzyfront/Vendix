import { Component, Input, Output, EventEmitter, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ButtonComponent, IconComponent } from '../../index';

@Component({
  selector: 'app-completion-step',
  standalone: true,
  imports: [CommonModule, ButtonComponent, IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [`
    .completion-step {
      padding: 1.5rem 0;
      min-height: 600px;
      display: flex;
      align-items: center;
      justify-content: center;
      text-align: center;
    }

    .completion-container {
      max-width: 800px;
      margin: 0 auto;
      padding: 0 1.5rem;
    }

    .success-animation {
      margin-bottom: 2rem;
    }

    .success-icon-wrapper {
      position: relative;
      display: inline-block;
    }

    .success-icon-bg {
      width: 120px;
      height: 120px;
      background: linear-gradient(135deg, #22C55E 0%, #16A34A 100%);
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      margin: 0 auto;
      box-shadow: 0 12px 40px rgba(34, 197, 94, 0.32);
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
      color: white;
    }

    .success-ripple {
      position: absolute;
      top: -20px;
      left: -20px;
      right: -20px;
      bottom: -20px;
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
      font-size: 2.5rem;
      font-weight: 700;
      color: #1F2937;
      margin-bottom: 0.75rem;
      background: linear-gradient(135deg, #22C55E 0%, #16A34A 100%);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      background-clip: text;
    }

    .completion-subtitle {
      font-size: 1.125rem;
      color: #6B7280;
      line-height: 1.6;
      margin-bottom: 2rem;
    }

    .success-stats {
      display: flex;
      justify-content: center;
      gap: 2rem;
      margin-bottom: 2rem;
    }

    .stat-item {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 0.5rem;
    }

    .stat-number {
      font-size: 2rem;
      line-height: 1;
    }

    .stat-label {
      font-size: 0.875rem;
      font-weight: 600;
      color: #374151;
    }

    .completion-summary {
      background: white;
      border: 1px solid #E5E7EB;
      border-radius: 1rem;
      padding: 1.5rem;
      margin-bottom: 2rem;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.04);
    }

    .summary-header {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 0.75rem;
      margin-bottom: 1.5rem;
      padding-bottom: 1rem;
      border-bottom: 1px solid #F3F4F6;
    }

    .summary-icon {
      width: 40px;
      height: 40px;
      background: #F0FDF4;
      border-radius: 0.5rem;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .summary-icon-element {
      color: #22C55E;
    }

    .summary-title {
      font-size: 1.125rem;
      font-weight: 600;
      color: #1F2937;
      margin: 0;
    }

    .summary-items {
      display: flex;
      flex-direction: column;
      gap: 1rem;
    }

    .summary-item {
      display: flex;
      align-items: center;
      gap: 1rem;
      padding: 0.75rem;
      border-radius: 0.5rem;
      background: #F9FAFB;
    }

    .item-icon {
      width: 36px;
      height: 36px;
      background: white;
      border-radius: 0.375rem;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
    }

    .item-icon-element {
      color: #22C55E;
    }

    .item-content {
      flex: 1;
      text-align: left;
    }

    .item-label {
      display: block;
      font-size: 0.875rem;
      font-weight: 500;
      color: #374151;
      margin-bottom: 0.25rem;
    }

    .item-value {
      display: block;
      font-size: 0.75rem;
      color: #6B7280;
    }

    .item-check {
      flex-shrink: 0;
    }

    .check-icon {
      color: #22C55E;
    }

    .next-steps {
      background: #FAFBFC;
      border: 1px solid #E5E7EB;
      border-radius: 1rem;
      padding: 1.5rem;
      margin-bottom: 2rem;
    }

    .next-steps-header {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 0.75rem;
      margin-bottom: 1.5rem;
    }

    .next-steps-icon {
      width: 40px;
      height: 40px;
      background: #FEF3C7;
      border-radius: 0.5rem;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .next-steps-icon-element {
      color: #F59E0B;
    }

    .next-steps-title {
      font-size: 1.125rem;
      font-weight: 600;
      color: #1F2937;
      margin: 0;
    }

    .next-steps-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
      gap: 1rem;
    }

    .next-step-card {
      display: flex;
      align-items: flex-start;
      gap: 1rem;
      padding: 1rem;
      background: white;
      border-radius: 0.75rem;
      border: 1px solid #E5E7EB;
      transition: all 0.2s ease;
      text-align: left;
    }

    .next-step-card:hover {
      border-color: #F59E0B;
      box-shadow: 0 4px 12px rgba(245, 158, 11, 0.15);
      transform: translateY(-2px);
    }

    .step-card-icon {
      width: 48px;
      height: 48px;
      background: #FEF3C7;
      border-radius: 0.5rem;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
    }

    .step-card-icon-element {
      color: #F59E0B;
    }

    .step-card-content {
      flex: 1;
    }

    .step-card-title {
      font-size: 0.875rem;
      font-weight: 600;
      color: #1F2937;
      margin-bottom: 0.25rem;
    }

    .step-card-description {
      font-size: 0.75rem;
      color: #6B7280;
      line-height: 1.4;
    }

    .completion-action {
      margin-bottom: 1rem;
    }

    .action-button {
      min-width: 200px;
    }

    .loading-overlay {
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: rgba(0, 0, 0, 0.5);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 9999;
    }

    .loading-content {
      background: white;
      padding: 2rem;
      border-radius: 1rem;
      text-align: center;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.24);
    }

    .loading-spinner {
      width: 40px;
      height: 40px;
      border: 4px solid #E5E7EB;
      border-top: 4px solid #22C55E;
      border-radius: 50%;
      animation: spin 1s linear infinite;
      margin: 0 auto 1rem;
    }

    @keyframes spin {
      0% { transform: rotate(0deg); }
      100% { transform: rotate(360deg); }
    }

    .loading-text {
      color: #374151;
      font-weight: 500;
    }

    @media (max-width: 640px) {
      .completion-container {
        padding: 0 1rem;
      }

      .completion-title {
        font-size: 2rem;
      }

      .success-stats {
        gap: 1rem;
      }

      .stat-number {
        font-size: 1.5rem;
      }

      .next-steps-grid {
        grid-template-columns: 1fr;
        gap: 0.75rem;
      }

      .summary-header,
      .next-steps-header {
        flex-direction: column;
        gap: 0.5rem;
      }

      .next-step-card {
        flex-direction: column;
        text-align: center;
        gap: 0.75rem;
      }
    }
  `],
  template: `
    <div class="step-content completion-step">
      <div class="completion-container">
        <!-- Success Animation -->
        <div class="success-animation">
          <div class="success-icon-wrapper">
            <div class="success-icon-bg">
              <app-icon name="check-circle" size="64" class="success-icon"></app-icon>
            </div>
            <div class="success-ripple"></div>
          </div>
        </div>

        <!-- Main Content -->
        <div class="completion-content">
          <h2 class="completion-title">¡Tu negocio está listo! 🚀</h2>
          <p class="completion-subtitle">
            Has configurado tu tienda exitosamente en menos de 5 minutos
          </p>

          <!-- Success Stats -->
          <div class="success-stats">
            <div class="stat-item">
              <div class="stat-number">⚡</div>
              <div class="stat-label">Rápido</div>
            </div>
            <div class="stat-item">
              <div class="stat-number">✨</div>
              <div class="stat-label">Fácil</div>
            </div>
            <div class="stat-item">
              <div class="stat-number">🎯</div>
              <div class="stat-label">Listo</div>
            </div>
          </div>

          <!-- Configuration Summary -->
          <div class="completion-summary">
            <div class="summary-header">
              <div class="summary-icon">
                <app-icon name="check-square" size="20" class="summary-icon-element"></app-icon>
              </div>
              <h3 class="summary-title">Resumen de tu configuración</h3>
            </div>

            <div class="summary-items">
              <div class="summary-item" *ngIf="wizardData.user?.first_name">
                <div class="item-icon">
                  <app-icon name="user" size="18" class="item-icon-element"></app-icon>
                </div>
                <div class="item-content">
                  <span class="item-label">Perfil configurado</span>
                  <span class="item-value">{{ wizardData.user.first_name }} {{ wizardData.user.last_name }}</span>
                </div>
                <div class="item-check">
                  <app-icon name="check-circle" size="16" class="check-icon"></app-icon>
                </div>
              </div>

              <div class="summary-item" *ngIf="wizardData.organization?.name">
                <div class="item-icon">
                  <app-icon name="building" size="18" class="item-icon-element"></app-icon>
                </div>
                <div class="item-content">
                  <span class="item-label">Organización creada</span>
                  <span class="item-value">{{ wizardData.organization.name }}</span>
                </div>
                <div class="item-check">
                  <app-icon name="check-circle" size="16" class="check-icon"></app-icon>
                </div>
              </div>

              <div class="summary-item" *ngIf="wizardData.store?.name">
                <div class="item-icon">
                  <app-icon name="store" size="18" class="item-icon-element"></app-icon>
                </div>
                <div class="item-content">
                  <span class="item-label">Tienda configurada</span>
                  <span class="item-value">{{ wizardData.store.name }}</span>
                </div>
                <div class="item-check">
                  <app-icon name="check-circle" size="16" class="check-icon"></app-icon>
                </div>
              </div>

              <div class="summary-item">
                <div class="item-icon">
                  <app-icon name="globe" size="18" class="item-icon-element"></app-icon>
                </div>
                <div class="item-content">
                  <span class="item-label">Dominio activo</span>
                  <span class="item-value">tu-dominio.vendix.com</span>
                </div>
                <div class="item-check">
                  <app-icon name="check-circle" size="16" class="check-icon"></app-icon>
                </div>
              </div>

              <div class="summary-item">
                <div class="item-icon">
                  <app-icon name="palette" size="18" class="item-icon-element"></app-icon>
                </div>
                <div class="item-content">
                  <span class="item-label">Branding personalizado</span>
                  <span class="item-value">Colores y estilos aplicados</span>
                </div>
                <div class="item-check">
                  <app-icon name="check-circle" size="16" class="check-icon"></app-icon>
                </div>
              </div>
            </div>
          </div>

          <!-- Next Steps -->
          <div class="next-steps">
            <div class="next-steps-header">
              <div class="next-steps-icon">
                <app-icon name="compass" size="20" class="next-steps-icon-element"></app-icon>
              </div>
              <h3 class="next-steps-title">¿Qué sigue?</h3>
            </div>

            <div class="next-steps-grid">
              <div class="next-step-card">
                <div class="step-card-icon">
                  <app-icon name="package" size="24" class="step-card-icon-element"></app-icon>
                </div>
                <div class="step-card-content">
                  <h4 class="step-card-title">Agregar productos</h4>
                  <p class="step-card-description">
                    Comienza catalogando tus productos para empezar a vender
                  </p>
                </div>
              </div>

              <div class="next-step-card">
                <div class="step-card-icon">
                  <app-icon name="users" size="24" class="step-card-icon-element"></app-icon>
                </div>
                <div class="step-card-content">
                  <h4 class="step-card-title">Invitar equipo</h4>
                  <p class="step-card-description">
                    Añade a tu equipo y asigna roles para colaborar
                  </p>
                </div>
              </div>

              <div class="next-step-card">
                <div class="step-card-icon">
                  <app-icon name="credit-card" size="24" class="step-card-icon-element"></app-icon>
                </div>
                <div class="step-card-content">
                  <h4 class="step-card-title">Configurar pagos</h4>
                  <p class="step-card-description">
                    Activa métodos de pago para recibir cobros
                  </p>
                </div>
              </div>

              <div class="next-step-card">
                <div class="step-card-icon">
                  <app-icon name="bar-chart" size="24" class="step-card-icon-element"></app-icon>
                </div>
                <div class="step-card-content">
                  <h4 class="step-card-title">Ver reportes</h4>
                  <p class="step-card-description">
                    Monitorea tu crecimiento y ventas
                  </p>
                </div>
              </div>
            </div>
          </div>

          <!-- Action Button -->
          <div class="completion-action">
            <app-button
              variant="primary"
              size="lg"
              (clicked)="complete.emit()"
              [disabled]="isCompleting"
              class="action-button"
            >
              <app-icon name="rocket" size="20" slot="icon"></app-icon>
              {{ isCompleting ? 'Finalizando...' : 'Ir a mi panel' }}
            </app-button>
          </div>

          <!-- Loading State -->
          <div *ngIf="isCompleting" class="loading-overlay">
            <div class="loading-content">
              <div class="loading-spinner"></div>
              <div class="loading-text">Finalizando configuración...</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  `,
})
export class CompletionStepComponent {
  @Input() wizardData: any = {};
  @Input() isCompleting = false;
  @Output() complete = new EventEmitter<void>();
}