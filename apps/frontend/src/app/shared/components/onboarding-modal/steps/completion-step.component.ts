import {
  Component,
  Input,
  Output,
  EventEmitter,
  ChangeDetectionStrategy,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { IconComponent } from '../../index';

@Component({
  selector: 'app-completion-step',
  standalone: true,
  imports: [CommonModule, IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [
    `
      /* ============================================
         MOBILE-FIRST COMPLETION STEP
         Bottom-sheet style with modern cards
         ============================================ */

      :host {
        display: block;
        height: 100%;
      }

      .completion-step {
        display: flex;
        flex-direction: column;
        height: 100%;
        max-height: 70vh;
        overflow: hidden;
      }

      /* Handle bar - bottom sheet indicator */
      .handle-bar {
        display: flex;
        justify-content: center;
        padding: 0.5rem 0 1rem 0;
      }

      .handle-indicator {
        width: 2.5rem;
        height: 0.375rem;
        background: var(--color-border);
        border-radius: 9999px;
      }

      /* Scrollable content */
      .completion-content {
        flex: 1;
        overflow-y: auto;
        padding: 0 1.5rem 2rem 1.5rem;
        -webkit-overflow-scrolling: touch;
      }

      .completion-content::-webkit-scrollbar {
        width: 4px;
      }

      .completion-content::-webkit-scrollbar-thumb {
        background: var(--color-border);
        border-radius: 10px;
      }

      /* ============================================
         SUCCESS ICON - Double circle design
         ============================================ */

      .success-icon-container {
        display: flex;
        justify-content: center;
        margin-bottom: 1.25rem;
      }

      .success-icon-outer {
        width: 5rem;
        height: 5rem;
        background: color-mix(in srgb, var(--color-primary) 10%, transparent);
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        animation: successPop 0.6s ease-out;
      }

      .success-icon-inner {
        width: 3.5rem;
        height: 3.5rem;
        background: var(--color-primary);
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        box-shadow: 0 10px 25px -5px color-mix(in srgb, var(--color-primary) 30%, transparent);
      }

      .success-icon-inner app-icon {
        color: var(--color-text-on-primary);
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

      /* ============================================
         TITLE SECTION
         ============================================ */

      .completion-header {
        text-align: center;
        margin-bottom: 1rem;
      }

      .completion-title {
        font-size: 1.5rem;
        font-weight: 700;
        color: var(--color-text-primary);
        margin: 0 0 0.25rem 0;
      }

      .completion-subtitle {
        font-size: 0.875rem;
        color: var(--color-text-secondary);
        margin: 0;
      }

      /* ============================================
         STATS with vertical separator
         ============================================ */

      .stats-container {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 2rem;
        padding: 0.75rem 0;
        margin-bottom: 1.25rem;
      }

      .stat-item {
        text-align: center;
      }

      .stat-number {
        font-size: 1.25rem;
        font-weight: 700;
        color: var(--color-text-primary);
        line-height: 1;
      }

      .stat-number.primary {
        color: var(--color-primary);
      }

      .stat-label {
        font-size: 0.625rem;
        font-weight: 600;
        color: var(--color-text-muted);
        text-transform: uppercase;
        letter-spacing: 0.05em;
        margin-top: 0.25rem;
      }

      .stat-divider {
        width: 1px;
        height: 2rem;
        background: var(--color-border);
      }

      /* ============================================
         SUMMARY SECTION
         ============================================ */

      .section-label {
        font-size: 0.625rem;
        font-weight: 600;
        color: var(--color-text-muted);
        text-transform: uppercase;
        letter-spacing: 0.05em;
        margin-bottom: 0.75rem;
      }

      .summary-section {
        margin-bottom: 1.5rem;
      }

      .summary-cards {
        display: flex;
        flex-direction: column;
        gap: 0.75rem;
      }

      .summary-card {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 1rem;
        background: var(--color-background);
        border-radius: 1rem;
        border: 1px solid var(--color-border);
      }

      .summary-card-left {
        display: flex;
        align-items: center;
        gap: 0.75rem;
      }

      .summary-card-icon {
        width: 2.5rem;
        height: 2.5rem;
        background: var(--color-surface);
        border-radius: 0.5rem;
        display: flex;
        align-items: center;
        justify-content: center;
        box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
      }

      .summary-card-icon app-icon {
        color: var(--color-primary);
      }

      .summary-card-info {
        display: flex;
        flex-direction: column;
      }

      .summary-card-title {
        font-size: 0.875rem;
        font-weight: 600;
        color: var(--color-text-primary);
        line-height: 1.2;
      }

      .summary-card-subtitle {
        font-size: 0.75rem;
        color: var(--color-text-muted);
      }

      .summary-card-check app-icon {
        color: var(--color-primary);
      }

      /* ============================================
         NEXT STEPS - Color-coded cards
         ============================================ */

      .next-steps-section {
        margin-bottom: 1.5rem;
      }

      .next-steps-cards {
        display: flex;
        flex-direction: column;
        gap: 0.75rem;
      }

      .next-step-card {
        display: flex;
        align-items: center;
        gap: 0.75rem;
        padding: 1rem;
        border-radius: 1rem;
        border: 1px solid transparent;
      }

      /* Blue - Products */
      .next-step-card.blue {
        background: color-mix(in srgb, var(--color-info) 10%, transparent);
        border-color: color-mix(in srgb, var(--color-info) 20%, transparent);
      }

      .next-step-card.blue .next-step-icon {
        background: var(--color-surface);
      }

      .next-step-card.blue .next-step-icon app-icon {
        color: var(--color-info);
      }

      /* Amber - Sales */
      .next-step-card.amber {
        background: color-mix(in srgb, var(--color-warning) 10%, transparent);
        border-color: color-mix(in srgb, var(--color-warning) 20%, transparent);
      }

      .next-step-card.amber .next-step-icon {
        background: var(--color-surface);
      }

      .next-step-card.amber .next-step-icon app-icon {
        color: var(--color-warning);
      }

      /* Purple - Reports */
      .next-step-card.purple {
        background: color-mix(in srgb, #8b5cf6 10%, transparent);
        border-color: color-mix(in srgb, #8b5cf6 20%, transparent);
      }

      .next-step-card.purple .next-step-icon {
        background: var(--color-surface);
      }

      .next-step-card.purple .next-step-icon app-icon {
        color: #8b5cf6;
      }

      .next-step-icon {
        width: 2.5rem;
        height: 2.5rem;
        border-radius: 0.75rem;
        display: flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
        box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
      }

      .next-step-info {
        flex: 1;
      }

      .next-step-title {
        font-size: 0.875rem;
        font-weight: 600;
        color: var(--color-text-primary);
        line-height: 1.2;
        margin-bottom: 0.125rem;
      }

      .next-step-description {
        font-size: 0.75rem;
        color: var(--color-text-muted);
      }

      .next-step-arrow app-icon {
        color: var(--color-text-muted);
      }

      /* ============================================
         DESKTOP ADJUSTMENTS (≥640px)
         ============================================ */

      @media (min-width: 640px) {
        .handle-bar {
          padding-top: 0.25rem;
          padding-bottom: 0.75rem;
        }

        .handle-indicator {
          width: 2rem;
          height: 0.25rem;
          opacity: 0.5;
        }

        .completion-content {
          padding: 0 2rem 1.5rem 2rem;
        }

        .success-icon-outer {
          width: 5.5rem;
          height: 5.5rem;
        }

        .success-icon-inner {
          width: 4rem;
          height: 4rem;
        }

        .stats-container {
          gap: 3rem;
        }

        .stat-number {
          font-size: 1.5rem;
        }

        .stat-label {
          font-size: 0.6875rem;
        }

      }
    `,
  ],
  template: `
    <div class="step-content completion-step">
      <!-- Handle Bar (Bottom Sheet Indicator) -->
      <div class="handle-bar">
        <div class="handle-indicator"></div>
      </div>

      <!-- Scrollable Content -->
      <div class="completion-content">
        <!-- Success Icon - Double Circle -->
        <div class="success-icon-container">
          <div class="success-icon-outer">
            <div class="success-icon-inner">
              <app-icon name="check" size="28"></app-icon>
            </div>
          </div>
        </div>

        <!-- Title & Subtitle -->
        <div class="completion-header">
          <h2 class="completion-title">¡Configuración completada!</h2>
          <p class="completion-subtitle">Tu tienda está lista para comenzar</p>
        </div>

        <!-- Stats with Separator -->
        <div class="stats-container">
          <div class="stat-item">
            <div class="stat-number">7</div>
            <div class="stat-label">Pasos</div>
          </div>
          <div class="stat-divider"></div>
          <div class="stat-item">
            <div class="stat-number primary">100%</div>
            <div class="stat-label">Completado</div>
          </div>
        </div>

        <!-- Summary Section -->
        <div class="summary-section">
          <div class="section-label">Resumen de configuración</div>
          <div class="summary-cards">
            <!-- Usuario -->
            <div class="summary-card">
              <div class="summary-card-left">
                <div class="summary-card-icon">
                  <app-icon name="user" size="18"></app-icon>
                </div>
                <div class="summary-card-info">
                  <span class="summary-card-title">Usuario</span>
                  <span class="summary-card-subtitle">{{
                    wizardData.user?.email || 'Configurado'
                  }}</span>
                </div>
              </div>
              <div class="summary-card-check">
                <app-icon name="check-circle" size="20"></app-icon>
              </div>
            </div>

            <!-- Tienda -->
            <div class="summary-card">
              <div class="summary-card-left">
                <div class="summary-card-icon">
                  <app-icon name="store" size="18"></app-icon>
                </div>
                <div class="summary-card-info">
                  <span class="summary-card-title">Tienda</span>
                  <span class="summary-card-subtitle">{{
                    wizardData.store?.name || 'Configurada'
                  }}</span>
                </div>
              </div>
              <div class="summary-card-check">
                <app-icon name="check-circle" size="20"></app-icon>
              </div>
            </div>

            <!-- Ubicación -->
            <div class="summary-card">
              <div class="summary-card-left">
                <div class="summary-card-icon">
                  <app-icon name="map-pin" size="18"></app-icon>
                </div>
                <div class="summary-card-info">
                  <span class="summary-card-title">Ubicación</span>
                  <span class="summary-card-subtitle"
                    >Creada automáticamente</span
                  >
                </div>
              </div>
              <div class="summary-card-check">
                <app-icon name="check-circle" size="20"></app-icon>
              </div>
            </div>
          </div>
        </div>

        <!-- Next Steps Section -->
        <div class="next-steps-section">
          <div class="section-label">Próximos pasos</div>
          <div class="next-steps-cards">
            <!-- Add Products - Blue -->
            <div class="next-step-card blue">
              <div class="next-step-icon">
                <app-icon name="package" size="18"></app-icon>
              </div>
              <div class="next-step-info">
                <div class="next-step-title">Agregar productos</div>
                <div class="next-step-description">
                  Crea tu catálogo de productos
                </div>
              </div>
              <div class="next-step-arrow">
                <app-icon name="chevron-right" size="18"></app-icon>
              </div>
            </div>

            <!-- First Sale - Amber -->
            <div class="next-step-card amber">
              <div class="next-step-icon">
                <app-icon name="shopping-cart" size="18"></app-icon>
              </div>
              <div class="next-step-info">
                <div class="next-step-title">Primera venta</div>
                <div class="next-step-description">
                  Realiza tu primera transacción
                </div>
              </div>
              <div class="next-step-arrow">
                <app-icon name="chevron-right" size="18"></app-icon>
              </div>
            </div>

            <!-- View Reports - Purple -->
            <div class="next-step-card purple">
              <div class="next-step-icon">
                <app-icon name="chart-bar" size="18"></app-icon>
              </div>
              <div class="next-step-info">
                <div class="next-step-title">Ver reportes</div>
                <div class="next-step-description">Analiza tus ventas</div>
              </div>
              <div class="next-step-arrow">
                <app-icon name="chevron-right" size="18"></app-icon>
              </div>
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
  @Output() goBack = new EventEmitter<void>();
}
