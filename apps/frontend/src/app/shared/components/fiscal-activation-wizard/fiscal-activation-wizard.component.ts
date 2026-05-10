import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';

import { FiscalActivationWizardService } from '../../../core/services/fiscal-activation-wizard.service';
import {
  FISCAL_AREAS,
  FISCAL_AREA_LABELS,
  FISCAL_STEP_LABELS,
  FiscalArea,
} from '../../../core/models/fiscal-status.model';
import { IconComponent } from '../icon/icon.component';

@Component({
  selector: 'app-fiscal-activation-wizard',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule, IconComponent],
  template: `
    <section class="wizard-page">
      <header class="wizard-header">
        <a class="back-link" routerLink="/admin/settings/fiscal">
          <app-icon name="chevron-left" [size]="16" />
          Manejo fiscal
        </a>
        <div>
          <p>Activación guiada</p>
          <h1>{{ currentTitle() }}</h1>
        </div>
        <span class="progress">{{ service.progressLabel() }}</span>
      </header>

      @if (service.error()) {
        <div class="error-banner">{{ service.error() }}</div>
      }

      <div class="wizard-shell">
        <aside class="step-list">
          @for (step of service.stepSequence(); track step; let i = $index) {
            <button
              type="button"
              class="step-pill"
              [class.step-pill--active]="i === service.currentStepIndex()"
              [class.step-pill--done]="i < service.currentStepIndex()"
              (click)="service.currentStepIndex.set(i)"
            >
              <span>{{ i + 1 }}</span>
              {{ stepLabels[step] }}
            </button>
          }
        </aside>

        <article class="step-card">
          @if (service.currentStep() === 'area_selection') {
            <h2>Selecciona las áreas fiscales</h2>
            <p class="step-copy">Puedes activar una o varias áreas en el mismo flujo.</p>
            <div class="area-options">
              @for (area of areas; track area) {
                <label class="area-option">
                  <input
                    type="checkbox"
                    [checked]="isSelected(area)"
                    (change)="toggleArea(area)"
                  />
                  <span>
                    <strong>{{ areaLabels[area] }}</strong>
                    <small>{{ areaDescription(area) }}</small>
                  </span>
                </label>
              }
            </div>
          } @else {
            <h2>{{ currentTitle() }}</h2>
            <p class="step-copy">{{ currentDescription() }}</p>
            <label class="notes-field">
              <span>Datos de este paso</span>
              <textarea
                rows="7"
                [ngModel]="stepText()"
                (ngModelChange)="stepText.set($event)"
                placeholder="Registra aquí los datos, decisiones o documentos relacionados con este paso."
              ></textarea>
            </label>
          }

          <footer class="wizard-actions">
            <button class="secondary-btn" type="button" (click)="back()" [disabled]="service.currentStepIndex() === 0">
              Atrás
            </button>
            @if (isLastStep()) {
              <button class="primary-btn" type="button" (click)="finish()" [disabled]="service.submitting()">
                Finalizar activación
              </button>
            } @else {
              <button class="primary-btn" type="button" (click)="next()" [disabled]="!canContinue() || service.submitting()">
                Continuar
              </button>
            }
          </footer>
        </article>
      </div>
    </section>
  `,
  styles: [
    `
      .wizard-page {
        width: 100%;
        max-width: 1120px;
        margin: 0 auto;
        padding: 1.25rem 0 2rem;
      }

      .wizard-header {
        display: grid;
        grid-template-columns: 10rem minmax(0, 1fr) auto;
        align-items: center;
        gap: 1rem;
        margin-bottom: 1rem;
      }

      .wizard-header p {
        margin: 0 0 0.1rem;
        color: var(--text-secondary, #64748b);
        font-size: 0.78rem;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0;
      }

      h1,
      h2 {
        margin: 0;
        color: var(--text-primary, #0f172a);
      }

      h1 {
        font-size: 1.55rem;
      }

      h2 {
        font-size: 1.15rem;
      }

      .back-link,
      .primary-btn,
      .secondary-btn {
        min-height: 2.25rem;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 0.4rem;
        border-radius: 0.45rem;
        padding: 0.45rem 0.75rem;
        font-size: 0.84rem;
        font-weight: 700;
        text-decoration: none;
        cursor: pointer;
      }

      .back-link,
      .secondary-btn {
        border: 1px solid var(--border-color, #e5e7eb);
        background: var(--surface-color, #ffffff);
        color: var(--text-primary, #111827);
      }

      .primary-btn {
        border: 1px solid var(--primary-color, #2563eb);
        background: var(--primary-color, #2563eb);
        color: #ffffff;
      }

      .primary-btn:disabled,
      .secondary-btn:disabled {
        opacity: 0.55;
        cursor: default;
      }

      .progress {
        border-radius: 999px;
        background: #eef2ff;
        color: #3730a3;
        padding: 0.3rem 0.65rem;
        font-size: 0.78rem;
        font-weight: 800;
      }

      .wizard-shell {
        display: grid;
        grid-template-columns: 17rem minmax(0, 1fr);
        gap: 1rem;
      }

      .step-list {
        display: flex;
        flex-direction: column;
        gap: 0.45rem;
      }

      .step-pill {
        display: flex;
        align-items: center;
        gap: 0.55rem;
        border: 1px solid var(--border-color, #e5e7eb);
        border-radius: 0.5rem;
        background: var(--surface-color, #ffffff);
        color: var(--text-secondary, #475569);
        padding: 0.6rem;
        text-align: left;
        font-weight: 650;
      }

      .step-pill span {
        display: grid;
        place-items: center;
        width: 1.35rem;
        height: 1.35rem;
        border-radius: 999px;
        background: #f1f5f9;
        font-size: 0.72rem;
      }

      .step-pill--active {
        border-color: var(--primary-color, #2563eb);
        color: var(--primary-color, #2563eb);
      }

      .step-pill--done span {
        background: #dcfce7;
        color: #166534;
      }

      .step-card {
        min-height: 28rem;
        border: 1px solid var(--border-color, #e5e7eb);
        border-radius: 0.5rem;
        background: var(--surface-color, #ffffff);
        padding: 1rem;
        display: flex;
        flex-direction: column;
        gap: 1rem;
      }

      .step-copy {
        margin: 0;
        color: var(--text-secondary, #64748b);
        font-size: 0.9rem;
        line-height: 1.4rem;
      }

      .area-options {
        display: grid;
        gap: 0.75rem;
      }

      .area-option {
        display: flex;
        align-items: flex-start;
        gap: 0.7rem;
        border: 1px solid var(--border-color, #e5e7eb);
        border-radius: 0.5rem;
        padding: 0.85rem;
      }

      .area-option span {
        display: flex;
        flex-direction: column;
        gap: 0.2rem;
      }

      .area-option small {
        color: var(--text-secondary, #64748b);
        line-height: 1.25rem;
      }

      .notes-field {
        display: flex;
        flex-direction: column;
        gap: 0.45rem;
        font-size: 0.85rem;
        font-weight: 700;
        color: var(--text-primary, #111827);
      }

      textarea {
        resize: vertical;
        border: 1px solid var(--border-color, #d1d5db);
        border-radius: 0.45rem;
        padding: 0.75rem;
        font: inherit;
        color: var(--text-primary, #111827);
        background: #ffffff;
      }

      .wizard-actions {
        margin-top: auto;
        display: flex;
        justify-content: flex-end;
        gap: 0.75rem;
      }

      .error-banner {
        margin-bottom: 1rem;
        border: 1px solid #fecaca;
        border-radius: 0.5rem;
        background: #fef2f2;
        color: #991b1b;
        padding: 0.75rem 1rem;
        font-size: 0.87rem;
      }

      @media (max-width: 900px) {
        .wizard-header,
        .wizard-shell {
          grid-template-columns: 1fr;
        }

        .step-list {
          overflow-x: auto;
          flex-direction: row;
          padding-bottom: 0.2rem;
        }

        .step-pill {
          min-width: 10rem;
        }
      }
    `,
  ],
})
export class FiscalActivationWizardComponent implements OnInit {
  readonly service = inject(FiscalActivationWizardService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  readonly areas = FISCAL_AREAS;
  readonly areaLabels = FISCAL_AREA_LABELS;
  readonly stepLabels = FISCAL_STEP_LABELS;
  readonly stepText = signal('');

  readonly currentTitle = computed(() => {
    const step = this.service.currentStep();
    return step ? this.stepLabels[step] : 'Activación fiscal';
  });

  ngOnInit(): void {
    const areasParam = this.route.snapshot.queryParamMap.get('areas');
    const areas = (areasParam || '')
      .split(',')
      .filter((area): area is FiscalArea =>
        FISCAL_AREAS.includes(area as FiscalArea),
      );
    const storeId = Number(this.route.snapshot.queryParamMap.get('store_id'));
    if (Number.isFinite(storeId) && storeId > 0) {
      this.service.targetStoreId.set(storeId);
    }
    this.service.selectedAreas.set(areas.length ? areas : ['invoicing']);
    this.service.currentStepIndex.set(0);

    void this.service.loadStatus().then((result) => {
      const wipArea = FISCAL_AREAS.find(
        (area) => result.fiscal_status[area]?.state === 'WIP',
      );
      if (!wipArea) return;
      const wizard = result.fiscal_status[wipArea].wizard;
      this.service.selectedAreas.set(
        wizard.selected_areas?.length ? wizard.selected_areas : [wipArea],
      );
      const currentStep = wizard.current_step || wizard.step_sequence[0];
      const index = this.service.stepSequence().indexOf(currentStep);
      this.service.currentStepIndex.set(index >= 0 ? index : 0);
    });
  }

  isSelected(area: FiscalArea): boolean {
    return this.service.selectedAreas().includes(area);
  }

  toggleArea(area: FiscalArea): void {
    const current = new Set(this.service.selectedAreas());
    if (current.has(area)) {
      current.delete(area);
    } else {
      current.add(area);
    }
    this.service.selectedAreas.set(Array.from(current));
  }

  canContinue(): boolean {
    if (this.service.currentStep() === 'area_selection') {
      return this.service.selectedAreas().length > 0;
    }
    return true;
  }

  isLastStep(): boolean {
    return (
      this.service.currentStepIndex() ===
      this.service.stepSequence().length - 1
    );
  }

  back(): void {
    this.stepText.set('');
    this.service.currentStepIndex.update((index) => Math.max(index - 1, 0));
  }

  async next(): Promise<void> {
    if (this.service.currentStep() === 'area_selection') {
      await this.service.startWizard(this.service.selectedAreas());
      this.stepText.set('');
      return;
    }

    await this.service.advanceStep({ notes: this.stepText() });
    this.stepText.set('');
  }

  async finish(): Promise<void> {
    if (this.service.currentStep() !== 'area_selection') {
      await this.service.advanceStep({ notes: this.stepText() });
    }
    await this.service.finalize();
    await this.router.navigate(['/admin/settings/fiscal']);
  }

  areaDescription(area: FiscalArea): string {
    if (area === 'invoicing') return 'DIAN, resoluciones, CUFE y facturas electrónicas.';
    if (area === 'accounting') return 'PUC, periodos, mapeos, impuestos y cartera.';
    return 'Empleados, periodos, pagos y soportes de nómina.';
  }

  currentDescription(): string {
    const step = this.service.currentStep();
    const descriptions: Record<string, string> = {
      legal_data: 'Confirma NIT, razón social, régimen y responsabilidades fiscales.',
      dian_config: 'Registra resolución, prefijo y datos de habilitación DIAN.',
      puc: 'Prepara el plan de cuentas que usará la operación.',
      accounting_period: 'Define el periodo fiscal inicial y sus fechas de trabajo.',
      default_taxes: 'Configura IVA, retenciones e impuestos usados por defecto.',
      accounting_mappings: 'Conecta ventas, pagos, inventario y nómina con cuentas contables.',
      initial_inventory: 'Valida saldos iniciales e inventario para entradas automáticas.',
      payroll_config: 'Define frecuencia, reglas y soportes base de nómina.',
      validation: 'Revisa la configuración antes de activar las áreas seleccionadas.',
    };
    return descriptions[step || ''] || 'Selecciona las áreas que quieres activar.';
  }
}
