import { Component, DestroyRef, effect, inject, input, signal, untracked } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { finalize, Subscription } from 'rxjs';
import { CardComponent } from '../../../../../shared/components/index';
import type { ReceivedDocumentAccountingEvidence, ReceivedDocumentAccountingEvidenceStatus, ReceivedDocumentsScope } from './received-documents.interface';
import { ReceivedDocumentsService } from './received-documents.service';
import { describeApiFailure } from '../utils/invoicing-errors.util';

@Component({
  selector: 'app-received-document-accounting-evidence',
  standalone: true,
  imports: [CardComponent],
  template: `
    <app-card [responsive]="true">
      <section aria-labelledby="accounting-evidence-title">
        <h2 id="accounting-evidence-title" class="mb-3 text-lg font-semibold text-text-primary">Evidencia contable</h2>
        <p class="mb-3 rounded-lg border border-warning/30 bg-warning-light p-3 text-sm" role="note">Un vínculo comercial o asiento identificado no habilita por sí solo IVA descontable</p>
        @if (loading()) { <p class="text-sm text-text-secondary" role="status">Cargando evidencia contable…</p> }
        @if (error()) { <div class="rounded-lg border border-error/30 bg-error-light p-3 text-sm text-error" role="alert">{{ error() }} <button class="ml-2 underline" type="button" (click)="load()">Reintentar</button></div> }
        @if (!loading() && !error() && evidence(); as result) {
          @if (!result.evidence.length && !result.unresolved_allocation_ids.length) { <p class="text-sm text-text-secondary">No hay evidencia contable verificada para mostrar.</p> }
          @if (result.evidence.length) {
            <ul class="space-y-2">
              @for (item of result.evidence; track $index) {
                <li class="rounded-lg border border-border p-3 text-sm">
                  <p class="font-medium">{{ sourceLabel(item.reference.source_type) }} · referencia {{ item.reference.source_id }}</p>
                  <p class="text-text-secondary">Entidad contable {{ item.reference.accounting_entity_id }} · {{ statusLabel(item.status) }}</p>
                  @if (item.accounting_entry_id !== undefined) { <p class="text-text-secondary">Asiento identificado: {{ item.accounting_entry_id }}</p> }
                </li>
              }
            </ul>
          }
          <section class="mt-4" aria-labelledby="payable-evidence-title">
            <h3 id="payable-evidence-title" class="mb-2 text-base font-semibold text-text-primary">Cuentas por pagar por recepción</h3>
            @if (result.payable_evidence.length) {
              <ul class="space-y-2">
                @for (item of result.payable_evidence; track item.reception_id) {
                  <li class="rounded-lg border border-border p-3 text-sm">
                    <p class="font-medium">Recepción {{ item.reception_id }} · {{ payableStatusLabel(item.status) }}</p>
                    <p class="text-text-secondary">Orden de compra: {{ item.purchase_order_id ?? 'No identificada' }}</p>
                    @if (item.accounts_payable_id !== undefined) { <p class="text-text-secondary">Cuenta por pagar identificada: {{ item.accounts_payable_id }}</p> }
                    @if (item.ap_reception_link_id !== undefined) { <p class="text-text-secondary">Vínculo de recepción identificado: {{ item.ap_reception_link_id }}</p> }
                    @if (item.gross_amount !== undefined) { <p class="text-text-secondary">Monto bruto ({{ item.currency ?? 'moneda no informada' }}): {{ item.gross_amount }}</p> }
                  </li>
                }
              </ul>
            } @else {
              <p class="text-sm text-text-secondary">No hay recepciones de compra con evidencia de CxP para mostrar.</p>
            }
            @if (result.payable_evidence_complete === null) {
              <p class="mt-2 text-sm text-text-secondary">No aplica a coincidencias sin recepción de compra.</p>
            } @else if (!result.payable_evidence_complete) {
              <p class="mt-2 rounded-lg border border-warning/30 bg-warning-light p-3 text-sm" role="status">Evidencia de CxP incompleta: hay recepciones sin vínculo de cuenta por pagar verificado.</p>
            } @else {
              <p class="mt-2 text-sm text-text-secondary">Vínculos de CxP verificados para las recepciones encontradas; esto no confirma pago ni elegibilidad fiscal.</p>
            }
          </section>
          @if (result.unresolved_tax_purchase_order_ids.length) {
            <div class="mt-3 rounded-lg border border-warning/30 bg-warning-light p-3 text-sm" role="alert">
              <p class="font-medium">Impuestos de compra sin trazabilidad financiera completa</p>
              <p>Órdenes con impuesto cuyo documento fiscal o asiento complementario no puede verificarse: {{ result.unresolved_tax_purchase_order_ids.join(', ') }}.</p>
              @if (result.unresolved_vat_purchase_order_ids.length) {
                <p class="mt-1">IVA descontable dentro de estos casos: {{ result.unresolved_vat_purchase_order_ids.join(', ') }}.</p>
              }
            </div>
          }
          @if (result.unresolved_allocation_ids.length) {
            <div class="mt-3 rounded-lg border border-warning/30 bg-warning-light p-3 text-sm" role="note">
              <p class="font-medium">Asignaciones sin recepción o gasto verificable</p>
              <p>Identificadores: {{ result.unresolved_allocation_ids.join(', ') }}</p>
            </div>
          }
          <p class="mt-3 text-sm text-text-secondary">Cobertura de vínculos financieros: {{ result.financial_evidence_complete ? 'identificados' : 'pendientes' }}. No valida montos ni balance contable y no determina elegibilidad fiscal.</p>
          <p class="mt-3 text-xs text-text-secondary">Elegibilidad fiscal: pendiente. Esta evidencia es informativa y no constituye reconocimiento fiscal.</p>
        }
      </section>
    </app-card>
  `,
})
export class ReceivedDocumentAccountingEvidenceComponent {
  readonly scope = input.required<ReceivedDocumentsScope>();
  readonly documentId = input.required<number>();
  readonly storeId = input<number | null>(null);
  private readonly service = inject(ReceivedDocumentsService);
  private readonly destroyRef = inject(DestroyRef);
  private activeRequest?: Subscription;
  readonly evidence = signal<ReceivedDocumentAccountingEvidence | null>(null);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);

  constructor() {
    effect(() => {
      this.scope(); this.documentId(); this.storeId();
      untracked(() => this.load());
    });
    this.destroyRef.onDestroy(() => this.activeRequest?.unsubscribe());
  }

  load(): void {
    this.activeRequest?.unsubscribe();
    this.evidence.set(null); this.error.set(null); this.loading.set(true);
    this.activeRequest = this.service.getAccountingEvidence(this.scope(), this.documentId(), this.storeId() ?? undefined)
      .pipe(takeUntilDestroyed(this.destroyRef), finalize(() => this.loading.set(false)))
      .subscribe({
        next: (response) => this.evidence.set(response.data),
        error: (err: unknown) => this.error.set(describeApiFailure(err).message || 'No se pudo cargar la evidencia contable.'),
      });
  }

  statusLabel(status: ReceivedDocumentAccountingEvidenceStatus): string {
    switch (status) {
      case 'linked': return 'Asiento vinculado';
      case 'missing': return 'Sin asiento verificado';
      case 'ambiguous': return 'Vínculo ambiguo';
      case 'foreign_entity': return 'Entidad contable distinta';
      case 'not_posted': return 'Asiento no vigente (borrador o anulado)';
      case 'unresolved_entity': return 'Entidad contable sin resolver';
    }
  }

  sourceLabel(sourceType: string): string {
    switch (sourceType) {
      case 'purchase_order.received': return 'Compra recibida';
      case 'expense.approved': return 'Gasto aprobado';
      default: return 'Origen contable no reconocido';
    }
  }

  payableStatusLabel(status: 'linked' | 'missing' | 'invalid_source' | 'foreign_scope'): string {
    switch (status) {
      case 'linked': return 'Vínculo CxP identificado';
      case 'missing': return 'Sin vínculo CxP verificado';
      case 'invalid_source': return 'Origen de CxP no válido';
      case 'foreign_scope': return 'CxP fuera del alcance de esta tienda u organización';
    }
  }
}
