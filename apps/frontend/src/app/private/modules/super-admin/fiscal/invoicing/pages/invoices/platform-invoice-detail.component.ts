// OJO: `CurrencyPipe` de Angular NO se importa acá. La que se usa es la de
// Vendix (`VendixCurrencyPipe`, selector `currency`), que respeta la moneda y
// el estilo de separadores configurados por el tenant. Importar las dos deja
// dos pipes con el mismo nombre y gana la última registrada.
import { DatePipe, formatDate } from '@angular/common';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Component, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../../../../../../environments/environment';
import { ToastService } from '../../../../../../../shared/components/toast/toast.service';
import {
  AlertBannerComponent,
  ButtonComponent,
  ConfirmationModalComponent,
  ModalComponent,
  ResponsiveDataViewComponent,
  SelectorComponent,
  TableColumn,
} from '../../../../../../../shared/components';
import {
  CurrencyFormatService,
  CurrencyPipe as VendixCurrencyPipe,
} from '../../../../../../../shared/pipes/currency';
import { describeApiFailure } from '../../../../../store/invoicing/utils/invoicing-errors.util';
import type { PlatformInvoiceKind } from '../../../../subscriptions/interfaces/platform-invoice-document.interface';
import { FiscalBillingAdminService } from '../../../../subscriptions/services/fiscal-billing-admin.service';
import {
  billingCycleLabel,
  evidenceTypeLabel,
  invoiceStateLabel,
  transmissionStatusBadgeClasses,
  transmissionStatusLabel,
} from '../../platform-invoicing.constants';

// F-R2-14: el backend persiste `period_start`/`period_end` como
// `DateTime @db.Timestamp(6)` (UTC en PG). El DatePipe de Angular los
// interpretaría en la timezone del navegador — un super-admin en UTC+1
// vería "31 de julio" en vez de "1 de agosto". El plan crítico define
// `PLATFORM_TIMEZONE = 'America/Bogota'` en el backend; el frontend
// formatea con esa misma zona para evitar el off-by-one.
const PLATFORM_TIMEZONE = 'America/Bogota';

interface PlatformLineSnapshot {
  description: string;
  quantity: number;
  unit_price: number | string;
  discount_amount?: number | string;
  taxes?: Array<{
    tax_type: string;
    rate: number | string;
    tax_amount?: number | string;
    is_inclusive?: boolean;
  }>;
  aiu_component?: 'administracion' | 'imprevistos' | 'utilidad';
  is_inclusive?: boolean;
}

interface PlatformAcquirerSnapshot {
  kind: 'store' | 'organization';
  id: number;
  legal_name: string;
  tax_id: string;
  tax_id_dv?: string;
  tax_regime_code?: string;
  fiscal_responsibilities?: string[];
  email?: string;
  address?: { line?: string; city?: string; department_code?: string };
}

interface PlatformInvoiceSnapshotPayload {
  customer?: PlatformAcquirerSnapshot;
  items?: PlatformLineSnapshot[];
  withholdings?: Array<{
    role: string;
    concept_id: number;
    base_amount: number | string;
    rate: number | string;
    amount?: number | string;
  }>;
  operation_type?: '10' | '09' | '11' | '12';
  aiu_contract_object?: string;
  payment_form?: '1' | '2';
  due_date?: string;
  currency?: { iso_4217: string; exchange_rate?: number; exchange_rate_date?: string };
  global_discount_amount?: number | string;
}

interface SubscriptionInvoiceDetail {
  invoice: {
    id: number;
    invoice_number: string;
    state: string;
    issued_at: string | null;
    due_at: string;
    period_start: string;
    period_end: string;
    subtotal: string;
    tax_amount: string;
    total: string;
    amount_paid: string;
    currency: string;
    line_items: unknown[];
    payment_form?: '1' | '2';
    payment_means_code?: string;
    due_date?: string;
    operation_type?: string;
    aiu_contract_object?: string;
    global_discount_amount?: string;
    withholding_amount?: string;
    exchange_rate?: string;
    exchange_rate_date?: string;
    customer?: PlatformAcquirerSnapshot;
  };
  transmissions: Array<{
    id: number;
    transmission_status: string;
    dian_status: string;
    accounting_status: string;
    document_number: string;
    cufe: string | null;
    qr_code: string | null;
    tracking_id: string | null;
    accepted_at: string | null;
    rejected_at: string | null;
    error_message: string | null;
    created_at: string;
    retry_count?: number;
  }>;
  evidences: Array<{
    id: number;
    fiscal_transmission_id: number;
    evidence_type: string;
    content_hash?: string | null;
    storage_key?: string | null;
    metadata?: Record<string, unknown> | null;
    created_at: string;
  }>;
  plan: { name: string; code: string; billing_cycle: string } | null;
  organization: {
    id: number;
    name: string;
    legal_name: string | null;
    tax_id: string | null;
    email: string | null;
  } | null;
}

/**
 * Detalle de una factura en super-admin. Soporta dos sub-flujos:
 *   - SaaS (legacy): `GET /invoices/:id` -> subscription invoice shape
 *   - Platform: `GET /platform-invoices/:id` -> synthesized transmission + evidences
 *
 * V1 enriquesido:
 *   - Tenant snapshot (acquirer evidence) rendereado como bloque del destinatario
 *   - Lines table con tax breakdown por línea (snapshot del invoice evidence)
 *   - Withholdings breakdown (snapshot)
 *   - AIU regime display (cuando operation_type='09')
 *   - TRM block (cuando currency != 'COP')
 *   - CTAs: Diagnosticar+emitir, Cancelar, Retry
 *   - Readiness panel con blockers[] + warnings[]
 */
@Component({
  selector: 'app-platform-invoice-detail',
  standalone: true,
  imports: [
    RouterLink,
    VendixCurrencyPipe,
    DatePipe,
    AlertBannerComponent,
    ButtonComponent,
    ConfirmationModalComponent,
    ModalComponent,
    ResponsiveDataViewComponent,
    SelectorComponent,
  ],
  template: `
    <div class="p-6 max-w-5xl mx-auto">
      <a
        routerLink="/super-admin/fiscal/invoicing/invoices"
        class="text-sm text-primary-600 hover:underline"
      >← Volver al listado</a>

      @if (loading()) {
        <p class="mt-4 text-sm text-text-secondary">Cargando factura…</p>
      } @else if (errorMessage(); as msg) {
        <app-alert-banner variant="danger" class="mt-4">{{ msg }}</app-alert-banner>
      } @else if (data(); as d) {
        <h2 class="mt-4 text-2xl font-semibold text-text-primary">
          Factura {{ d.invoice.invoice_number }}
        </h2>
        <p class="text-sm text-text-secondary">
          {{ d.organization?.legal_name ?? d.organization?.name ?? '—' }}
          ({{ d.organization?.tax_id ?? 'sin NIT' }})
        </p>

        <!-- Resumen + Plan -->
        <section class="mt-6 grid grid-cols-2 gap-4 text-sm">
          <div class="bg-surface rounded-card shadow-card p-4">
            <h2 class="font-semibold text-text-primary mb-2">Resumen</h2>
            <dl class="grid grid-cols-2 gap-y-1">
              <dt class="text-text-secondary">Estado</dt>
              <dd>{{ invoiceStateLabel(d.invoice.state) }}</dd>
              <dt class="text-text-secondary">Periodo</dt>
              <dd>{{ formatPeriodDate(d.invoice.period_start) }} → {{ formatPeriodDate(d.invoice.period_end) }}</dd>
              <dt class="text-text-secondary">Subtotal</dt>
              <dd>{{ subtotalNumber() | currency }}</dd>
              <dt class="text-text-secondary">Impuestos</dt>
              <dd>{{ taxAmountNumber() | currency }}</dd>
              <dt class="text-text-secondary">Total</dt>
              <dd class="font-semibold">{{ totalNumber() | currency }}</dd>
              <dt class="text-text-secondary">Saldo a pagar</dt>
              <dd>{{ saldo() | currency }}</dd>
              @if (globalDiscountAmountNumber() > 0) {
                <dt class="text-text-secondary">Descuento global</dt>
                <dd>- {{ globalDiscountAmountNumber() | currency }}</dd>
              }
              @if (withholdingAmountNumber() > 0) {
                <dt class="text-text-secondary">Retenciones</dt>
                <dd>{{ withholdingAmountNumber() | currency }}</dd>
              }
            </dl>
          </div>

          <div class="bg-surface rounded-card shadow-card p-4">
            <h2 class="font-semibold text-text-primary mb-2">Pago</h2>
            <dl class="grid grid-cols-2 gap-y-1">
              <dt class="text-text-secondary">Forma</dt>
              <dd>{{ d.invoice.payment_form === '2' ? 'Crédito' : 'Contado' }}</dd>
              @if (d.invoice.due_date) {
                <dt class="text-text-secondary">Vencimiento</dt>
                <dd>{{ formatPeriodDate(d.invoice.due_date) }}</dd>
              }
              @if (d.invoice.exchange_rate) {
                <dt class="text-text-secondary">TRM</dt>
                <dd>{{ d.invoice.exchange_rate }} ({{ d.invoice.exchange_rate_date ?? '—' }})</dd>
              }
              @if (d.invoice.operation_type && d.invoice.operation_type !== '10') {
                <dt class="text-text-secondary">Tipo de operación</dt>
                <dd>{{ operationTypeLabel(d.invoice.operation_type) }}</dd>
              }
            </dl>
            @if (d.plan) {
              <p class="mt-3 text-sm text-text-primary">
                Plan: <span class="font-medium">{{ d.plan.name }}</span> ({{ billingCycleLabel(d.plan.billing_cycle) }})
              </p>
            }
          </div>
        </section>

        <!-- Tenant (destinatario) snapshot -->
        @if (acquirerSnapshot(); as acq) {
          <section class="mt-6 bg-surface rounded-card shadow-card p-4">
            <h2 class="font-semibold text-text-primary mb-3">Destinatario (snapshot al emitir)</h2>
            <dl class="grid grid-cols-2 gap-y-1 text-sm">
              <dt class="text-text-secondary">Tipo</dt>
              <dd class="font-mono">{{ acq.kind }} :{{ acq.id }}</dd>
              <dt class="text-text-secondary">Razón social</dt>
              <dd>{{ acq.legal_name }}</dd>
              <dt class="text-text-secondary">NIT</dt>
              <dd>{{ acq.tax_id }}{{ acq.tax_id_dv ? '-' + acq.tax_id_dv : '' }}</dd>
              @if (acq.tax_regime_code) {
                <dt class="text-text-secondary">Régimen</dt>
                <dd>{{ acq.tax_regime_code }}</dd>
              }
              @if (acq.fiscal_responsibilities && acq.fiscal_responsibilities.length > 0) {
                <dt class="text-text-secondary">Responsabilidades</dt>
                <dd>{{ acq.fiscal_responsibilities.join(', ') }}</dd>
              }
              @if (acq.email) {
                <dt class="text-text-secondary">Email</dt>
                <dd>{{ acq.email }}</dd>
              }
              @if (acq.address && acq.address.line) {
                <dt class="text-text-secondary">Dirección</dt>
                <dd>
                  {{ acq.address.line }} ·
                  {{ acq.address.city ?? '' }} ·
                  {{ acq.address.department_code ?? '' }}
                </dd>
              }
            </dl>
          </section>
        }

        <!-- Líneas con impuestos por línea -->
        @if (invoiceSnapshot()?.items && invoiceSnapshot()!.items!.length > 0) {
          <section class="mt-6 bg-surface rounded-card shadow-card p-4">
            <h2 class="font-semibold text-text-primary mb-3">Líneas</h2>
            <app-responsive-data-view
              [data]="invoiceSnapshot()!.items!"
              [columns]="lineColumns"
              [cardConfig]="lineCardConfig"
              [actions]="[]"
              [loading]="false"
              emptyTitle="Sin líneas"
              emptyIcon="file-x"
            />
          </section>
        }

        <!-- AIU note -->
        @if (invoiceSnapshot()?.aiu_contract_object) {
          <section class="mt-6 bg-surface rounded-card shadow-card p-4">
            <h2 class="font-semibold text-text-primary mb-2">Nota AIU (regimen 09)</h2>
            <p class="text-sm text-text-primary whitespace-pre-wrap">
              {{ invoiceSnapshot()!.aiu_contract_object }}
            </p>
            <p class="text-xs text-text-secondary mt-2">
              {{ invoiceSnapshot()!.aiu_contract_object!.length }} / 4900 caracteres
            </p>
          </section>
        }

        <!-- Retenciones breakdown -->
        @if (invoiceSnapshot()?.withholdings && invoiceSnapshot()!.withholdings!.length > 0) {
          <section class="mt-6 bg-surface rounded-card shadow-card p-4">
            <h2 class="font-semibold text-text-primary mb-3">Retenciones</h2>
            <app-responsive-data-view
              [data]="invoiceSnapshot()!.withholdings!"
              [columns]="withholdingColumns"
              [cardConfig]="withholdingCardConfig"
              [actions]="[]"
              [loading]="false"
              emptyTitle="Sin retenciones"
              emptyIcon="minus-circle"
            />
          </section>
        }

        <!-- Transmisiones DIAN -->
        <section class="mt-6 bg-surface rounded-card shadow-card p-4">
          <div class="flex items-center justify-between mb-3">
            <h2 class="font-semibold text-text-primary">Transmisiones DIAN</h2>
            @if (d.transmissions.length === 0) {
              <button
                app-button
                type="button"
                variant="primary"
                (click)="onDiagnoseEmit(d.invoice.id)"
                [disabled]="issuing()"
              >
                {{ issuing() ? 'Emitiendo…' : 'Diagnosticar y emitir' }}
              </button>
            }
          </div>

          @if (d.transmissions.length === 0) {
            <p class="text-sm text-text-secondary">Esta factura aún no fue emitida.</p>
          } @else {
            <div class="space-y-4">
              @for (t of d.transmissions; track t.id) {
                <div class="border rounded p-3">
                  <p class="text-sm">
                    <span class="font-mono">{{ t.document_number }}</span>
                    ·
                    <span [class]="'inline-block px-2 py-0.5 rounded text-xs border ' + transmissionStatusBadgeClasses(t.transmission_status)">
                      {{ transmissionStatusLabel(t.transmission_status) }}
                    </span>
                    ·
                    <span [class]="'inline-block px-2 py-0.5 rounded text-xs border ' + transmissionStatusBadgeClasses(t.dian_status)">
                      {{ transmissionStatusLabel(t.dian_status) }}
                    </span>
                    @if (t.retry_count && t.retry_count > 0) {
                      <span class="ml-2 text-xs text-text-secondary">reintentos: {{ t.retry_count }}</span>
                    }
                  </p>
                  @if (t.cufe) {
                    <p class="text-xs text-text-secondary mt-1 break-all">CUFE: {{ t.cufe }}</p>
                  }
                  @if (t.qr_code) {
                    <p class="text-xs text-text-secondary mt-1 break-all">QR: {{ t.qr_code }}</p>
                  }
                  @if (t.error_message) {
                    <p class="text-xs text-red-600 mt-1">{{ t.error_message }}</p>
                  }
                  @if (t.transmission_status === 'rejected' || t.transmission_status === 'error') {
                    <button
                      app-button
                      type="button"
                      variant="secondary"
                      class="mt-2"
                      (click)="retryTransmission(t.id)"
                      [disabled]="retrying() === t.id"
                      aria-label="Reintentar transmisión"
                    >
                      {{ retrying() === t.id ? 'Reintentando…' : 'Reintentar' }}
                    </button>
                  }
                </div>
              }
            </div>
          }
        </section>

        <!-- Readiness (blockers + warnings) -->
        @if (readinessBlockers().length > 0 || readinessWarnings().length > 0) {
          <section class="mt-6 bg-surface rounded-card shadow-card p-4">
            <h2 class="font-semibold text-text-primary mb-2">Pre-validación</h2>

            @if (readinessBlockers().length > 0) {
              <div class="border-l-4 border-warning bg-warning-light/30 p-3 rounded mb-3">
                <p class="font-semibold text-sm text-text-primary mb-2">Bloqueadores</p>
                <ul class="text-xs space-y-2">
                  @for (b of readinessBlockers(); track b.code) {
                    <li>
                      <p class="font-mono text-text-secondary">{{ b.code }}</p>
                      <p>{{ b.problem }}</p>
                      @if (b.fix) {
                        <p class="text-text-primary"><span class="font-medium">Cómo resolver:</span> {{ b.fix }}</p>
                      }
                    </li>
                  }
                </ul>
              </div>
            }

            @if (readinessWarnings().length > 0) {
              <div class="border-l-4 border-info bg-info-light/30 p-3 rounded">
                <p class="font-semibold text-sm text-text-primary mb-2">Advertencias</p>
                <ul class="text-xs space-y-2">
                  @for (w of readinessWarnings(); track w.code) {
                    <li>
                      <p class="font-mono text-text-secondary">{{ w.code }}</p>
                      <p>{{ w.problem }}</p>
                    </li>
                  }
                </ul>
              </div>
            }
          </section>
        }

        <!-- Acciones de documento -->
        @if (canCancel() && isPlatformRail()) {
          <section class="mt-6 bg-surface rounded-card shadow-card p-4">
            <h2 class="font-semibold text-text-primary mb-2">Acciones</h2>
            <div class="flex gap-2">
              <button
                app-button
                type="button"
                variant="secondary"
                (click)="openCancelModal(d.invoice.id)"
                [disabled]="cancelling()"
              >
                {{ cancelling() ? 'Cancelando…' : 'Cancelar documento' }}
              </button>
            </div>
          </section>
        }

        <!-- Acciones fiscales (delivery, RADIAN, PDF).
             SÓLO RIEL PLATAFORMA: los cuatro endpoints resuelven contra
             'fiscal_transmissions' de plataforma o contra 'invoices' bajo la
             organización plataforma. Disparados sobre una factura SaaS
             devuelven 404 o —peor— resuelven el documento de otro. -->
        @if (isPlatformRail()) {
        <section class="mt-6 bg-surface rounded-card shadow-card p-4">
          <h2 class="font-semibold text-text-primary mb-2">Acciones fiscales</h2>
          <div class="flex flex-wrap gap-2">
            <button
              app-button
              type="button"
              variant="primary"
              (click)="openDeliverModal(d.invoice.id)"
              [disabled]="actionLoading()"
            >
              Reenviar correo
            </button>
            <button
              app-button
              type="button"
              variant="secondary"
              (click)="openRadianModal(d.invoice.id)"
              [disabled]="actionLoading()"
            >
              Registrar evento RADIAN
            </button>
            <button
              app-button
              type="button"
              variant="ghost"
              (click)="previewPdf(d.invoice.id)"
              [disabled]="actionLoading()"
            >
              Preview PDF
            </button>
            <button
              app-button
              type="button"
              variant="ghost"
              (click)="regeneratePdf(d.invoice.id)"
              [disabled]="actionLoading()"
            >
              Regenerar PDF
            </button>
          </div>
        </section>
        }

        <!-- Evidencias -->
        @if (d.evidences.length > 0) {
          <section class="mt-6 bg-surface rounded-card shadow-card p-4">
            <h2 class="font-semibold text-text-primary mb-3">Evidencias</h2>
            <ul class="text-sm space-y-1">
              @for (e of d.evidences; track e.id) {
                <li>
                  <span class="font-mono text-xs text-text-secondary">#{{ e.fiscal_transmission_id }}</span>
                  · {{ evidenceTypeLabel(e.evidence_type) }}
                  · <span class="text-text-secondary">{{ e.created_at | date: 'short' }}</span>
                  @if (evidenceKind(e.metadata) && evidenceKind(e.metadata) !== 'platform_invoice_snapshot') {
                    <span class="text-xs text-muted">({{ evidenceKind(e.metadata) }})</span>
                  }
                </li>
              }
            </ul>
          </section>
        }
      }
    </div>

    <!-- PASO 11: Cancelar documento — ConfirmationModal -->
    @if (cancelModalOpen()) {
      <app-confirmation-modal
        [(isOpen)]="cancelModalOpen"
        title="Cancelar documento"
        message="¿Cancelar este documento? La acción no se puede deshacer."
        confirmText="Cancelar documento"
        cancelText="Cerrar"
        confirmVariant="danger"
        (confirm)="onCancelConfirm()"
        (cancel)="cancelModalOpen.set(false)"
      />
    }

    <!-- PASO 11: Reenvío por correo — Modal con campo email -->
    <app-modal
      [(isOpen)]="deliverModalOpen"
      title="Reenviar documento por correo"
      subtitle="Envío de documento electrónico"
      size="sm"
    >
      <div class="space-y-4">
        <label class="block text-xs font-medium text-text-primary" for="deliver-email-input">
          Correo electrónico destino
        </label>
        <input
          id="deliver-email-input"
          type="email"
          [value]="deliverEmail()"
          (input)="onDeliverEmailInput($event)"
          placeholder="destinatario@ejemplo.com"
          class="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-text-primary focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
        />
        @if (deliverEmailError()) {
          <p class="text-xs text-error">{{ deliverEmailError() }}</p>
        }
      </div>
      <div slot="footer" class="flex justify-end gap-2">
        <app-button variant="secondary" (clicked)="deliverModalOpen.set(false)">Cancelar</app-button>
        <app-button variant="primary" (clicked)="onDeliverSubmit()">Enviar</app-button>
      </div>
    </app-modal>

    <!-- PASO 11: Registro evento RADIAN — Modal con selector de códigos -->
    <app-modal
      [(isOpen)]="radianModalOpen"
      title="Registrar evento RADIAN"
      subtitle="Evento sobre documento electrónico"
      size="sm"
    >
      <div class="space-y-4">
        <app-selector
          label="Código de evento"
          [options]="radianEventOptions"
          (valueChange)="radianSelectedCode.set(($event ?? '').toString())"
        />
        <p class="text-xs text-text-secondary">
          Seleccione el evento según la normativa DIAN. Los códigos soportados son 030–051.
        </p>
      </div>
      <div slot="footer" class="flex justify-end gap-2">
        <app-button variant="secondary" (clicked)="radianModalOpen.set(false)">Cancelar</app-button>
        <app-button variant="primary" (clicked)="onRadianSubmit()">Registrar</app-button>
      </div>
    </app-modal>
  `,
})
export class PlatformInvoiceDetailComponent {
  private readonly http = inject(HttpClient);
  private readonly route = inject(ActivatedRoute);
  private readonly toast = inject(ToastService);
  private readonly fiscal = inject(FiscalBillingAdminService);
  private readonly currencyFormat = inject(CurrencyFormatService);

  readonly data = signal<SubscriptionInvoiceDetail | null>(null);
  readonly loading = signal(true);
  readonly errorMessage = signal<string | null>(null);
  readonly issuing = signal(false);
  readonly retrying = signal<number | null>(null);
  readonly cancelling = signal(false);
  readonly actionLoading = signal(false);
  readonly issueError = signal<string | null>(null);
  readonly readinessBlockers = signal<
    Array<{ code: string; problem: string; fix?: string }>
  >([]);
  readonly readinessWarnings = signal<
    Array<{ code: string; problem: string }>
  >([]);

  // Helpers expuestos al template
  readonly invoiceStateLabel = invoiceStateLabel;
  readonly billingCycleLabel = billingCycleLabel;
  readonly evidenceTypeLabel = evidenceTypeLabel;
  readonly transmissionStatusLabel = transmissionStatusLabel;
  readonly transmissionStatusBadgeClasses = transmissionStatusBadgeClasses;

  private base = `${environment.apiUrl}/superadmin/subscriptions/fiscal`;
  private detailPathPrefix = '/invoices';
  /**
   * Prevalidación. SON DOS RUTAS DISTINTAS, una por riel:
   *   · plataforma → `GET invoices/:id/emit-readiness`
   *     (`platform-invoicing.controller.ts:289`, id = `fiscal_transmissions.id`)
   *   · SaaS       → `GET saas-invoices/:id/emit-readiness`
   *     (`subscription-fiscal.controller.ts:381`, id = `subscription_invoices.id`)
   *
   * Antes estaba al revés en los dos casos: el riel SaaS pedía la ruta de
   * plataforma y el de plataforma pedía `platform-invoices/:id/emit-readiness`,
   * que NO EXISTE. Como `loadReadiness` traga el error en silencio, la sección
   * «Pre-validación» simplemente nunca aparecía y el operador no tenía forma
   * de saber por qué la factura no se podía emitir.
   */
  private readinessPathPrefix = '/saas-invoices';
  /** Riel del documento; decide endpoints e id space. */
  readonly invoiceKind = signal<PlatformInvoiceKind>('subscription');
  readonly isPlatformRail = computed(() => this.invoiceKind() === 'platform');

  /**
   * Snapshot derivado de `fiscal_evidences.metadata` para el detalle platform.
   * Filtra por `kind='platform_invoice_snapshot'` y `'platform_acquirer_snapshot'`.
   */
  readonly invoiceSnapshot = computed<PlatformInvoiceSnapshotPayload | null>(() => {
    const d = this.data();
    if (!d) return null;
    // El backend puede haber sintetizado `customer`, `items`, `withholdings`,
    // `aiu_contract_object` en la fila `invoice`. Si están ahí los usamos.
    const inv = d.invoice as any;
    if (inv.customer || inv.items || inv.withholdings || inv.aiu_contract_object) {
      return {
        customer: inv.customer,
        items: inv.items,
        withholdings: inv.withholdings,
        operation_type: inv.operation_type,
        aiu_contract_object: inv.aiu_contract_object,
        payment_form: inv.payment_form,
        due_date: inv.due_date,
        currency: inv.currency,
        global_discount_amount: inv.global_discount_amount,
      };
    }
    // Si no, leemos del evidence con kind='platform_invoice_snapshot'.
    const snap = d.evidences.find(
      (e) =>
        (e.metadata as any)?.kind === 'platform_invoice_snapshot',
    );
    if (snap && snap.metadata) {
      return snap.metadata as PlatformInvoiceSnapshotPayload;
    }
    return null;
  });

  readonly acquirerSnapshot = computed<PlatformAcquirerSnapshot | null>(() => {
    // Preferir la fila `invoice.customer` si el backend la sintetizó.
    const inv = this.data()?.invoice as any;
    if (inv?.customer) return inv.customer as PlatformAcquirerSnapshot;
    const acq = this.data()?.evidences.find(
      (e) =>
        (e.metadata as any)?.kind === 'platform_acquirer_snapshot',
    );
    if (acq && acq.metadata) {
      return (acq.metadata as any).acquirer as PlatformAcquirerSnapshot;
    }
    return null;
  });

  constructor() {
    const kind: PlatformInvoiceKind =
      this.route.snapshot.data['kind'] === 'platform' ? 'platform' : 'subscription';
    this.invoiceKind.set(kind);
    if (kind === 'platform') {
      this.detailPathPrefix = '/platform-invoices';
      this.readinessPathPrefix = '/invoices';
    }
    const id = Number(this.route.snapshot.paramMap.get('id'));
    if (!Number.isInteger(id) || id <= 0) {
      this.errorMessage.set('Identificador de factura inválido.');
      this.loading.set(false);
      return;
    }
    this.load(id);
  }

  readonly saldo = computed<number>(() => {
    const d = this.data();
    if (!d) return 0;
    return Number(d.invoice.total) - Number(d.invoice.amount_paid);
  });

  readonly subtotalNumber = computed<number>(() => {
    const d = this.data();
    return d ? Number(d.invoice.subtotal) : 0;
  });

  readonly taxAmountNumber = computed<number>(() => {
    const d = this.data();
    return d ? Number(d.invoice.tax_amount) : 0;
  });

  readonly totalNumber = computed<number>(() => {
    const d = this.data();
    return d ? Number(d.invoice.total) : 0;
  });

  readonly globalDiscountAmountNumber = computed<number>(() => {
    const d = this.data();
    if (!d || !d.invoice.global_discount_amount) return 0;
    return Number(d.invoice.global_discount_amount);
  });

  readonly withholdingAmountNumber = computed<number>(() => {
    const d = this.data();
    if (!d || !d.invoice.withholding_amount) return 0;
    return Number(d.invoice.withholding_amount);
  });

  whWithholdingRatePct(wh: { rate: number | string }): string {
    const r = Number(wh.rate);
    return (r * 100).toFixed(4) + '%';
  }

  /**
   * Formatea un importe con la moneda y los separadores del tenant.
   *
   * `String(v)` imprimía el Decimal crudo de Prisma —«1234567.890000»— en una
   * pantalla de facturación fiscal, sin símbolo y sin separadores.
   */
  private money(value: unknown): string {
    return this.currencyFormat.format(Number(value) || 0);
  }

  // ── Lines table (ResponsiveDataView) ───────────────────────────────────
  readonly lineColumns: TableColumn[] = [
    { key: 'description', label: 'Descripción' },
    { key: 'quantity', label: 'Cant', align: 'right', transform: (v) => String(v) },
    {
      key: 'unit_price',
      label: 'Precio',
      align: 'right',
      transform: (v) => this.money(v),
    },
    {
      key: 'discount_amount',
      label: 'Desc',
      align: 'right',
      transform: (v) => (v ? this.money(v) : '—'),
    },
    {
      key: 'taxes',
      label: 'Imp.',
      transform: (v) => `${((v as unknown[]) ?? []).length}`,
    },
    {
      key: 'aiu_component',
      label: 'AIU',
      transform: (v) => (v ? String(v) : '—'),
    },
  ];

  readonly lineCardConfig = {
    titleKey: 'description',
    subtitleKey: 'quantity',
    footerKey: 'unit_price',
    footerLabel: 'Precio',
    footerStyle: 'prominent' as const,
    footerTransform: (v: unknown) => this.money(v),
  };

  // ── Withholdings table (ResponsiveDataView) ─────────────────────────────
  readonly withholdingColumns: TableColumn[] = [
    { key: 'role', label: 'Rol' },
    { key: 'concept_id', label: 'Concepto' },
    {
      key: 'base_amount',
      label: 'Base',
      align: 'right',
      transform: (v) => this.money(v),
    },
    {
      key: 'rate',
      label: 'Tasa',
      align: 'right',
      transform: (v) => this.whWithholdingRatePct({ rate: v }),
    },
    {
      key: 'amount',
      label: 'Monto',
      align: 'right',
      // El `as string` anterior era una mentira al compilador:
      // `whWithholdingAmount` devuelve `number | string` y la columna exige
      // `string`, así que un monto calculado se pintaba como número crudo.
      transform: (_v, item) =>
        this.money(
          this.whWithholdingAmount(
            item as Parameters<typeof this.whWithholdingAmount>[0],
          ),
        ),
    },
  ];

  readonly withholdingCardConfig = {
    titleKey: 'role',
    subtitleKey: 'concept_id',
    detailKeys: [
      { key: 'base_amount', label: 'Base', transform: (v: unknown) => this.money(v) },
      {
        key: 'rate',
        label: 'Tasa',
        transform: (v: unknown) => this.whWithholdingRatePct({ rate: v as number }),
      },
    ],
  };

  // ── Modal state (Paso 11) ─────────────────────────────────────────────
  readonly cancelModalOpen = signal(false);
  readonly cancelInvoiceId = signal<number | null>(null);
  readonly deliverModalOpen = signal(false);
  readonly deliverEmail = signal('');
  readonly deliverEmailError = signal('');
  readonly radianModalOpen = signal(false);
  readonly radianSelectedCode = signal<string | null>(null);
  readonly pendingInvoiceId = signal<number | null>(null);
  readonly deliverEmailControl = signal('');

  readonly radianEventOptions = [
    { value: '030', label: '030 — Acuse de recibo' },
    { value: '031', label: '031 — Reclamo' },
    { value: '032', label: '032 — Recibo del bien o servicio' },
    { value: '033', label: '033 — Aceptación expresa' },
    { value: '034', label: '034 — Aceptación tácita' },
    { value: '035', label: '035 — Aval' },
    { value: '036', label: '036 — Inscripción RADIAN' },
    { value: '037', label: '037 — Endoso en propiedad' },
    { value: '038', label: '038 — Endoso en garantía' },
    { value: '039', label: '039 — Endoso en procuración' },
    { value: '040', label: '040 — Cancelación de endoso' },
    { value: '041', label: '041 — Limitación circulación' },
    { value: '042', label: '042 — Terminación limitación' },
    { value: '043', label: '043 — Mandato' },
    { value: '044', label: '044 — Terminación mandato' },
    { value: '045', label: '045 — Pago' },
    { value: '046', label: '046 — Informe para el pago' },
    { value: '047', label: '047 — Endoso con cesión ordinaria' },
    { value: '048', label: '048 — Protesto' },
    { value: '049', label: '049 — Transferencia derechos económicos' },
    { value: '050', label: '050 — Notificación transferencia' },
    { value: '051', label: '051 — Pago transferencia' },
  ];

  openCancelModal(invoiceId: number): void {
    this.cancelInvoiceId.set(invoiceId);
    this.cancelModalOpen.set(true);
  }

  onCancelConfirm(): void {
    const id = this.cancelInvoiceId();
    if (id !== null) {
      this.cancelInvoice(id);
    }
    this.cancelModalOpen.set(false);
    this.cancelInvoiceId.set(null);
  }

  openDeliverModal(invoiceId: number): void {
    this.pendingInvoiceId.set(invoiceId);
    this.deliverEmail.set('');
    this.deliverEmailError.set('');
    this.deliverModalOpen.set(true);
  }

  onDeliverEmailInput(event: Event): void {
    this.deliverEmail.set((event.target as HTMLInputElement).value);
  }

  onDeliverSubmit(): void {
    const email = this.deliverEmail().trim();
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      this.deliverEmailError.set('Correo electrónico inválido.');
      return;
    }
    this.deliverModalOpen.set(false);
    const id = this.pendingInvoiceId();
    if (id !== null) {
      this.doDeliverEmail(id, email);
    }
  }

  openRadianModal(invoiceId: number): void {
    this.pendingInvoiceId.set(invoiceId);
    this.radianSelectedCode.set(null);
    this.radianModalOpen.set(true);
  }

  onRadianSubmit(): void {
    const code = this.radianSelectedCode();
    this.radianModalOpen.set(false);
    const id = this.pendingInvoiceId();
    if (id !== null && code) {
      this.doRegisterRadianEvent(id, code);
    }
  }

  whWithholdingAmount(wh: { amount?: number | string; base_amount: number | string; rate: number | string }): number | string {
    if (wh.amount !== undefined && wh.amount !== null) return wh.amount;
    return Number(wh.base_amount) * Number(wh.rate);
  }

  readonly canCancel = computed<boolean>(() => {
    const d = this.data();
    if (!d) return false;
    const s = d.invoice.state;
    return s === 'draft' || s === 'validated';
  });

  formatPeriodDate(value: string | null | undefined): string {
    if (!value) return '—';
    return formatDate(value, 'longDate', 'es-CO', PLATFORM_TIMEZONE);
  }

  operationTypeLabel(value: string | undefined): string {
    switch (value) {
      case '09': return 'AIU (09)';
      case '11': return 'Mandato (11)';
      case '12': return 'Consorcio (12)';
      default: return 'Estándar (10)';
    }
  }

  evidenceKind(metadata: unknown): string | null {
    return (metadata as any)?.kind ?? null;
  }

  async loadReadiness(invoiceId: number): Promise<void> {
    try {
      const res = await firstValueFrom(
        this.http.get<{
          success: boolean;
          data: {
            blockers?: Array<{ code: string; problem: string; fix?: string }>;
            warnings?: Array<{ code: string; problem: string }>;
          };
        }>(`${this.base}${this.readinessPathPrefix}/${invoiceId}/emit-readiness`),
      );
      this.readinessBlockers.set(res?.data?.blockers ?? []);
      this.readinessWarnings.set(res?.data?.warnings ?? []);
    } catch {
      // fallback silencioso
    }
  }

  async onDiagnoseEmit(invoiceId: number): Promise<void> {
    await this.loadReadiness(invoiceId);
    await this.issueNow();
  }

  /**
   * Emite el documento. CADA RIEL TIENE SU RUTA Y SU ESPACIO DE ID:
   *   · plataforma → `POST invoices/:id/send`  (`fiscal_transmissions.id`)
   *   · SaaS       → `POST invoices/:id/issue` (`subscription_invoices.id`)
   *
   * Antes las dos usaban `/send`, la de plataforma. Sobre una factura SaaS eso
   * mandaba su `subscription_invoices.id` a un handler que lo interpreta como
   * id de transmisión de plataforma.
   */
  async issueNow(): Promise<void> {
    const d = this.data();
    if (!d) return;
    this.issuing.set(true);
    this.issueError.set(null);
    try {
      if (this.isPlatformRail()) {
        await firstValueFrom(
          this.http.post(`${this.base}/invoices/${d.invoice.id}/send`, {}),
        );
        this.toast.success('Documento enviado a DIAN');
      } else {
        const result = await firstValueFrom(this.fiscal.issueInvoice(d.invoice.id));
        if ('skipped' in result && result.skipped) {
          this.toast.warning('La factura no se emitió; revise la prevalidación.');
        } else {
          this.toast.success('Documento enviado a DIAN');
        }
      }
      await this.load(d.invoice.id);
    } catch (error) {
      const msg = describeApiFailure(error).message;
      this.issueError.set(msg);
      this.toast.error(msg);
    } finally {
      this.issuing.set(false);
    }
  }

  async retryTransmission(transmissionId: number): Promise<void> {
    this.retrying.set(transmissionId);
    try {
      await firstValueFrom(this.fiscal.retryTransmission(transmissionId));
      this.toast.success('Reintento encolado');
      const id = this.data()?.invoice.id;
      if (id) await this.load(id);
    } catch (error) {
      this.toast.error(describeApiFailure(error).message);
    } finally {
      this.retrying.set(null);
    }
  }

  /**
   * `POST invoices/:id/cancel` es del riel plataforma y resuelve por
   * `fiscal_transmissions.id`. No hay ruta equivalente para el riel SaaS, así
   * que el botón se oculta allí en vez de mandar el id equivocado.
   */
  async cancelInvoice(invoiceId: number): Promise<void> {
    if (!this.isPlatformRail()) {
      this.toast.warning(
        'Las facturas de suscripción no se cancelan desde esta pantalla.',
        'Acción no disponible',
      );
      return;
    }
    this.cancelling.set(true);
    try {
      await firstValueFrom(
        this.http.post(`${this.base}/invoices/${invoiceId}/cancel`, {
          reason: 'cancelado desde UI super-admin',
        }),
      );
      this.toast.success('Documento cancelado');
      await this.load(invoiceId);
    } catch (error) {
      this.toast.error(describeApiFailure(error).message);
    } finally {
      this.cancelling.set(false);
    }
  }

  /**
   * P3.6 — Acciones fiscales plataforma:
   * - deliver: reenvío por correo (C.3.5 ya real en P1.2)
   * - radian: registro de evento RADIAN (C.4.5 ya real en P1.3)
   * - preview-pdf / regenerate: PDF pipeline (C.5.5 ya real en P1.4)
   *
   * El path de la plataforma es /sales-invoices/:id/{deliver,events} y
   * /invoices/:id/{preview-pdf,pdf,pdf/regenerate} — el backend mantiene
   * discriminadores por tipo de transmision.
   */
  async doDeliverEmail(invoiceId: number, email: string): Promise<void> {
    this.actionLoading.set(true);
    try {
      const receipt = await firstValueFrom(
        this.fiscal.deliverPlatformInvoice(invoiceId, email),
      );
      this.toast.success(
        `Reenvío a ${email} (zip: ${receipt?.zip_name || '—'})`,
      );
    } catch (err) {
      this.toast.error(describeApiFailure(err).message, 'Reenvío');
    } finally {
      this.actionLoading.set(false);
    }
  }

  async doRegisterRadianEvent(invoiceId: number, eventCode: string): Promise<void> {
    this.actionLoading.set(true);
    try {
      const event = await firstValueFrom(
        this.fiscal.registerPlatformDianEvent(invoiceId, { event_code: eventCode }),
      );
      this.toast.success(
        `Evento ${eventCode} registrado (id=${event?.id}, status=${event?.status})`,
      );
    } catch (err) {
      this.toast.error(describeApiFailure(err).message, 'RADIAN');
    } finally {
      this.actionLoading.set(false);
    }
  }

  /**
   * Previsualización del PDF.
   *
   * El endpoint responde `application/pdf` EN CRUDO, sin envelope. El código
   * anterior pedía `responseType: 'blob' as 'json'` y después leía
   * `res.success` sobre el `Blob` resultante: eso es siempre `undefined`, así
   * que el `if` nunca entraba y el botón no abría absolutamente nada —ni
   * siquiera fallaba—. Encima el toast prometía «ver logs backend para blob
   * URL», que no es algo que un operador pueda hacer.
   */
  async previewPdf(invoiceId: number): Promise<void> {
    this.actionLoading.set(true);
    try {
      const blob = await firstValueFrom(
        this.fiscal.previewPlatformInvoicePdf(invoiceId),
      );
      const url = URL.createObjectURL(new Blob([blob], { type: 'application/pdf' }));
      if (!window.open(url, '_blank', 'noopener')) {
        this.toast.warning(
          'El navegador bloqueó la ventana emergente con la previsualización.',
          'Previsualización',
        );
      }
      // Se revoca tarde: la pestaña nueva ya cargó el documento y revocar de
      // inmediato la dejaría en blanco en algunos navegadores.
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (err) {
      this.toast.warning(describeApiFailure(err).message, 'Previsualización');
    } finally {
      this.actionLoading.set(false);
    }
  }

  /**
   * Regenera el PDF y ABRE el resultado. Antes sólo anunciaba la llave de S3
   * (`res.data.key`), que no le sirve de nada a quien quiere ver el documento.
   */
  async regeneratePdf(invoiceId: number): Promise<void> {
    this.actionLoading.set(true);
    try {
      const location = await firstValueFrom(
        this.fiscal.regeneratePlatformInvoicePdf(invoiceId),
      );
      if (location?.url) {
        window.open(location.url, '_blank', 'noopener');
        this.toast.success('PDF regenerado');
      } else {
        this.toast.warning('El PDF se regeneró pero no devolvió URL firmada.');
      }
    } catch (err) {
      this.toast.error(describeApiFailure(err).message, 'PDF');
    } finally {
      this.actionLoading.set(false);
    }
  }

  private async load(id: number): Promise<void> {
    try {
      const res = await firstValueFrom(
        this.http.get<{ success: boolean; data: SubscriptionInvoiceDetail }>(
          `${this.base}${this.detailPathPrefix}/${id}`,
        ),
      );
      if (res?.success && res.data) {
        this.data.set(res.data);
      } else {
        this.errorMessage.set('La API no devolvió la factura.');
      }
    } catch (error) {
      const msg =
        (error instanceof HttpErrorResponse && (error.error?.message ?? error.message)) ||
        (error instanceof Error ? error.message : null) ||
        'Error desconocido al cargar la factura.';
      this.errorMessage.set(msg);
      this.toast.error(msg);
    } finally {
      this.loading.set(false);
    }
  }
}