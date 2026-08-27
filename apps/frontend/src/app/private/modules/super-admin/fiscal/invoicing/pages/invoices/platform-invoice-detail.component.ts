import { CurrencyPipe, DatePipe, formatDate } from '@angular/common';
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
  InputComponent,
  ModalComponent,
  ResponsiveDataViewComponent,
  SelectorComponent,
  TableColumn,
} from '../../../../../../../shared/components';
import { CurrencyPipe as VendixCurrencyPipe } from '../../../../../../../shared/pipes/currency';
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
    InputComponent,
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
        <p class="mt-4 text-sm text-gray-500">Cargando factura…</p>
      } @else if (errorMessage(); as msg) {
        <app-alert-banner variant="danger" class="mt-4">{{ msg }}</app-alert-banner>
      } @else if (data(); as d) {
        <h2 class="mt-4 text-2xl font-semibold text-gray-900">
          Factura {{ d.invoice.invoice_number }}
        </h2>
        <p class="text-sm text-gray-500">
          {{ d.organization?.legal_name ?? d.organization?.name ?? '—' }}
          ({{ d.organization?.tax_id ?? 'sin NIT' }})
        </p>

        <!-- Resumen + Plan -->
        <section class="mt-6 grid grid-cols-2 gap-4 text-sm">
          <div class="bg-white rounded-lg shadow p-4">
            <h2 class="font-semibold text-gray-900 mb-2">Resumen</h2>
            <dl class="grid grid-cols-2 gap-y-1">
              <dt class="text-gray-500">Estado</dt>
              <dd>{{ invoiceStateLabel(d.invoice.state) }}</dd>
              <dt class="text-gray-500">Periodo</dt>
              <dd>{{ formatPeriodDate(d.invoice.period_start) }} → {{ formatPeriodDate(d.invoice.period_end) }}</dd>
              <dt class="text-gray-500">Subtotal</dt>
              <dd>{{ subtotalNumber() | currency }}</dd>
              <dt class="text-gray-500">Impuestos</dt>
              <dd>{{ taxAmountNumber() | currency }}</dd>
              <dt class="text-gray-500">Total</dt>
              <dd class="font-semibold">{{ totalNumber() | currency }}</dd>
              <dt class="text-gray-500">Saldo a pagar</dt>
              <dd>{{ saldo() | currency }}</dd>
              @if (globalDiscountAmountNumber() > 0) {
                <dt class="text-gray-500">Descuento global</dt>
                <dd>- {{ globalDiscountAmountNumber() | currency }}</dd>
              }
              @if (withholdingAmountNumber() > 0) {
                <dt class="text-gray-500">Retenciones</dt>
                <dd>{{ withholdingAmountNumber() | currency }}</dd>
              }
            </dl>
          </div>

          <div class="bg-white rounded-lg shadow p-4">
            <h2 class="font-semibold text-gray-900 mb-2">Pago</h2>
            <dl class="grid grid-cols-2 gap-y-1">
              <dt class="text-gray-500">Forma</dt>
              <dd>{{ d.invoice.payment_form === '2' ? 'Crédito' : 'Contado' }}</dd>
              @if (d.invoice.due_date) {
                <dt class="text-gray-500">Vencimiento</dt>
                <dd>{{ formatPeriodDate(d.invoice.due_date) }}</dd>
              }
              @if (d.invoice.exchange_rate) {
                <dt class="text-gray-500">TRM</dt>
                <dd>{{ d.invoice.exchange_rate }} ({{ d.invoice.exchange_rate_date ?? '—' }})</dd>
              }
              @if (d.invoice.operation_type && d.invoice.operation_type !== '10') {
                <dt class="text-gray-500">Tipo de operación</dt>
                <dd>{{ operationTypeLabel(d.invoice.operation_type) }}</dd>
              }
            </dl>
            @if (d.plan) {
              <p class="mt-3 text-sm text-gray-700">
                Plan: <span class="font-medium">{{ d.plan.name }}</span> ({{ billingCycleLabel(d.plan.billing_cycle) }})
              </p>
            }
          </div>
        </section>

        <!-- Tenant (destinatario) snapshot -->
        @if (acquirerSnapshot(); as acq) {
          <section class="mt-6 bg-white rounded-lg shadow p-4">
            <h2 class="font-semibold text-gray-900 mb-3">Destinatario (snapshot al emitir)</h2>
            <dl class="grid grid-cols-2 gap-y-1 text-sm">
              <dt class="text-gray-500">Tipo</dt>
              <dd class="font-mono">{{ acq.kind }} :{{ acq.id }}</dd>
              <dt class="text-gray-500">Razón social</dt>
              <dd>{{ acq.legal_name }}</dd>
              <dt class="text-gray-500">NIT</dt>
              <dd>{{ acq.tax_id }}{{ acq.tax_id_dv ? '-' + acq.tax_id_dv : '' }}</dd>
              @if (acq.tax_regime_code) {
                <dt class="text-gray-500">Régimen</dt>
                <dd>{{ acq.tax_regime_code }}</dd>
              }
              @if (acq.fiscal_responsibilities && acq.fiscal_responsibilities.length > 0) {
                <dt class="text-gray-500">Responsabilidades</dt>
                <dd>{{ acq.fiscal_responsibilities.join(', ') }}</dd>
              }
              @if (acq.email) {
                <dt class="text-gray-500">Email</dt>
                <dd>{{ acq.email }}</dd>
              }
              @if (acq.address && acq.address.line) {
                <dt class="text-gray-500">Dirección</dt>
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
          <section class="mt-6 bg-white rounded-lg shadow p-4">
            <h2 class="font-semibold text-gray-900 mb-3">Líneas</h2>
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
          <section class="mt-6 bg-white rounded-lg shadow p-4">
            <h2 class="font-semibold text-gray-900 mb-2">Nota AIU (regimen 09)</h2>
            <p class="text-sm text-gray-700 whitespace-pre-wrap">
              {{ invoiceSnapshot()!.aiu_contract_object }}
            </p>
            <p class="text-xs text-gray-500 mt-2">
              {{ invoiceSnapshot()!.aiu_contract_object!.length }} / 4900 caracteres
            </p>
          </section>
        }

        <!-- Retenciones breakdown -->
        @if (invoiceSnapshot()?.withholdings && invoiceSnapshot()!.withholdings!.length > 0) {
          <section class="mt-6 bg-white rounded-lg shadow p-4">
            <h2 class="font-semibold text-gray-900 mb-3">Retenciones</h2>
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
        <section class="mt-6 bg-white rounded-lg shadow p-4">
          <div class="flex items-center justify-between mb-3">
            <h2 class="font-semibold text-gray-900">Transmisiones DIAN</h2>
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
            <p class="text-sm text-gray-500">Esta factura aún no fue emitida.</p>
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
                      <span class="ml-2 text-xs text-gray-500">reintentos: {{ t.retry_count }}</span>
                    }
                  </p>
                  @if (t.cufe) {
                    <p class="text-xs text-gray-500 mt-1 break-all">CUFE: {{ t.cufe }}</p>
                  }
                  @if (t.qr_code) {
                    <p class="text-xs text-gray-500 mt-1 break-all">QR: {{ t.qr_code }}</p>
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
          <section class="mt-6 bg-white rounded-lg shadow p-4">
            <h2 class="font-semibold text-gray-900 mb-2">Pre-validación</h2>

            @if (readinessBlockers().length > 0) {
              <div class="border-l-4 border-warning bg-warning-light/30 p-3 rounded mb-3">
                <p class="font-semibold text-sm text-gray-900 mb-2">Bloqueadores</p>
                <ul class="text-xs space-y-2">
                  @for (b of readinessBlockers(); track b.code) {
                    <li>
                      <p class="font-mono text-gray-500">{{ b.code }}</p>
                      <p>{{ b.problem }}</p>
                      @if (b.fix) {
                        <p class="text-gray-700"><span class="font-medium">Cómo resolver:</span> {{ b.fix }}</p>
                      }
                    </li>
                  }
                </ul>
              </div>
            }

            @if (readinessWarnings().length > 0) {
              <div class="border-l-4 border-info bg-info-light/30 p-3 rounded">
                <p class="font-semibold text-sm text-gray-900 mb-2">Advertencias</p>
                <ul class="text-xs space-y-2">
                  @for (w of readinessWarnings(); track w.code) {
                    <li>
                      <p class="font-mono text-gray-500">{{ w.code }}</p>
                      <p>{{ w.problem }}</p>
                    </li>
                  }
                </ul>
              </div>
            }
          </section>
        }

        <!-- Acciones de documento -->
        @if (canCancel()) {
          <section class="mt-6 bg-white rounded-lg shadow p-4">
            <h2 class="font-semibold text-gray-900 mb-2">Acciones</h2>
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

        <!-- Acciones fiscales (P3.6: delivery, RADIAN, PDF) -->
        <section class="mt-6 bg-white rounded-lg shadow p-4">
          <h2 class="font-semibold text-gray-900 mb-2">Acciones fiscales</h2>
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

        <!-- Evidencias -->
        @if (d.evidences.length > 0) {
          <section class="mt-6 bg-white rounded-lg shadow p-4">
            <h2 class="font-semibold text-gray-900 mb-3">Evidencias</h2>
            <ul class="text-sm space-y-1">
              @for (e of d.evidences; track e.id) {
                <li>
                  <span class="font-mono text-xs text-gray-500">#{{ e.fiscal_transmission_id }}</span>
                  · {{ evidenceTypeLabel(e.evidence_type) }}
                  · <span class="text-gray-500">{{ e.created_at | date: 'short' }}</span>
                  @if (evidenceKind(e.metadata) && evidenceKind(e.metadata) !== 'platform_invoice_snapshot') {
                    <span class="text-xs text-gray-400">({{ evidenceKind(e.metadata) }})</span>
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
  private readinessPathPrefix = '/invoices';
  private sendPathPrefix = '/invoices';
  private cancelPathPrefix = '/invoices';

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
    const kind =
      this.route.snapshot.data['kind'] === 'platform' ? 'platform' : 'subscription';
    if (kind === 'platform') {
      this.detailPathPrefix = '/platform-invoices';
      this.readinessPathPrefix = '/platform-invoices';
      this.sendPathPrefix = '/invoices';
      this.cancelPathPrefix = '/invoices';
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

  // ── Lines table (ResponsiveDataView) ───────────────────────────────────
  readonly lineColumns: TableColumn[] = [
    { key: 'description', label: 'Descripción' },
    { key: 'quantity', label: 'Cant', align: 'right', transform: (v) => String(v) },
    { key: 'unit_price', label: 'Precio', align: 'right', transform: (v) => String(v) },
    {
      key: 'discount_amount',
      label: 'Desc',
      align: 'right',
      transform: (v) => (v ? String(v) : '—'),
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
  };

  // ── Withholdings table (ResponsiveDataView) ─────────────────────────────
  readonly withholdingColumns: TableColumn[] = [
    { key: 'role', label: 'Rol' },
    { key: 'concept_id', label: 'Concepto' },
    {
      key: 'base_amount',
      label: 'Base',
      align: 'right',
      transform: (v) => String(v),
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
      transform: (v, item) =>
        this.whWithholdingAmount(item as Parameters<typeof this.whWithholdingAmount>[0]) as string,
    },
  ];

  readonly withholdingCardConfig = {
    titleKey: 'role',
    subtitleKey: 'concept_id',
    detailKeys: [
      { key: 'base_amount', label: 'Base' },
      { key: 'rate', label: 'Tasa' },
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

  async issueNow(): Promise<void> {
    const d = this.data();
    if (!d) return;
    this.issuing.set(true);
    this.issueError.set(null);
    try {
      await firstValueFrom(
        this.http.post(`${this.base}${this.sendPathPrefix}/${d.invoice.id}/send`, {}),
      );
      this.toast.success('Documento enviado a DIAN');
      await this.load(d.invoice.id);
    } catch (error) {
      const msg =
        (error instanceof HttpErrorResponse && (error.error?.message ?? error.message)) ||
        (error instanceof Error ? error.message : null) ||
        'Error desconocido al emitir la factura.';
      this.issueError.set(msg);
      this.toast.error(msg);
    } finally {
      this.issuing.set(false);
    }
  }

  async retryTransmission(transmissionId: number): Promise<void> {
    this.retrying.set(transmissionId);
    try {
      await firstValueFrom(
        this.http.post(`${this.base}/transmissions/${transmissionId}/retry`, {}),
      );
      this.toast.success('Reintento encolado');
      const id = this.data()?.invoice.id;
      if (id) await this.load(id);
    } catch (error) {
      const msg =
        (error instanceof HttpErrorResponse && (error.error?.message ?? error.message)) ||
        (error instanceof Error ? error.message : null) ||
        'Error al reintentar la transmisión.';
      this.toast.error(msg);
    } finally {
      this.retrying.set(null);
    }
  }

  async cancelInvoice(invoiceId: number): Promise<void> {
    this.cancelling.set(true);
    try {
      await firstValueFrom(
        this.http.post(`${this.base}${this.cancelPathPrefix}/${invoiceId}/cancel`, {
          reason: 'cancelado desde UI super-admin',
        }),
      );
      this.toast.success('Documento cancelado');
      await this.load(invoiceId);
    } catch (error) {
      const msg =
        (error instanceof HttpErrorResponse && (error.error?.message ?? error.message)) ||
        (error instanceof Error ? error.message : null) ||
        'Error al cancelar.';
      this.toast.error(msg);
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
      const res = await firstValueFrom(
        this.http.post<{ success: boolean; data: any }>(
          `${this.base}/sales-invoices/${invoiceId}/deliver`,
          { email },
        ),
      );
      if (res.success) {
        this.toast.success(`Reenvío a ${email} (zip: ${res.data?.zip_name || '—'})`);
      } else {
        this.toast.error('Reenvío no completado');
      }
    } catch (err) {
      this.toast.error(
        `Reenvío: ${(err instanceof HttpErrorResponse && err.error?.message) || 'Error'}`,
      );
    } finally {
      this.actionLoading.set(false);
    }
  }

  async doRegisterRadianEvent(invoiceId: number, eventCode: string): Promise<void> {
    this.actionLoading.set(true);
    try {
      const res = await firstValueFrom(
        this.http.post<{ success: boolean; data: any }>(
          `${this.base}/sales-invoices/${invoiceId}/events`,
          { event_code: eventCode },
        ),
      );
      if (res.success) {
        this.toast.success(`Evento ${eventCode} registrado (id=${res.data?.id}, status=${res.data?.status})`);
      } else {
        this.toast.error('RADIAN no registrado');
      }
    } catch (err) {
      this.toast.error(
        `RADIAN: ${(err instanceof HttpErrorResponse && err.error?.message) || 'Error'}`,
      );
    } finally {
      this.actionLoading.set(false);
    }
  }

  async previewPdf(invoiceId: number): Promise<void> {
    this.actionLoading.set(true);
    try {
      const res = await firstValueFrom(
        this.http.post<{ success: boolean; data: any }>(
          `${this.base}/invoices/${invoiceId}/preview-pdf`,
          {},
          { responseType: 'blob' as 'json' },
        ),
      );
      if (res.success) {
        this.toast.success('Preview PDF solicitado (ver logs backend para blob URL)');
      }
    } catch (err) {
      const msg =
        (err instanceof HttpErrorResponse && err.error?.message) || 'Preview PDF no disponible';
      this.toast.warning(msg);
    } finally {
      this.actionLoading.set(false);
    }
  }

  async regeneratePdf(invoiceId: number): Promise<void> {
    this.actionLoading.set(true);
    try {
      const res = await firstValueFrom(
        this.http.post<{ success: boolean; data: { key: string; url?: string } }>(
          `${this.base}/invoices/${invoiceId}/pdf/regenerate`,
          {},
        ),
      );
      if (res.success) {
        this.toast.success(`PDF regenerado: ${res.data?.key}`);
      }
    } catch (err) {
      const msg =
        (err instanceof HttpErrorResponse && err.error?.message) || 'PDF no regenerado';
      this.toast.error(msg);
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