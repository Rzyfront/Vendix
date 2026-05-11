import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
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
import { ConfirmationModalComponent } from '../confirmation-modal/confirmation-modal.component';
import {
  StickyHeaderActionButton,
  StickyHeaderComponent,
} from '../sticky-header/sticky-header.component';

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
    CommonModule,
    FormsModule,
    RouterModule,
    IconComponent,
    ConfirmationModalComponent,
    StickyHeaderComponent,
  ],
  template: `
    <section class="fiscal-page">
      <app-sticky-header
        title="Manejo fiscal"
        subtitle="Configuración"
        icon="settings"
        [showBackButton]="false"
        variant="glass"
        [actions]="headerActions()"
        (actionClicked)="onHeaderAction($event)"
      />

      <div class="fiscal-content">
        @if (storeStatuses().length) {
          <div class="store-switcher">
            <label class="store-switcher__label" for="fiscal-store-select">Tienda fiscal</label>
            <select
              id="fiscal-store-select"
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

        <div class="fiscal-grid">
          @for (area of areas; track area) {
            <article class="fiscal-card">
              <div class="card-top">
                <span class="area-icon">
                  <app-icon [name]="iconFor(area)" [size]="19" />
                </span>
                <span class="state-badge" [class]="'state-badge--' + stateFor(area).toLowerCase()">
                  {{ stateLabel(stateFor(area)) }}
                </span>
              </div>
              <h2>{{ labels[area] }}</h2>
              <p>{{ descriptionFor(area) }}</p>

              @if (statusFor(area)?.wizard?.current_step) {
                <div class="wizard-note">
                  Paso pendiente: {{ statusFor(area)?.wizard?.current_step }}
                </div>
              }

              <div class="card-actions">
                @if (stateFor(area) === 'INACTIVE') {
                  <a class="primary-btn" [routerLink]="['/admin/settings/fiscal/wizard']" [queryParams]="{ areas: area, store_id: service.targetStoreId() }">
                    Activar
                  </a>
                } @else if (stateFor(area) === 'WIP') {
                  <a class="primary-btn" [routerLink]="['/admin/settings/fiscal/wizard']" [queryParams]="{ areas: wizardAreasFor(area).join(','), store_id: service.targetStoreId() }">
                    Continuar
                  </a>
                } @else if (stateFor(area) === 'ACTIVE') {
                  <button class="secondary-btn" type="button" (click)="deactivate(area)">
                    Desactivar
                  </button>
                } @else {
                  <span class="locked-copy">No se puede deshabilitar porque ya existen registros fiscales.</span>
                }
              </div>
            </article>
          }
        </div>

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
  styles: [
    `
      .fiscal-page {
        width: 100%;
        min-height: 100%;
      }

      .fiscal-content {
        width: 100%;
        max-width: 1120px;
        margin: 0 auto;
        padding: 0 0 2rem;
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

      .fiscal-grid {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 1rem;
      }

      .fiscal-card {
        min-height: 17rem;
        display: flex;
        flex-direction: column;
        gap: 0.75rem;
        border: 1px solid var(--border-color, #e5e7eb);
        border-radius: 0.5rem;
        background: var(--surface-color, #ffffff);
        padding: 1rem;
      }

      .card-top,
      .card-actions {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 0.75rem;
      }

      .area-icon {
        width: 2.3rem;
        height: 2.3rem;
        display: grid;
        place-items: center;
        border-radius: 0.5rem;
        background: color-mix(in srgb, var(--primary-color, #2563eb) 10%, transparent);
        color: var(--primary-color, #2563eb);
      }

      h2 {
        margin: 0;
        font-size: 1rem;
        color: var(--text-primary, #111827);
      }

      p {
        margin: 0;
        min-height: 4.25rem;
        color: var(--text-secondary, #4b5563);
        font-size: 0.88rem;
        line-height: 1.35rem;
      }

      .state-badge {
        border-radius: 999px;
        padding: 0.25rem 0.55rem;
        font-size: 0.72rem;
        font-weight: 700;
        background: #f1f5f9;
        color: #475569;
      }

      .state-badge--active,
      .state-badge--locked {
        background: #dcfce7;
        color: #166534;
      }

      .state-badge--wip {
        background: #fef3c7;
        color: #92400e;
      }

      .wizard-note,
      .locked-copy {
        color: var(--text-secondary, #64748b);
        font-size: 0.78rem;
        line-height: 1.15rem;
      }

      .card-actions {
        margin-top: auto;
      }

      .primary-btn,
      .secondary-btn {
        min-height: 2.25rem;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 0.4rem;
        border-radius: 0.45rem;
        border: 1px solid var(--primary-color, #2563eb);
        padding: 0.45rem 0.75rem;
        font-size: 0.84rem;
        font-weight: 700;
        text-decoration: none;
        cursor: pointer;
      }

      .primary-btn {
        background: var(--primary-color, #2563eb);
        color: #ffffff;
      }

      .secondary-btn {
        background: var(--surface-color, #ffffff);
        color: var(--primary-color, #2563eb);
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

      @media (max-width: 920px) {
        .fiscal-grid {
          grid-template-columns: 1fr;
        }
      }

      @media (max-width: 640px) {
        .store-switcher {
          align-items: stretch;
          flex-direction: column;
        }
      }
    `,
  ],
})
export class FiscalManagementPanelComponent implements OnInit {
  readonly service = inject(FiscalActivationWizardService);
  private readonly authFacade = inject(AuthFacade);

  readonly areas = FISCAL_AREAS;
  readonly labels = FISCAL_AREA_LABELS;
  readonly fiscalStatus = this.service.effectiveFiscalStatus;
  readonly activeAreas = computed(() => this.authFacade.activeFiscalAreas());
  readonly deactivationContext = signal<DeactivationContext | null>(null);

  readonly storeStatuses = computed(
    () => this.service.lastStatus()?.store_statuses ?? [],
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

  refresh(): void {
    void this.service.loadStatus();
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
}
