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
          @if (result.unresolved_allocation_ids.length) {
            <div class="mt-3 rounded-lg border border-warning/30 bg-warning-light p-3 text-sm" role="note">
              <p class="font-medium">Asignaciones sin recepción o gasto verificable</p>
              <p>Identificadores: {{ result.unresolved_allocation_ids.join(', ') }}</p>
            </div>
          }
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
}
