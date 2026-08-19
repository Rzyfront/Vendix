import { DatePipe } from '@angular/common';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Component, DestroyRef, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../../../../../../environments/environment';
import { CurrencyPipe } from '../../../../../../../shared/pipes/currency';
import { ToastService } from '../../../../../../../shared/components/toast/toast.service';
import {
  billingCycleLabel,
  evidenceTypeLabel,
  invoiceStateLabel,
  transmissionStatusBadgeClasses,
  transmissionStatusLabel,
} from '../../platform-invoicing.constants';

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
  }>;
  evidences: Array<{
    id: number;
    fiscal_transmission_id: number;
    evidence_type: string;
    content_hash?: string | null;
    storage_key?: string | null;
    metadata?: { value: string } | Record<string, unknown> | null;
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
 * Detalle de una factura SaaS en super-admin. Muestra la factura, sus
 * transmisiones DIAN y las evidencias (XML firmado, PDF, QR, respuesta DIAN).
 *
 * Trade-off documentado: el plan proponía reusar `invoice-detail.component.ts`
 * del carril de tienda con un adapter. Ese adapter rompe los 200 líneas y
 * comparte la mitad de la shape por similitud semántica con la de tienda.
 * Este componente nuevo muestra la SaaS directamente — la fase siguiente
 * factorizará un componente compartido si el adapter crece.
 */
@Component({
  selector: 'app-platform-invoice-detail',
  standalone: true,
  imports: [RouterLink, CurrencyPipe, DatePipe],
  template: `
    <div class="p-6 max-w-5xl mx-auto">
      <a routerLink="/super-admin/fiscal/invoicing/invoices" class="text-sm text-primary-600 hover:underline">
        ← Volver al listado
      </a>

      @if (loading()) {
        <p class="mt-4 text-sm text-gray-500">Cargando factura…</p>
      } @else if (errorMessage(); as msg) {
        <p class="mt-4 text-sm text-red-600">{{ msg }}</p>
      } @else if (data(); as d) {
        <h2 class="mt-4 text-2xl font-semibold text-gray-900">
          Factura {{ d.invoice.invoice_number }}
        </h2>
        <p class="text-sm text-gray-500">
          {{ d.organization?.legal_name ?? d.organization?.name ?? '—' }}
          ({{ d.organization?.tax_id ?? 'sin NIT' }})
        </p>

        <section class="mt-6 grid grid-cols-2 gap-4 text-sm">
          <div class="bg-white rounded-lg shadow p-4">
            <h2 class="font-semibold text-gray-900 mb-2">Resumen</h2>
            <dl class="grid grid-cols-2 gap-y-1">
              <dt class="text-gray-500">Estado</dt>
              <dd>{{ invoiceStateLabel(d.invoice.state) }}</dd>
              <dt class="text-gray-500">Periodo</dt>
              <dd>{{ d.invoice.period_start | date: 'longDate' }} → {{ d.invoice.period_end | date: 'longDate' }}</dd>
              <dt class="text-gray-500">Subtotal</dt>
              <dd>
                {{ d.invoice.subtotal | currency }}
                <span class="text-xs text-gray-500">{{ d.invoice.currency }}</span>
              </dd>
              <dt class="text-gray-500">Impuestos</dt>
              <dd>
                {{ d.invoice.tax_amount | currency }}
                <span class="text-xs text-gray-500">{{ d.invoice.currency }}</span>
              </dd>
              <dt class="text-gray-500">Total</dt>
              <dd class="font-semibold">
                {{ d.invoice.total | currency }}
                <span class="text-xs text-gray-500">{{ d.invoice.currency }}</span>
              </dd>
              <dt class="text-gray-500">Saldo a pagar</dt>
              <dd>
                {{ saldo(d) | currency }}
                <span class="text-xs text-gray-500">{{ d.invoice.currency }}</span>
              </dd>
            </dl>
          </div>

          <div class="bg-white rounded-lg shadow p-4">
            <h2 class="font-semibold text-gray-900 mb-2">Plan</h2>
            @if (d.plan) {
              <p>{{ d.plan.name }} ({{ billingCycleLabel(d.plan.billing_cycle) }})</p>
            } @else {
              <p class="text-gray-500">—</p>
            }
          </div>
        </section>

        <section class="mt-6 bg-white rounded-lg shadow p-4">
          <h2 class="font-semibold text-gray-900 mb-3">Transmisiones DIAN</h2>
          @if (d.transmissions.length === 0) {
            <div class="text-sm">
              <p class="text-gray-500 mb-3">Esta factura aún no fue emitida. Puede dispararla ahora mismo desde aquí.</p>
              <button
                type="button"
                (click)="issueNow()"
                [disabled]="issuing()"
                class="px-3 py-1.5 bg-primary-600 text-white text-sm rounded hover:bg-primary-700 disabled:opacity-50"
              >
                {{ issuing() ? 'Emitiendo…' : 'Emitir ahora' }}
              </button>
              @if (issueError(); as ie) {
                <p class="text-xs text-red-600 mt-2">{{ ie }}</p>
              }
            </div>
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
                  </p>
                  @if (t.cufe) {
                    <p class="text-xs text-gray-500 mt-1 break-all">CUFE: {{ t.cufe }}</p>
                  }
                  @if (t.error_message) {
                    <p class="text-xs text-red-600 mt-1">{{ t.error_message }}</p>
                  }
                </div>
              }
            </div>
          }
        </section>

        @if (d.evidences.length > 0) {
          <section class="mt-6 bg-white rounded-lg shadow p-4">
            <h2 class="font-semibold text-gray-900 mb-3">Evidencias</h2>
            <ul class="text-sm space-y-1">
              @for (e of d.evidences; track e.id) {
                <li>
                  <span class="font-mono text-xs text-gray-500">#{{ e.fiscal_transmission_id }}</span>
                  · {{ evidenceTypeLabel(e.evidence_type) }}
                  · <span class="text-gray-500">{{ e.created_at | date: 'short' }}</span>
                </li>
              }
            </ul>
          </section>
        }
      }
    </div>
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
  readonly issueError = signal<string | null>(null);

  // Helpers expuestos al template
  readonly invoiceStateLabel = invoiceStateLabel;
  readonly billingCycleLabel = billingCycleLabel;
  readonly evidenceTypeLabel = evidenceTypeLabel;
  readonly transmissionStatusLabel = transmissionStatusLabel;
  readonly transmissionStatusBadgeClasses = transmissionStatusBadgeClasses;

  private base = `${environment.apiUrl}/superadmin/subscriptions/fiscal`;

  constructor() {
    const id = Number(this.route.snapshot.paramMap.get('id'));
    if (!Number.isInteger(id) || id <= 0) {
      this.errorMessage.set('Identificador de factura inválido.');
      this.loading.set(false);
      return;
    }
    this.load(id);
  }

  /**
   * Saldo a pagar = total - amount_paid. Si la factura está `paid`, saldo = 0
   * y la métrica es informativa. Si está `draft`/`overdue`, saldo = total.
   */
  saldo(d: SubscriptionInvoiceDetail): string {
    const total = Number(d.invoice.total);
    const paid = Number(d.invoice.amount_paid);
    return (total - paid).toFixed(2);
  }

  /**
   * Emite la factura SaaS vía `POST /invoices/:id/issue` y recarga el detalle
   * para reflejar el resultado en la UI. El backend ya marca `transmission_status`
   * y devuelve la fila; el componente solo navega el resultado.
   */
  async issueNow(): Promise<void> {
    const d = this.data();
    if (!d) return;
    this.issuing.set(true);
    this.issueError.set(null);
    try {
      await firstValueFrom(this.http.post(`${this.base}/invoices/${d.invoice.id}/issue`, {}));
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

  private async load(id: number): Promise<void> {
    try {
      const res = await firstValueFrom(
        this.http.get<{ success: boolean; data: SubscriptionInvoiceDetail }>(
          `${this.base}/invoices/${id}`,
        ),
      );
      if (res?.success && res.data) {
        this.data.set(res.data);
      } else {
        this.errorMessage.set('La API no devolvió la factura.');
      }
    } catch (error) {
      // El backend usa el envoltorio `success:false, message:'...'`. Para
      // 4xx/5xx Angular lanza `HttpErrorResponse` cuyo `.message` es la
      // descripción del fallo HTTP (no lo que la API quiso decir).
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
