import {
  Component,
  OnInit,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';

import { FiscalActivationWizardService } from '../../../core/services/fiscal-activation-wizard.service';
import {
  FISCAL_AREAS,
  FISCAL_AREA_LABELS,
  FISCAL_STEP_LABELS,
  FiscalArea,
  FiscalWizardStepId,
} from '../../../core/models/fiscal-status.model';
import {
  ScrollableTab,
  ScrollableTabsComponent,
} from '../scrollable-tabs/scrollable-tabs.component';
import { StickyHeaderComponent } from '../sticky-header/sticky-header.component';
import { IconComponent } from '../icon/icon.component';
import { FiscalWizardStepHost } from './wizard-step.contract';
import { FiscalAreaSelectionStepComponent } from './steps/fiscal-area-selection-step.component';
import { FiscalLegalDataStepComponent } from './steps/fiscal-legal-data-step.component';
import { FiscalDianConfigStepComponent } from './steps/fiscal-dian-config-step.component';
import { FiscalPucStepComponent } from './steps/fiscal-puc-step.component';
import { FiscalAccountingPeriodStepComponent } from './steps/fiscal-accounting-period-step.component';
import { FiscalDefaultTaxesStepComponent } from './steps/fiscal-default-taxes-step.component';
import { FiscalAccountingMappingsStepComponent } from './steps/fiscal-accounting-mappings-step.component';
import { FiscalInitialInventoryStepComponent } from './steps/fiscal-initial-inventory-step.component';
import { FiscalPayrollConfigStepComponent } from './steps/fiscal-payroll-config-step.component';
import { FiscalValidationStepComponent } from './steps/fiscal-validation-step.component';

@Component({
  selector: 'app-fiscal-activation-wizard',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    RouterModule,
    ScrollableTabsComponent,
    StickyHeaderComponent,
    IconComponent,
    FiscalAreaSelectionStepComponent,
    FiscalLegalDataStepComponent,
    FiscalDianConfigStepComponent,
    FiscalPucStepComponent,
    FiscalAccountingPeriodStepComponent,
    FiscalDefaultTaxesStepComponent,
    FiscalAccountingMappingsStepComponent,
    FiscalInitialInventoryStepComponent,
    FiscalPayrollConfigStepComponent,
    FiscalValidationStepComponent,
  ],
  template: `
    <section class="wizard-page">
      <app-sticky-header
        title="Manejo fiscal"
        [subtitle]="areasLabel()"
        [showBackButton]="true"
        backRoute="/admin/settings/fiscal"
        [badgeText]="service.progressLabel()"
        badgeColor="blue"
        variant="glass"
      ></app-sticky-header>

      <div class="wizard-content">
        @if (showStoreSwitcher()) {
          <div class="store-switcher">
            <label class="store-switcher__label" for="fiscal-wizard-store-select">Tienda fiscal</label>
            <select
              id="fiscal-wizard-store-select"
              class="store-switcher__select"
              [ngModel]="service.targetStoreId()"
              (ngModelChange)="selectStore($event)"
              aria-label="Tienda fiscal"
            >
              @for (store of storeStatuses(); track store.store_id) {
                <option [ngValue]="store.store_id">{{ store.store_name }}</option>
              }
            </select>
          </div>
        }

        @if (service.error()) {
          <div class="error-banner">{{ service.error() }}</div>
        }

        <div class="mobile-step-tabs">
          <app-scrollable-tabs
            [tabs]="stepTabs()"
            [activeTab]="activeStepTab()"
            size="sm"
            ariaLabel="Pasos de activación fiscal"
            (tabChange)="goToStepById($event)"
          ></app-scrollable-tabs>
        </div>

        <div class="wizard-shell">
          <aside class="step-list" aria-label="Pasos de activación fiscal">
            @for (step of service.stepSequence(); track step; let i = $index) {
              <button
                type="button"
                class="step-pill"
                [class.step-pill--active]="i === service.currentStepIndex()"
                [class.step-pill--done]="isStepDone(step)"
                [disabled]="!canNavigateToStep(i)"
                (click)="goToStep(i)"
              >
                <span class="step-index">
                  @if (isStepDone(step)) {
                    <app-icon name="check" [size]="13"></app-icon>
                  } @else {
                    {{ i + 1 }}
                  }
                </span>
                <span class="step-label">{{ stepLabels[step] }}</span>
              </button>
            }
          </aside>

          <article class="step-card">
            <div class="step-heading">
              <p>
                Paso {{ service.currentStepIndex() + 1 }} de
                {{ service.stepSequence().length }}
              </p>
              <h1>{{ currentTitle() }}</h1>
              <span>{{ currentDescription() }}</span>
            </div>

            @switch (service.currentStep()) {
              @case ('area_selection') {
                <app-fiscal-area-selection-step #step />
              }
              @case ('legal_data') {
                <app-fiscal-legal-data-step #step />
              }
              @case ('dian_config') {
                <app-fiscal-dian-config-step #step />
              }
              @case ('puc') {
                <app-fiscal-puc-step #step />
              }
              @case ('accounting_period') {
                <app-fiscal-accounting-period-step #step />
              }
              @case ('default_taxes') {
                <app-fiscal-default-taxes-step #step />
              }
              @case ('accounting_mappings') {
                <app-fiscal-accounting-mappings-step #step />
              }
              @case ('initial_inventory') {
                <app-fiscal-initial-inventory-step #step />
              }
              @case ('payroll_config') {
                <app-fiscal-payroll-config-step #step />
              }
              @case ('validation') {
                <app-fiscal-validation-step #step />
              }
            }

            <footer class="wizard-actions">
              <button
                class="secondary-btn"
                type="button"
                (click)="back()"
                [disabled]="
                  service.currentStepIndex() === 0 ||
                  service.submitting() ||
                  step()?.submitting()
                "
              >
                Atrás
              </button>
              @if (isLastStep()) {
                <button
                  class="primary-btn"
                  type="button"
                  (click)="finish()"
                  [disabled]="
                    !step()?.valid() ||
                    service.submitting() ||
                    step()?.submitting()
                  "
                >
                  Finalizar activación
                </button>
              } @else {
                <button
                  class="primary-btn"
                  type="button"
                  (click)="onNext()"
                  [disabled]="
                    !step()?.valid() ||
                    service.submitting() ||
                    step()?.submitting()
                  "
                >
                  Continuar
                </button>
              }
            </footer>
          </article>
        </div>
      </div>
    </section>
  `,
  styles: [
    `
      .wizard-page {
        width: 100%;
        min-height: 100%;
      }

      .wizard-content {
        width: min(1120px, 100%);
        margin: 0 auto;
        padding: 1rem 0 2rem;
      }

      .mobile-step-tabs {
        display: block;
        margin-bottom: 0.85rem;
      }

      .store-switcher {
        display: flex;
        align-items: center;
        gap: 0.6rem;
        margin-bottom: 1rem;
      }

      .store-switcher__label {
        color: var(--text-secondary, #64748b);
        font-size: 0.78rem;
        font-weight: 700;
        text-transform: uppercase;
      }

      .store-switcher__select {
        min-height: 2.25rem;
        border: 1px solid var(--border-color, #d1d5db);
        border-radius: 0.45rem;
        background: var(--surface-color, #ffffff);
        color: var(--text-primary, #111827);
        padding: 0.45rem 0.7rem;
        font: inherit;
        font-size: 0.84rem;
      }

      .wizard-shell {
        display: grid;
        grid-template-columns: 1fr;
        gap: 1rem;
      }

      .step-list {
        display: none;
      }

      .step-pill {
        min-height: 2.75rem;
        display: flex;
        align-items: center;
        gap: 0.6rem;
        border: 1px solid var(--border-color, #e5e7eb);
        border-radius: 0.5rem;
        background: var(--surface-color, #ffffff);
        color: var(--text-secondary, #475569);
        padding: 0.65rem;
        text-align: left;
        font-weight: 650;
        cursor: pointer;
      }

      .step-pill:disabled {
        cursor: default;
        opacity: 0.55;
      }

      .step-index,
      .validation-state {
        flex: 0 0 auto;
        display: grid;
        place-items: center;
        width: 1.45rem;
        height: 1.45rem;
        border-radius: 999px;
        background: var(--surface-muted, #f1f5f9);
        color: var(--text-secondary, #475569);
        font-size: 0.72rem;
        font-weight: 800;
      }

      .step-label {
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .step-pill--active {
        border-color: var(--primary-color, #2563eb);
        color: var(--primary-color, #2563eb);
        box-shadow: 0 0 0 3px
          color-mix(in srgb, var(--primary-color, #2563eb) 12%, transparent);
      }

      .step-pill--done .step-index,
      .validation-state {
        background: color-mix(
          in srgb,
          var(--success-color, #16a34a) 14%,
          #ffffff
        );
        color: var(--success-color, #166534);
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

      .step-heading {
        display: grid;
        gap: 0.3rem;
      }

      .step-heading p,
      .step-heading h1,
      .step-heading span {
        margin: 0;
      }

      .step-heading p {
        color: var(--text-secondary, #64748b);
        font-size: 0.78rem;
        font-weight: 800;
        text-transform: uppercase;
      }

      .step-heading h1 {
        color: var(--text-primary, #0f172a);
        font-size: 1.25rem;
      }

      .step-heading span,
      .canonical-step span,
      .validation-row small {
        color: var(--text-secondary, #64748b);
        font-size: 0.9rem;
        line-height: 1.4rem;
      }

      .area-options,
      .validation-list {
        display: grid;
        gap: 0.75rem;
      }

      .area-option,
      .validation-row,
      .canonical-step {
        border: 1px solid var(--border-color, #e5e7eb);
        border-radius: 0.5rem;
        background: var(--surface-color, #ffffff);
      }

      .area-option {
        display: flex;
        align-items: flex-start;
        gap: 0.7rem;
        padding: 0.85rem;
      }

      .area-option input {
        margin-top: 0.2rem;
      }

      .area-option span,
      .validation-row div,
      .canonical-step div {
        display: flex;
        flex-direction: column;
        gap: 0.2rem;
      }

      .area-option small {
        color: var(--text-secondary, #64748b);
        line-height: 1.25rem;
      }

      .validation-row {
        display: flex;
        align-items: flex-start;
        gap: 0.7rem;
        padding: 0.85rem;
      }

      .validation-row--missing .validation-state {
        background: color-mix(
          in srgb,
          var(--warning-color, #f59e0b) 14%,
          #ffffff
        );
        color: var(--warning-color, #92400e);
      }

      .canonical-step {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 1rem;
        padding: 1rem;
      }

      .dedicated-link,
      .primary-btn,
      .secondary-btn {
        min-height: 2.5rem;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 0.4rem;
        border-radius: 0.45rem;
        padding: 0.5rem 0.8rem;
        font-size: 0.84rem;
        font-weight: 750;
        text-decoration: none;
        cursor: pointer;
        white-space: nowrap;
      }

      .dedicated-link,
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

      @media (max-width: 640px) {
        .store-switcher {
          align-items: stretch;
          flex-direction: column;
        }
      }

      @media (max-width: 720px) {
        .wizard-content {
          padding-inline: 0.75rem;
        }

        .canonical-step,
        .wizard-actions {
          align-items: stretch;
          flex-direction: column;
        }

        .dedicated-link,
        .primary-btn,
        .secondary-btn {
          width: 100%;
        }
      }

      @media (min-width: 921px) {
        .wizard-content {
          padding: 1.25rem 0 2rem;
        }

        .mobile-step-tabs {
          display: none;
        }

        .wizard-shell {
          grid-template-columns: 17rem minmax(0, 1fr);
        }

        .step-list {
          display: flex;
          flex-direction: column;
          gap: 0.45rem;
        }
      }
    `,
  ],
})
export class FiscalActivationWizardComponent implements OnInit {
  readonly service = inject(FiscalActivationWizardService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  readonly step = viewChild<FiscalWizardStepHost>('step');

  readonly areas = FISCAL_AREAS;
  readonly areaLabels = FISCAL_AREA_LABELS;
  readonly stepLabels = FISCAL_STEP_LABELS;

  readonly currentTitle = computed(() => {
    const step = this.service.currentStep();
    return step ? this.stepLabels[step] : 'Activación fiscal';
  });

  readonly areasLabel = computed(() => {
    const labels = this.service
      .selectedAreas()
      .map((area) => this.areaLabels[area]);
    return labels.length ? labels.join(' · ') : 'Selecciona áreas fiscales';
  });

  readonly stepTabs = computed<ScrollableTab[]>(() =>
    this.service.stepSequence().map((step, index) => ({
      id: step,
      label: `${index + 1}. ${this.stepLabels[step]}`,
    })),
  );

  readonly activeStepTab = computed(() => this.service.currentStep() ?? '');

  readonly storeStatuses = computed(
    () => this.service.lastStatus()?.store_statuses ?? [],
  );

  /**
   * Show the store switcher in the wizard header only when the logged-in
   * user is ORG_ADMIN and the org has more than one store. With a single
   * store there is no choice to make and the service auto-pins `targetStoreId`
   * from `loadStatus()`.
   */
  readonly showStoreSwitcher = computed(
    () =>
      this.service.userScope() === 'organization' &&
      this.service.fiscalDataOwner() === 'store' &&
      this.storeStatuses().length > 1,
  );

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

    void this.service.loadStatus().then(() => {
      this.service.restoreWizardFromCurrentStatus();
    });
  }

  canNavigateToStep(index: number): boolean {
    const step = this.service.stepSequence()[index];
    return index <= this.service.currentStepIndex() || this.isStepDone(step);
  }

  isStepDone(step: FiscalWizardStepId): boolean {
    return this.service.completedSteps().includes(step);
  }

  isLastStep(): boolean {
    return (
      this.service.currentStepIndex() === this.service.stepSequence().length - 1
    );
  }

  goToStep(index: number): void {
    if (!this.canNavigateToStep(index)) return;
    this.service.currentStepIndex.set(index);
  }

  goToStepById(stepId: string): void {
    const index = this.service
      .stepSequence()
      .indexOf(stepId as FiscalWizardStepId);
    if (index >= 0) {
      this.goToStep(index);
    }
  }

  back(): void {
    this.service.currentStepIndex.update((index) => Math.max(index - 1, 0));
  }

  selectStore(storeId: number): void {
    this.service.targetStoreId.set(Number(storeId));
    this.service.restoreWizardFromCurrentStatus();
  }

  async onNext(): Promise<void> {
    const stepHost = this.step();
    if (!stepHost) return;
    const result = await stepHost.submit();
    // Steps that successfully persist via canonical endpoint return { ref };
    // they have already advanced via service.commitStep() (or startWizard for
    // area_selection). On null we stay on the same step with inline error.
    if (result === null) return;
  }

  async finish(): Promise<void> {
    const stepHost = this.step();
    if (!stepHost) return;
    const result = await stepHost.submit();
    if (result === null) return;
    await this.router.navigate(['/admin/settings/fiscal']);
  }

  currentDescription(): string {
    const step = this.service.currentStep();
    const descriptions: Record<FiscalWizardStepId, string> = {
      area_selection: 'Elige las áreas que vas a activar en este flujo.',
      legal_data:
        'Confirma NIT, razón social, régimen y responsabilidades fiscales.',
      dian_config: 'Registra resolución, prefijo y datos de habilitación DIAN.',
      puc: 'Prepara el plan de cuentas que usará la operación.',
      accounting_period:
        'Define el periodo fiscal inicial y sus fechas de trabajo.',
      default_taxes:
        'Configura IVA, retenciones e impuestos usados por defecto.',
      accounting_mappings:
        'Conecta ventas, pagos, inventario y nómina con cuentas contables.',
      initial_inventory:
        'Valida saldos iniciales e inventario para entradas automáticas.',
      payroll_config: 'Define frecuencia, reglas y soportes base de nómina.',
      validation:
        'Revisa la configuración antes de activar las áreas seleccionadas.',
    };
    return step
      ? descriptions[step]
      : 'Selecciona las áreas que quieres activar.';
  }

}
