import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';

import { FiscalActivationWizardService } from '../../../../../../../core/services/fiscal-activation-wizard.service';
import {
  FISCAL_STEP_LABELS,
  type FiscalWizardStepId,
} from '../../../../../../../core/models/fiscal-status.model';
import { parseApiError } from '../../../../../../../core/utils/parse-api-error';
import { ButtonComponent } from '../../../../../../../shared/components/button/button.component';
import { CardComponent } from '../../../../../../../shared/components/card/card.component';
import { ConfirmationModalComponent } from '../../../../../../../shared/components/confirmation-modal/confirmation-modal.component';
import {
  summarizeReadiness,
  type ProductionReadinessReport,
} from '../../../../../../../shared/components/dian';
import { IconComponent } from '../../../../../../../shared/components/icon/icon.component';
import { ToastService } from '../../../../../../../shared/components/toast/toast.service';
import { DianConfigApiService } from '../../../../../../../shared/services/dian';
import { isProductionActive, stepForReadinessCheck } from '../activation-step.util';
import { ACTIVATION_STEPS } from '../activation-wizard.model';
import type { ActivationContext, ActivationStepId } from '../activation-wizard.model';

/**
 * Paso 6 del asistente: pasar a producción y cerrar el módulo de facturación.
 * La habilitación DIAN real es la única fuente de verdad; el área `invoicing`
 * del asistente fiscal se finaliza DESPUÉS de que la DIAN esté en producción.
 */
@Component({
  selector: 'vendix-activation-promote-step',
  standalone: true,
  imports: [
    RouterLink,
    ButtonComponent,
    CardComponent,
    ConfirmationModalComponent,
    IconComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="flex flex-col gap-3">
      @if (context().readOnly) {
        <div
          class="rounded-lg border border-border bg-surface px-3 py-2 text-xs text-text-secondary"
          role="status"
        >
          <app-icon name="lock" [size]="14" class="mr-1 inline-block"></app-icon>
          {{ context().readOnlyReason ?? 'Este paso es de solo lectura.' }}
        </div>
      }

      @if (productionActive()) {
        <app-card [responsive]="true">
          <div class="flex flex-col gap-2">
            <h3 class="flex items-center gap-1.5 text-sm font-semibold text-text-primary">
              <app-icon name="check-circle" [size]="16" class="text-success"></app-icon>
              Producción activa
            </h3>
            <p class="text-xs text-text-secondary">
              La facturación electrónica ya emite documentos reales ante la DIAN.
            </p>

            @if (moduleActive()) {
              <p class="text-sm font-medium text-text-primary">
                Módulo de facturación activo
              </p>
              <div>
                <a routerLink="/admin/invoicing/invoices">
                  <app-button size="sm" variant="primary">Ir a Facturación</app-button>
                </a>
              </div>
            } @else if (missingLabels().length > 0) {
              <div class="rounded-lg border border-border bg-background px-3 py-2 text-xs">
                <p class="font-semibold text-text-primary">
                  Faltan pasos en el asistente fiscal para activar el módulo:
                </p>
                <ul class="mt-1 list-disc pl-5 text-text-secondary">
                  @for (label of missingLabels(); track label) {
                    <li>{{ label }}</li>
                  }
                </ul>
                <a
                  class="mt-2 inline-block font-medium text-primary underline"
                  routerLink="/admin/fiscal/wizard"
                  [queryParams]="{ areas: 'invoicing' }"
                >
                  Completar en el asistente fiscal
                </a>
              </div>
              <div>
                <app-button
                  size="sm"
                  variant="outline"
                  [disabled]="context().readOnly || closing()"
                  [loading]="closing()"
                  (clicked)="closeModule()"
                >
                  Reintentar activación
                </app-button>
              </div>
            } @else {
              <p class="text-xs text-text-secondary">
                {{ closing() ? 'Activando el módulo de facturación...' : 'El módulo de facturación aún no está activo.' }}
              </p>
              @if (closeError()) {
                <p class="text-xs text-error" role="alert">{{ closeError() }}</p>
              }
              @if (!closing()) {
                <div>
                  <app-button
                    size="sm"
                    variant="outline"
                    [disabled]="context().readOnly"
                    (clicked)="closeModule()"
                  >
                    Reintentar activación
                  </app-button>
                </div>
              }
            }
          </div>
        </app-card>
      } @else {
        <app-card [responsive]="true">
          <div class="flex flex-col gap-3">
            <h3 class="text-sm font-semibold text-text-primary">
              Revisión antes de producción
            </h3>

            @if (loading()) {
              <p class="text-xs text-text-secondary">Revisando requisitos...</p>
            } @else if (loadError()) {
              <p class="text-xs text-error" role="alert">{{ loadError() }}</p>
            } @else if (summary(); as s) {
              @if (s.todo.length > 0) {
                <div>
                  <p class="mb-1 text-xs font-semibold text-text-primary">
                    Lo que falta por hacer
                  </p>
                  <ul class="flex flex-col gap-2">
                    @for (check of s.todo; track check.key) {
                      <li
                        class="flex flex-col gap-1 rounded-lg border border-border bg-background p-2 sm:flex-row sm:items-center sm:justify-between"
                      >
                        <div class="min-w-0">
                          <p class="text-sm font-medium text-text-primary">{{ check.label }}</p>
                          @if (check.action) {
                            <p class="text-[11px] text-text-secondary">{{ check.action }}</p>
                          }
                        </div>
                        @if (stepFor(check.key); as target) {
                          <app-button
                            size="sm"
                            variant="outline"
                            (clicked)="goToStep.emit(target.id)"
                          >
                            Ir al paso {{ target.index }}
                          </app-button>
                        }
                      </li>
                    }
                  </ul>
                </div>
              }

              @if (s.waiting.length > 0) {
                <div
                  class="rounded-lg border border-border bg-surface px-3 py-2 text-xs"
                  role="status"
                >
                  <p class="flex items-center gap-1.5 font-semibold text-text-primary">
                    <app-icon name="clock" [size]="14"></app-icon>
                    Esperando a la DIAN
                  </p>
                  <ul class="mt-1 list-disc pl-5 text-text-secondary">
                    @for (check of s.waiting; track check.key) {
                      <li>{{ check.label }}</li>
                    }
                  </ul>
                  <p class="mt-1 text-text-secondary">
                    No requiere acción suya. Puede cerrar y volver: el asistente retoma solo.
                  </p>
                </div>
              }

              @if (s.warnings.length > 0) {
                <div class="text-xs">
                  <p class="mb-1 font-semibold text-text-primary">Avisos</p>
                  <ul class="list-disc pl-5 text-text-secondary">
                    @for (check of s.warnings; track check.key) {
                      <li>{{ check.label }}@if (check.action) { — {{ check.action }} }</li>
                    }
                  </ul>
                </div>
              }

              @if (s.todo.length === 0 && s.waiting.length === 0 && s.ready) {
                <p class="flex items-center gap-1.5 text-sm text-text-primary">
                  <app-icon name="check-circle" [size]="16" class="text-success"></app-icon>
                  Todo está listo para pasar a producción.
                </p>
              }
            }

            @if (promoteError()) {
              <p class="text-xs text-error" role="alert">{{ promoteError() }}</p>
            }

            <div>
              <app-button
                size="sm"
                variant="primary"
                [disabled]="!canPromote()"
                [loading]="promoting()"
                (clicked)="confirmVisible.set(true)"
              >
                Pasar a producción
              </app-button>
            </div>
          </div>
        </app-card>
      }

      @if (confirmVisible()) {
        <app-confirmation-modal
          [isOpen]="true"
          title="Pasar a producción"
          message="La facturación electrónica pasará a producción: sus documentos saldrán a la DIAN como documentos reales, con consecutivos que no se recuperan. En la práctica este paso es irreversible. El sistema vuelve a verificar cada requisito antes de aceptarlo."
          confirmText="Pasar a producción"
          cancelText="Cancelar"
          confirmVariant="primary"
          (confirm)="promote()"
          (cancel)="confirmVisible.set(false)"
        ></app-confirmation-modal>
      }
    </div>
  `,
})
export class ActivationPromoteStepComponent {
  private readonly api = inject(DianConfigApiService);
  private readonly fiscal = inject(FiscalActivationWizardService);
  private readonly toast = inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);

  readonly context = input.required<ActivationContext>();
  readonly changed = output<void>();
  /** Navegación a otro paso (la conecta el shell). */
  readonly goToStep = output<ActivationStepId>();

  readonly report = signal<ProductionReadinessReport | null>(null);
  readonly loading = signal(false);
  readonly loadError = signal<string | null>(null);
  readonly confirmVisible = signal(false);
  readonly promoting = signal(false);
  readonly promoteError = signal<string | null>(null);
  readonly closing = signal(false);
  readonly closeError = signal<string | null>(null);

  readonly productionActive = computed(() => isProductionActive(this.context().axis));
  readonly summary = computed(() =>
    this.report() ? summarizeReadiness(this.report()) : null,
  );
  readonly canPromote = computed(
    () =>
      !this.context().readOnly &&
      !this.loading() &&
      !this.promoting() &&
      this.summary()?.ready === true,
  );

  readonly moduleActive = computed(() => {
    const state = this.fiscal.lastStatus()?.fiscal_status?.invoicing?.state;
    return state === 'ACTIVE' || state === 'LOCKED';
  });

  readonly missingLabels = computed<string[]>(() => {
    const missing = this.fiscal.finalizeMissingSteps().invoicing ?? [];
    return missing.map((step: FiscalWizardStepId) => FISCAL_STEP_LABELS[step] ?? step);
  });

  private closeTried = false;

  constructor() {
    // Carga el checklist cuando todavía no está en producción.
    effect(() => {
      const axis = this.context().axis;
      const active = this.productionActive();
      untracked(() => {
        if (active || !axis?.config_id) {
          this.report.set(null);
          return;
        }
        this.loadReadiness(axis.config_id);
      });
    });

    // Producción activa y área aún no ACTIVE/LOCKED: cierra el módulo una vez.
    effect(() => {
      if (!this.productionActive() || this.context().readOnly) return;
      untracked(() => {
        if (this.closeTried) return;
        this.closeTried = true;
        void this.ensureModuleClosed();
      });
    });
  }

  stepFor(key: string): { id: ActivationStepId; index: number } | null {
    const id = stepForReadinessCheck(key);
    if (!id) return null;
    const step = ACTIVATION_STEPS.find((s) => s.id === id);
    return step ? { id, index: step.index } : null;
  }

  promote(): void {
    this.confirmVisible.set(false);
    const configId = this.context().axis?.config_id ?? null;
    if (configId === null || this.promoting()) return;
    this.promoting.set(true);
    this.promoteError.set(null);
    this.api
      .promoteDianToProduction(configId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.promoting.set(false);
          this.toast.success('Facturación electrónica activada en producción.');
          this.closeTried = true;
          void this.closeModule().finally(() => this.changed.emit());
        },
        error: (err: unknown) => {
          this.promoting.set(false);
          this.promoteError.set(parseApiError(err).userMessage);
          // El checklist se recarga para que el motivo quede en pantalla.
          this.loadReadiness(configId);
        },
      });
  }

  /** Finaliza SOLO el área `invoicing`. */
  async closeModule(): Promise<void> {
    if (this.closing()) return;
    this.closing.set(true);
    this.closeError.set(null);
    try {
      await this.fiscal.finalizeArea('invoicing');
    } catch (err) {
      const parsed = parseApiError(err);
      if (parsed.errorCode !== 'FISCAL_STATUS_INCOMPLETE') {
        this.closeError.set(parsed.userMessage);
      }
    } finally {
      this.closing.set(false);
    }
  }

  private async ensureModuleClosed(): Promise<void> {
    try {
      if (!this.fiscal.lastStatus()) await this.fiscal.loadStatus();
    } catch {
      // Sin estado no se puede decidir; el reintento manual queda disponible.
      return;
    }
    if (!this.moduleActive()) await this.closeModule();
  }

  private loadReadiness(configId: number): void {
    this.loading.set(true);
    this.loadError.set(null);
    this.api
      .getDianProductionReadiness(configId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res: any) => {
          this.report.set((res?.data ?? null) as ProductionReadinessReport | null);
          this.loading.set(false);
        },
        error: (err: unknown) => {
          this.loadError.set(parseApiError(err).userMessage);
          this.loading.set(false);
        },
      });
  }
}
