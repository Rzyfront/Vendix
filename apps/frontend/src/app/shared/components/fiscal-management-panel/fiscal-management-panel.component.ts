import { Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';

import { AuthFacade } from '../../../core/store/auth/auth.facade';
import { FiscalActivationWizardService } from '../../../core/services/fiscal-activation-wizard.service';
import {
  FISCAL_AREAS,
  FISCAL_AREA_LABELS,
  FiscalArea,
  FiscalAreaStatus,
} from '../../../core/models/fiscal-status.model';
import { IconComponent } from '../icon/icon.component';
import { AlertBannerComponent } from '../alert-banner/alert-banner.component';
import { BadgeComponent } from '../badge/badge.component';
import { CardComponent } from '../card/card.component';
import { StatsComponent } from '../stats/stats.component';
import { ConfirmationModalComponent } from '../confirmation-modal/confirmation-modal.component';
import {
  StickyHeaderActionButton,
  StickyHeaderComponent,
} from '../sticky-header/sticky-header.component';
import { StoreFiscalIdentityFormComponent } from '../store-fiscal-identity-form/store-fiscal-identity-form.component';
import {
  StoreSettingsService,
} from '../../../private/modules/store/settings/general/services/store-settings.service';
import type {
  StoreFiscalData,
  StoreFiscalDataRequestOptions,
} from '../../../private/modules/store/settings/general/services/store-settings.service';

interface DeactivationContext {
  area: FiscalArea;
  locked: boolean;
  reasons: string[];
}

const LOCKED_REASON_LABELS: Record<string, string> = {
  accepted_invoice_with_cufe: 'Existen facturas DIAN aceptadas con CUFE.',
  posted_accounting_entry: 'Hay asientos contables ya contabilizados.',
  settled_payroll_run: 'Existen nóminas liquidadas.',
};

@Component({
  selector: 'app-fiscal-management-panel',
  standalone: true,
  imports: [
    FormsModule,
    RouterModule,
    IconComponent,
    AlertBannerComponent,
    BadgeComponent,
    CardComponent,
    StatsComponent,
    ConfirmationModalComponent,
    StickyHeaderComponent,
    StoreFiscalIdentityFormComponent,
  ],
  template: `
    <section class="w-full min-h-full">
      <app-sticky-header
        title="Operación fiscal"
        subtitle="Activa y gestiona tus áreas fiscales"
        icon="settings"
        [showBackButton]="false"
        variant="glass"
        [actions]="headerActions()"
        (actionClicked)="onHeaderAction($event)"
      />

      <div class="mx-auto flex w-full max-w-[1120px] flex-col gap-6 pb-8">
        <!-- Summary banner: correlates fiscal scope + activation progress + store target -->
        <div
          class="flex flex-col gap-4 md:flex-row md:items-end md:justify-between"
          role="group"
          aria-label="Resumen de operación fiscal"
        >
          <div class="grid grid-cols-1 gap-4 sm:grid-cols-2 md:flex-1">
            <app-stats
              title="Propiedad fiscal"
              [value]="fiscalScopeLabel()"
              smallText="Alcance de la operación"
              [iconName]="fiscalScopeIcon()"
              iconBgColor="bg-blue-100"
              iconColor="text-blue-500"
            />
            <app-stats
              title="Progreso"
              [value]="activationSummary()"
              smallText="Áreas fiscales activas"
              iconName="list-checks"
              iconBgColor="bg-emerald-100"
              iconColor="text-emerald-500"
            />
          </div>

          @if (showStoreSwitcher()) {
            <div class="flex flex-col gap-1.5 md:w-64">
              <label
                class="text-xs font-bold uppercase tracking-wide text-text-secondary"
                for="fiscal-store-select"
              >
                Tienda fiscal
              </label>
              <select
                id="fiscal-store-select"
                class="min-h-[2.5rem] w-full rounded-lg border border-border bg-[var(--color-surface)] px-3 py-2 text-sm text-text-primary focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
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
        </div>

        @if (service.error()) {
          <app-alert-banner variant="danger" icon="alert-triangle" role="alert">
            {{ service.error() }}
          </app-alert-banner>
        }

        <!-- Step: legal identity prerequisite (only in per-store fiscal mode) -->
        @if (showFiscalIdentitySection()) {
          <section class="flex flex-col gap-3" aria-labelledby="fiscal-step-identity-title">
            <header class="flex items-start gap-3">
              <span
                class="flex h-8 w-8 flex-none items-center justify-center rounded-full bg-primary text-sm font-bold text-[var(--color-text-on-primary)]"
              >
                1
              </span>
              <div class="flex flex-col gap-0.5">
                <h2 id="fiscal-step-identity-title" class="text-lg font-semibold text-text-primary">
                  Identidad legal
                </h2>
                <p class="text-sm text-text-secondary">
                  Requisito previo para emitir documentos fiscales en modo fiscal por tienda.
                </p>
              </div>
            </header>

            <app-card [responsivePadding]="true">
              <div class="flex flex-col gap-4">
                @if (taxIdMissing()) {
                  <app-alert-banner variant="warning" icon="alert-triangle" role="alert">
                    El NIT propio de la tienda es obligatorio para emitir documentos fiscales en modo fiscal por tienda.
                  </app-alert-banner>
                }

                @if (fiscalIdentityError()) {
                  <app-alert-banner variant="danger" icon="alert-triangle" role="alert">
                    {{ fiscalIdentityError() }}
                  </app-alert-banner>
                }

                <app-store-fiscal-identity-form
                  [initialValue]="fiscalData()"
                  [disabled]="fiscalIdentityDisabled()"
                  (save)="onSaveFiscalIdentity($event)"
                  (cancel)="onCancelFiscalIdentity()"
                />
              </div>
            </app-card>
          </section>
        }

        <!-- Step: fiscal area activation -->
        <section class="flex flex-col gap-3" aria-labelledby="fiscal-step-areas-title">
          <header class="flex items-start gap-3">
            <span
              class="flex h-8 w-8 flex-none items-center justify-center rounded-full bg-primary text-sm font-bold text-[var(--color-text-on-primary)]"
            >
              {{ showFiscalIdentitySection() ? '2' : '1' }}
            </span>
            <div class="flex flex-col gap-0.5">
              <h2 id="fiscal-step-areas-title" class="text-lg font-semibold text-text-primary">
                Áreas fiscales
              </h2>
              <p class="text-sm text-text-secondary">
                Activa, continúa o desactiva cada área según tu operación.
              </p>
            </div>
          </header>

          <div class="grid grid-cols-1 gap-4 md:grid-cols-3">
            @for (area of areas; track area) {
              <app-card customClasses="h-full">
                <div class="flex h-full flex-col gap-3">
                  <div class="flex items-center justify-between gap-3">
                    <span
                      class="flex h-10 w-10 items-center justify-center rounded-lg bg-[var(--color-primary-light)] text-[var(--color-primary)]"
                    >
                      <app-icon [name]="iconFor(area)" [size]="19" />
                    </span>
                    <app-badge
                      [variant]="
                        stateFor(area) === 'ACTIVE' || stateFor(area) === 'LOCKED'
                          ? 'success'
                          : stateFor(area) === 'WIP'
                            ? 'warning'
                            : 'neutral'
                      "
                      size="sm"
                    >
                      {{ stateLabel(stateFor(area)) }}
                    </app-badge>
                  </div>

                  <h3 class="text-base font-semibold text-text-primary">{{ labels[area] }}</h3>
                  <p class="min-h-[4.25rem] text-sm leading-relaxed text-text-secondary">
                    {{ descriptionFor(area) }}
                  </p>

                  @if (statusFor(area)?.wizard?.current_step) {
                    <div class="text-xs leading-snug text-text-secondary">
                      Paso pendiente: {{ statusFor(area)?.wizard?.current_step }}
                    </div>
                  }

                  <div class="mt-auto flex items-center justify-between gap-3">
                    @if (stateFor(area) === 'INACTIVE') {
                      <a
                        class="inline-flex min-h-[2.25rem] items-center justify-center gap-1.5 rounded-lg border border-primary bg-primary px-3 py-2 text-sm font-bold text-[var(--color-text-on-primary)] transition-colors hover:opacity-90"
                        [routerLink]="['/admin/fiscal/wizard']"
                        [queryParams]="{ areas: area, store_id: service.targetStoreId() }"
                      >
                        Activar
                      </a>
                    } @else if (stateFor(area) === 'WIP') {
                      <a
                        class="inline-flex min-h-[2.25rem] items-center justify-center gap-1.5 rounded-lg border border-primary bg-primary px-3 py-2 text-sm font-bold text-[var(--color-text-on-primary)] transition-colors hover:opacity-90"
                        [routerLink]="['/admin/fiscal/wizard']"
                        [queryParams]="{ areas: wizardAreasFor(area).join(','), store_id: service.targetStoreId() }"
                      >
                        Continuar
                      </a>
                    } @else if (stateFor(area) === 'ACTIVE') {
                      <button
                        class="inline-flex min-h-[2.25rem] items-center justify-center gap-1.5 rounded-lg border border-primary bg-[var(--color-surface)] px-3 py-2 text-sm font-bold text-[var(--color-primary)] transition-colors hover:bg-[var(--color-primary-light)]"
                        type="button"
                        (click)="deactivate(area)"
                      >
                        Desactivar
                      </button>
                    } @else {
                      <span class="text-xs leading-snug text-text-secondary">
                        No se puede deshabilitar porque ya existen registros fiscales.
                      </span>
                    }
                  </div>
                </div>
              </app-card>
            }
          </div>
        </section>

        @if (deactivationContext(); as ctx) {
          <app-confirmation-modal
            [isOpen]="true"
            [title]="ctx.locked ? 'No es posible desactivar' : 'Confirmar desactivación'"
            [message]="modalMessage(ctx)"
            [confirmText]="ctx.locked ? 'Entendido' : 'Sí, desactivar'"
            [cancelText]="ctx.locked ? '' : 'Cancelar'"
            [confirmVariant]="ctx.locked ? 'primary' : 'danger'"
            (confirm)="onModalConfirm(ctx)"
            (cancel)="onModalCancel()"
          />
        }
      </div>
    </section>
  `,
})
export class FiscalManagementPanelComponent implements OnInit {
  readonly service = inject(FiscalActivationWizardService);
  private readonly authFacade = inject(AuthFacade);
  private readonly storeSettings = inject(StoreSettingsService);
  private readonly destroyRef = inject(DestroyRef);

  readonly areas = FISCAL_AREAS;
  readonly labels = FISCAL_AREA_LABELS;
  readonly fiscalStatus = this.service.effectiveFiscalStatus;
  readonly activeAreas = computed(() => this.authFacade.activeFiscalAreas());
  readonly deactivationContext = signal<DeactivationContext | null>(null);
  readonly fiscalData = signal<StoreFiscalData | null>(null);
  readonly fiscalIdentityLoading = signal(false);
  readonly fiscalIdentitySaving = signal(false);
  readonly fiscalIdentityError = signal<string | null>(null);

  readonly storeStatuses = computed(
    () => this.service.lastStatus()?.store_statuses ?? [],
  );
  readonly showStoreSwitcher = computed(
    () =>
      this.service.userScope() === 'organization' &&
      this.service.fiscalDataOwner() === 'store' &&
      this.storeStatuses().length > 1,
  );
  readonly showFiscalIdentitySection = computed(
    () => this.service.lastStatus()?.fiscal_scope === 'STORE',
  );
  readonly fiscalIdentityDisabled = computed(
    () =>
      this.fiscalIdentityLoading() ||
      this.fiscalIdentitySaving() ||
      this.fiscalDataRequestOptions() === null,
  );
  readonly taxIdMissing = computed(() => {
    if (!this.showFiscalIdentitySection() || this.fiscalIdentityLoading()) {
      return false;
    }

    const data = this.fiscalData();
    return !String(data?.tax_id ?? data?.nit ?? '').trim();
  });

  // --- Read-only derived summary (scope + activation progress) ---
  readonly fiscalScopeLabel = computed(() =>
    this.service.lastStatus()?.fiscal_scope === 'ORGANIZATION'
      ? 'Por organización'
      : 'Por tienda',
  );
  readonly fiscalScopeIcon = computed(() =>
    this.service.lastStatus()?.fiscal_scope === 'ORGANIZATION'
      ? 'building-2'
      : 'store',
  );
  readonly activeAreasCount = computed(
    () =>
      this.areas.filter((area) => {
        const state = this.stateFor(area);
        return state === 'ACTIVE' || state === 'LOCKED';
      }).length,
  );
  readonly activationSummary = computed(
    () => `${this.activeAreasCount()} de ${this.areas.length} áreas activas`,
  );

  readonly headerActions = computed<StickyHeaderActionButton[]>(() => [
    {
      id: 'refresh',
      label: 'Actualizar',
      variant: 'outline',
      icon: 'refresh-cw',
      loading: this.service.loading(),
      disabled: this.service.loading(),
    },
  ]);

  onHeaderAction(actionId: string): void {
    if (actionId === 'refresh') {
      this.refresh();
    }
  }

  ngOnInit(): void {
    void this.refresh();
  }

  async refresh(): Promise<void> {
    try {
      await this.service.loadStatus();
      this.loadFiscalData();
    } catch {
      this.fiscalData.set(null);
    }
  }

  async deactivate(area: FiscalArea): Promise<void> {
    try {
      const check = await this.service.checkIrreversibility(area);
      this.deactivationContext.set({
        area,
        locked: check.locked,
        reasons: check.reasons,
      });
    } catch (error) {
      this.deactivationContext.set({ area, locked: false, reasons: [] });
    }
  }

  async onModalConfirm(ctx: DeactivationContext): Promise<void> {
    this.deactivationContext.set(null);
    if (ctx.locked) return;
    try {
      await this.service.deactivate(ctx.area);
    } catch {
      void this.refresh();
    }
  }

  onModalCancel(): void {
    this.deactivationContext.set(null);
  }

  modalMessage(ctx: DeactivationContext): string {
    if (ctx.locked) {
      const reasons = ctx.reasons
        .map((reason) => LOCKED_REASON_LABELS[reason] ?? reason)
        .join(' ');
      return `Por requerimientos legales colombianos, esta información debe preservarse. ${reasons}`.trim();
    }
    return 'Se ocultará el módulo del menú. Podrás activarlo de nuevo más adelante.';
  }

  selectStore(storeId: number): void {
    this.service.targetStoreId.set(Number(storeId));
    this.service.restoreWizardFromCurrentStatus();
    this.loadFiscalData();
  }

  onSaveFiscalIdentity(payload: Partial<StoreFiscalData>): void {
    const options = this.fiscalDataRequestOptions();
    if (!options) return;

    this.fiscalIdentitySaving.set(true);
    this.fiscalIdentityError.set(null);
    this.storeSettings
      .updateFiscalData(payload, options)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response) => {
          this.fiscalData.set(response.data);
          this.fiscalIdentitySaving.set(false);
        },
        error: (error) => {
          this.fiscalIdentityError.set(
            error?.message || 'No fue posible guardar la identidad legal.',
          );
          this.fiscalIdentitySaving.set(false);
        },
      });
  }

  onCancelFiscalIdentity(): void {
    this.loadFiscalData();
  }

  statusFor(area: FiscalArea): FiscalAreaStatus | null {
    return this.fiscalStatus()?.[area] ?? null;
  }

  stateFor(area: FiscalArea): string {
    return this.statusFor(area)?.state ?? 'INACTIVE';
  }

  wizardAreasFor(area: FiscalArea): FiscalArea[] {
    return this.statusFor(area)?.wizard?.selected_areas?.length
      ? this.statusFor(area)!.wizard.selected_areas
      : [area];
  }

  iconFor(area: FiscalArea): string {
    if (area === 'accounting') return 'book-open';
    if (area === 'payroll') return 'banknote';
    return 'receipt';
  }

  stateLabel(state: string): string {
    const labels: Record<string, string> = {
      INACTIVE: 'Inactivo',
      WIP: 'En configuración',
      ACTIVE: 'Activo',
      LOCKED: 'Bloqueado',
    };
    return labels[state] || state;
  }

  descriptionFor(area: FiscalArea): string {
    if (area === 'invoicing') {
      return 'Facturación electrónica, resoluciones DIAN, CUFE y soporte para ventas B2B.';
    }
    if (area === 'accounting') {
      return 'PUC, periodos fiscales, asientos, cartera, retenciones e informes contables.';
    }
    return 'Empleados, periodos de nómina, liquidaciones, desprendibles y soportes de pago.';
  }

  private loadFiscalData(): void {
    const options = this.fiscalDataRequestOptions();
    if (!options) {
      this.fiscalData.set(null);
      return;
    }

    this.fiscalIdentityLoading.set(true);
    this.fiscalIdentityError.set(null);
    this.storeSettings
      .getFiscalData(options)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response) => {
          this.fiscalData.set(response.data);
          this.fiscalIdentityLoading.set(false);
        },
        error: (error) => {
          this.fiscalData.set(null);
          this.fiscalIdentityError.set(
            error?.message || 'No fue posible cargar la identidad legal.',
          );
          this.fiscalIdentityLoading.set(false);
        },
      });
  }

  private fiscalDataRequestOptions(): StoreFiscalDataRequestOptions | null {
    if (!this.showFiscalIdentitySection()) return null;

    if (this.service.userScope() === 'store') {
      return { scope: 'store' };
    }

    const storeId = this.service.targetStoreId();
    return storeId != null ? { scope: 'organization', store_id: storeId } : null;
  }
}
