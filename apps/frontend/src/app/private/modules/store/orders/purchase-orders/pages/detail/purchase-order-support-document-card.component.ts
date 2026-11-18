import { Component, computed, inject, input } from '@angular/core';
import { Router } from '@angular/router';

import {
  BadgeComponent,
  CardComponent,
  IconComponent,
  ToastService,
} from '../../../../../../../shared/components/index';
import type { BadgeVariant } from '../../../../../../../shared/components/badge/badge.component';
import { CurrencyPipe } from '../../../../../../../shared/pipes/currency';
import { formatDateOnlyUTC } from '../../../../../../../shared/utils/date.util';
import type { PoSupportDocument } from '../../../../invoicing/interfaces/support-document.interface';

const STATUS_LABELS: Record<string, string> = {
  draft: 'Borrador',
  validated: 'Validado',
  sent: 'Enviado',
  accepted: 'Aceptado',
  rejected: 'Rechazado',
  cancelled: 'Cancelado',
  voided: 'Anulado',
};

const STATUS_VARIANTS: Record<string, BadgeVariant> = {
  draft: 'neutral',
  validated: 'info',
  sent: 'info',
  accepted: 'success',
  rejected: 'error',
  cancelled: 'warning',
  voided: 'neutral',
};

const DIAN_LABELS: Record<string, string> = {
  accepted: 'DIAN: aceptado',
  rejected: 'DIAN: rechazado',
  pending: 'DIAN: pendiente',
  sent: 'DIAN: enviado',
  unavailable: 'DIAN: sin respuesta',
};

const DIAN_VARIANTS: Record<string, BadgeVariant> = {
  accepted: 'success',
  rejected: 'error',
  pending: 'warning',
  sent: 'info',
  unavailable: 'neutral',
};

/**
 * Tarjeta «Documento soporte» del detalle de la orden de compra (QUI-684, H2):
 * lista los documentos soporte ligados a la OC y lleva al detalle en
 * Facturación → Documentos soporte con `?document=<id>`.
 */
@Component({
  selector: 'app-purchase-order-support-document-card',
  standalone: true,
  imports: [CardComponent, BadgeComponent, IconComponent, CurrencyPipe],
  template: `
    <app-card>
      <h2 class="text-xs font-bold text-text-primary uppercase tracking-wider mb-3">Documento soporte</h2>

      @if (documents().length === 0) {
        <p class="text-sm text-text-secondary" role="note">
          Esta orden aún no tiene documento soporte.
        </p>
      } @else {
        <div class="space-y-2">
          @for (doc of rows(); track doc.id) {
            <div class="border border-border rounded-lg p-2.5 space-y-2" data-testid="po-support-doc">
              <div class="flex items-start justify-between gap-2">
                <div class="min-w-0">
                  <p class="text-sm font-semibold text-text-primary truncate">{{ doc.invoice_number }}</p>
                  <p class="text-xs text-text-secondary">{{ doc.dateLabel }}</p>
                </div>
                <span class="text-sm font-bold text-primary shrink-0">{{ doc.total_amount | currency }}</span>
              </div>

              <div class="flex flex-wrap items-center gap-1.5">
                <app-badge size="xs" [variant]="doc.statusVariant">{{ doc.statusLabel }}</app-badge>
                @if (doc.dianLabel) {
                  <app-badge size="xs" [variant]="doc.dianVariant">{{ doc.dianLabel }}</app-badge>
                }
              </div>

              @if (doc.cufe) {
                <div class="flex items-center gap-1.5 text-xs text-text-secondary">
                  <span class="font-medium">CUDS</span>
                  <span class="truncate font-mono" [attr.title]="doc.cufe" data-testid="po-support-cuds">{{ doc.cudsShort }}</span>
                  <button
                    type="button"
                    class="p-1 rounded text-text-secondary hover:text-primary"
                    aria-label="Copiar CUDS"
                    (click)="copyCuds(doc.cufe)"
                  >
                    <app-icon name="copy" [size]="13" />
                  </button>
                </div>
              }

              <button
                type="button"
                class="text-xs font-medium text-primary hover:underline"
                (click)="viewDetail(doc.id)"
              >
                Ver detalle
              </button>
            </div>
          }
        </div>
      }
    </app-card>
  `,
})
export class PurchaseOrderSupportDocumentCardComponent {
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);

  /** Documentos ligados a la OC, el más reciente primero (incluye el historial anulado). */
  readonly documents = input<PoSupportDocument[]>([]);

  readonly rows = computed(() =>
    this.documents().map((d) => ({
      ...d,
      dateLabel: d.issue_date ? formatDateOnlyUTC(d.issue_date) : '',
      statusLabel: STATUS_LABELS[d.status] ?? d.status,
      statusVariant: STATUS_VARIANTS[d.status] ?? 'neutral',
      dianLabel: d.dian_status ? (DIAN_LABELS[d.dian_status] ?? `DIAN: ${d.dian_status}`) : null,
      dianVariant: DIAN_VARIANTS[d.dian_status ?? ''] ?? 'neutral',
      cudsShort: d.cufe ? this.shorten(d.cufe) : '',
    })),
  );

  private shorten(value: string): string {
    return value.length > 20 ? `${value.slice(0, 10)}…${value.slice(-8)}` : value;
  }

  viewDetail(id: number): void {
    void this.router.navigate(['/admin/invoicing/support-documents'], {
      queryParams: { document: id },
    });
  }

  copyCuds(cuds: string): void {
    const clipboard = typeof navigator !== 'undefined' ? navigator.clipboard : undefined;
    if (!clipboard) {
      this.toast.error('No se pudo copiar el CUDS');
      return;
    }
    clipboard.writeText(cuds).then(
      () => this.toast.success('CUDS copiado'),
      () => this.toast.error('No se pudo copiar el CUDS'),
    );
  }
}
