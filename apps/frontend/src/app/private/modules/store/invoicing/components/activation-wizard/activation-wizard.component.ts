import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';

import { AuthFacade } from '../../../../../../core/store/auth/auth.facade';
import { FiscalActivationWizardService } from '../../../../../../core/services/fiscal-activation-wizard.service';
import { parseApiError } from '../../../../../../core/utils/parse-api-error';
import { AlertBannerComponent } from '../../../../../../shared/components/alert-banner/alert-banner.component';
import { ButtonComponent } from '../../../../../../shared/components/button/button.component';
import { CardComponent } from '../../../../../../shared/components/card/card.component';
import type { FiscalReadinessResponse } from '../../../../../../shared/components/dian/fiscal-readiness.interface';
import { IconComponent } from '../../../../../../shared/components/icon/icon.component';
import { StepsLineComponent, type StepsLineItem } from '../../../../../../shared/components/steps-line/steps-line.component';
import { StickyHeaderComponent } from '../../../../../../shared/components/sticky-header/sticky-header.component';
import { DianConfigApiService } from '../../../../../../shared/services/dian';
import type { DianConfig } from '../../interfaces/invoice.interface';
import {
  activationOverallState,
  canEnterStep,
  isStepCompleted,
  nextActivationStep,
  selectSalesInvoiceAxis,
} from './activation-step.util';
import {
  ACTIVATION_STEPS,
  type ActivationContext,
  type ActivationScope,
  type ActivationSnapshot,
  type ActivationStepId,
} from './activation-wizard.model';
import { ActivationCertificateStepComponent } from './steps/activation-certificate-step.component';
import { ActivationCompanyStepComponent } from './steps/activation-company-step.component';
import { ActivationProductionRangesStepComponent } from './steps/activation-production-ranges-step.component';
import { ActivationPromoteStepComponent } from './steps/activation-promote-step.component';
import { ActivationSoftwareStepComponent } from './steps/activation-software-step.component';
import { ActivationTestingStepComponent } from './steps/activation-testing-step.component';

const STORE_OWNED_BY_ORG_REASON =
  'La facturación electrónica de esta tienda la gestiona la organización.';
const NO_WRITE_PERMISSION_REASON =
  'No tienes permiso para modificar la facturación electrónica.';

/**
 * Asistente "Activar facturación electrónica": un flujo lineal de 6 pasos que
 * reemplaza el ir y venir entre módulos.
 *
 * El paso actual se DERIVA del estado real del backend (`nextActivationStep`);
 * no se persiste progreso. Lo monta la ruta `/admin/invoicing/activation` tanto
 * en el panel de tienda como en el de organización: el `DIAN_API_CONTEXT` de la
 * ruta decide a qué rail habla `DianConfigApiService`.
 */
@Component({
  selector: 'vendix-activation-wizard',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    AlertBannerComponent,
    ButtonComponent,
    CardComponent,
    IconComponent,
    StepsLineComponent,
    StickyHeaderComponent,
    ActivationCompanyStepComponent,
    ActivationSoftwareStepComponent,
    ActivationCertificateStepComponent,
    ActivationTestingStepComponent,
    ActivationProductionRangesStepComponent,
    ActivationPromoteStepComponent,
  ],
  template: `
    <div class="w-full">
      <app-sticky-header
        title="Activar facturación electrónica"
        subtitle="Sigue los pasos para empezar a emitir facturas válidas ante la DIAN"
        icon="file-check"
        variant="glass"
        [showBackButton]="true"
        [backRoute]="backRoute()"
      />

      <div class="mx-auto w-full max-w-4xl flex flex-col gap-4 p-3 sm:p-4">
        @if (organizationDefersToStores()) {
          <app-card>
            <div class="flex items-start gap-3 py-2">
              <app-icon name="store" [size]="20" class="text-[var(--color-text-secondary)] shrink-0 mt-0.5"></app-icon>
              <p class="text-sm text-[var(--color-text-primary)]">
                Cada tienda habilita su propia facturación electrónica: entra al panel de la tienda.
              </p>
            </div>
          </app-card>
        } @else if (loading()) {
          <div class="flex flex-col gap-4 animate-pulse" aria-busy="true" aria-label="Cargando asistente">
            <div class="h-14 rounded-xl bg-[var(--color-surface-secondary)]"></div>
            <div class="h-72 rounded-xl bg-[var(--color-surface-secondary)]"></div>
          </div>
        } @else if (loadError(); as message) {
          <app-card>
            <div class="flex flex-col items-center gap-3 py-8 text-center">
              <app-icon name="alert-triangle" [size]="28" class="text-[var(--color-warning)]"></app-icon>
              <p class="text-sm font-medium text-[var(--color-text-primary)]">No pudimos cargar el asistente</p>
              <p class="text-xs text-[var(--color-text-secondary)] max-w-md">{{ message }}</p>
              <app-button variant="outline" size="sm" (clicked)="reload()">Reintentar</app-button>
            </div>
          </app-card>
        } @else {
          <div class="overflow-x-auto" role="navigation" aria-label="Pasos de activación">
            <div class="min-w-[34rem]">
              <app-steps-line
                [steps]="stepItems()"
                [currentStep]="currentIndex()"
                [clickable]="true"
                size="sm"
                (stepClicked)="onStepClicked($event)"
              ></app-steps-line>
            </div>
          </div>

          <div class="min-w-0">
            <p class="text-xs text-[var(--color-text-secondary)]">
              Paso {{ currentIndex() + 1 }} de {{ steps.length }} · {{ currentMeta().description }}
            </p>
          </div>

          @if (completed()) {
            <app-alert-banner variant="success" icon="check-circle">
              La facturación electrónica está activa.
            </app-alert-banner>
          }

          @switch (currentStep()) {
            @case ('company') {
              <vendix-activation-company-step [context]="context()" (changed)="onStepChanged()" />
            }
            @case ('software') {
              <vendix-activation-software-step [context]="context()" (changed)="onStepChanged()" />
            }
            @case ('certificate') {
              <vendix-activation-certificate-step [context]="context()" (changed)="onStepChanged()" />
            }
            @case ('testing') {
              <vendix-activation-testing-step [context]="context()" (changed)="onStepChanged()" />
            }
            @case ('production_ranges') {
              <vendix-activation-production-ranges-step [context]="context()" (changed)="onStepChanged()" />
            }
            @case ('promote') {
              <vendix-activation-promote-step
                [context]="context()"
                (changed)="onStepChanged()"
                (goToStep)="goToStep($event)"
              />
            }
          }

          <div class="flex flex-wrap items-center justify-between gap-2 pt-1">
            <app-button variant="outline" [disabled]="!hasPrevious()" (clicked)="previous()">
              <span class="inline-flex items-center gap-2">
                <app-icon name="chevron-left" [size]="16"></app-icon>
                Anterior
              </span>
            </app-button>

            @if (completed() && currentStep() === 'promote') {
              <app-button variant="primary" (clicked)="goToInvoices()">
                <span class="inline-flex items-center gap-2">
                  Ir a Facturación
                  <app-icon name="arrow-right" [size]="16"></app-icon>
                </span>
              </app-button>
            } @else {
              <app-button variant="primary" [disabled]="!canGoNext()" (clicked)="next()">
                <span class="inline-flex items-center gap-2">
                  Siguiente
                  <app-icon name="chevron-right" [size]="16"></app-icon>
                </span>
              </app-button>
            }
          </div>
        }
      </div>
    </div>
  `,
})
export class ActivationWizardComponent {
  private readonly api = inject(DianConfigApiService);
  private readonly fiscalWizard = inject(FiscalActivationWizardService);
  private readonly auth = inject(AuthFacade);
  private readonly router = inject(Router);

  readonly steps = ACTIVATION_STEPS;

  readonly loading = signal(true);
  readonly loadError = signal<string | null>(null);
  readonly currentStep = signal<ActivationStepId>('company');

  private readonly snapshot = signal<ActivationSnapshot>({
    legalDataComplete: false,
    axis: null,
    config: null,
  });
  private readonly fiscalScope = signal<string | null>(null);
  private statusLoaded = false;
  private initialStepSet = false;

  /** Tipo de panel del usuario (decide el rail), no el `fiscal_scope` de la organización. */
  readonly scope = computed<ActivationScope>(() => this.fiscalWizard.userScope());

  /** La organización delega la facturación a cada tienda: sus endpoints responden 400. */
  readonly organizationDefersToStores = computed(
    () => this.scope() === 'organization' && this.auth.fiscalScope() === 'STORE',
  );

  readonly canWrite = computed(() =>
    this.auth.hasPermission(
      this.scope() === 'store' ? 'invoicing:write' : 'organization:invoicing:dian:write',
    ),
  );

  readonly context = computed<ActivationContext>(() => {
    const scope = this.scope();
    const ownedByOrganization = scope === 'store' && this.fiscalScope() === 'ORGANIZATION';
    const reason = ownedByOrganization
      ? STORE_OWNED_BY_ORG_REASON
      : !this.canWrite()
        ? NO_WRITE_PERMISSION_REASON
        : null;
    return {
      ...this.snapshot(),
      scope,
      readOnly: reason !== null,
      readOnlyReason: reason,
    };
  });

  readonly backRoute = computed(() =>
    this.auth.fiscalStatus()?.invoicing?.state === 'ACTIVE' ? '/admin/invoicing' : '/admin/fiscal',
  );

  readonly completed = computed(() => activationOverallState(this.snapshot()) === 'completed');

  readonly currentIndex = computed(() =>
    Math.max(0, ACTIVATION_STEPS.findIndex((s) => s.id === this.currentStep())),
  );
  readonly currentMeta = computed(() => ACTIVATION_STEPS[this.currentIndex()]);

  readonly stepItems = computed<StepsLineItem[]>(() => {
    const snapshot = this.snapshot();
    return ACTIVATION_STEPS.map((step) => ({
      label: step.label,
      completed: isStepCompleted(step.id, snapshot),
    }));
  });

  readonly hasPrevious = computed(() => this.currentIndex() > 0);
  readonly canGoNext = computed(
    () =>
      this.currentIndex() < ACTIVATION_STEPS.length - 1 &&
      isStepCompleted(this.currentStep(), this.snapshot()),
  );

  constructor() {
    if (!this.organizationDefersToStores()) {
      void this.reload();
    }
  }

  async reload(): Promise<void> {
    const firstLoad = !this.initialStepSet;
    if (firstLoad) this.loading.set(true);
    this.loadError.set(null);
    try {
      if (!this.statusLoaded) {
        await this.fiscalWizard.loadStatus();
        this.statusLoaded = true;
      }
      const [readinessRes, prefill] = await Promise.all([
        firstValueFrom(this.api.getFiscalReadiness()),
        this.fiscalWizard.loadPrefill(true),
      ]);
      const readiness = (readinessRes?.data ?? readinessRes) as FiscalReadinessResponse | null;
      const axis = selectSalesInvoiceAxis(readiness);

      let config: DianConfig | null = null;
      if (axis?.config_id) {
        const configRes = await firstValueFrom(this.api.getDianConfigById(axis.config_id));
        config = (configRes?.data ?? configRes) as DianConfig | null;
      }

      this.fiscalScope.set(readiness?.fiscal_scope ?? null);
      this.snapshot.set({
        legalDataComplete: (prefill?.satisfied_steps ?? []).includes('legal_data'),
        axis,
        config,
      });

      if (!this.initialStepSet) {
        this.currentStep.set(nextActivationStep(this.snapshot()));
        this.initialStepSet = true;
      }
    } catch (error) {
      this.loadError.set(parseApiError(error).userMessage);
    } finally {
      this.loading.set(false);
    }
  }

  /** Un paso persistió algo: recarga y, si el paso visible quedó completo, avanza. */
  async onStepChanged(): Promise<void> {
    await this.reload();
    if (this.loadError()) return;
    const snapshot = this.snapshot();
    if (isStepCompleted(this.currentStep(), snapshot)) {
      this.currentStep.set(nextActivationStep(snapshot));
    }
  }

  onStepClicked(index: number): void {
    const step = ACTIVATION_STEPS[index];
    if (step && canEnterStep(step.id, this.snapshot())) {
      this.currentStep.set(step.id);
    }
  }

  /** Atajo desde el checklist de readiness del paso 6 ("Ir al paso N"). */
  goToStep(step: ActivationStepId): void {
    if (canEnterStep(step, this.snapshot())) this.currentStep.set(step);
  }

  previous(): void {
    const prev = ACTIVATION_STEPS[this.currentIndex() - 1];
    if (prev) this.currentStep.set(prev.id);
  }

  next(): void {
    if (!this.canGoNext()) return;
    const following = ACTIVATION_STEPS[this.currentIndex() + 1];
    if (following) this.currentStep.set(following.id);
  }

  goToInvoices(): void {
    void this.router.navigate(['/admin/invoicing/invoices']);
  }
}
