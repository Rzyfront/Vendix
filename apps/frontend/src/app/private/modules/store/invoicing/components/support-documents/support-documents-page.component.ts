import { Component, inject, signal } from '@angular/core';
import { Store } from '@ngrx/store';
import { toSignal } from '@angular/core/rxjs-interop';

import { SupportDocumentListComponent } from './support-document-list.component';
import { SupportDocumentCreateComponent } from './support-document-create.component';
import { InvoicingNotConfiguredComponent } from '../invoicing-not-configured/invoicing-not-configured.component';
import { SaveRequirementsModalComponent } from '../../../../../../shared/components/index';
import { FiscalRequirementsService } from '../../../../../../shared/services/fiscal-requirements.service';
import {
  selectDianConfigsLoading,
  selectDianConfigStatus,
  type DianConfigGateStatus,
  type DianGateReason,
} from '../../state/selectors/invoicing.selectors';
import type { SupportDocumentRow } from '../../interfaces/support-document.interface';
import type { Invoice } from '../../interfaces/invoice.interface';

/**
 * Página "Documentos soporte" (QUI-682).
 *
 * Une el listado y el form de creación. La pestaña es visible aunque el
 * tenant no tenga `support_document` configurado (decision documentada en
 * `docs/plans/qui-308-scope-report.md` D.1): cuando se intente crear, se abre
 * `InvoicingNotConfiguredComponent` con CTA al wizard de configuración.
 *
 * El detalle + ajuste + anulación llegan en QUI-683 (mismo árbol).
 */
@Component({
  selector: 'app-support-documents-page',
  standalone: true,
  imports: [
    SupportDocumentListComponent,
    SupportDocumentCreateComponent,
    InvoicingNotConfiguredComponent,
    SaveRequirementsModalComponent,
  ],
  template: `
    <div class="w-full">
      <app-support-document-list
        (create)="openCreateModal()"
        (view)="viewDocument($event)"
      ></app-support-document-list>

      @defer (when isCreateModalOpen()) {
        <app-support-document-create
          [(isOpen)]="isCreateModalOpen"
          (created)="onCreated($event)"
        ></app-support-document-create>
      }

      @defer (when isNotConfiguredModalOpen()) {
        <app-invoicing-not-configured
          [(isOpen)]="isNotConfiguredModalOpen"
          [reason]="notConfiguredReason()"
        ></app-invoicing-not-configured>
      }

      <!-- Prevalidación operativa (requisitos fiscales compartidos). -->
      <app-save-requirements-modal
        [(isOpen)]="fiscalReq.isOpen"
        [requirements]="fiscalReq.requirements()"
        (action)="fiscalReq.handleAction($event)"
      />
    </div>
  `,
})
export class SupportDocumentsPageComponent {
  private store = inject(Store);

  /** Modal compartido de requisitos fiscales (accedido desde el template). */
  readonly fiscalReq = inject(FiscalRequirementsService);

  // Estado de los modales
  readonly isCreateModalOpen = signal(false);
  readonly isNotConfiguredModalOpen = signal(false);
  readonly notConfiguredReason = signal<DianGateReason>('missing');

  // Gate DIAN — reutilizamos el selector ya existente: si la tienda tiene
  // CUALQUIER configuración DIAN habilitada (default), dejamos pasar. Si no,
  // abrimos el modal con CTA al wizard. La verificación granular por
  // `configuration_type='support_document'` la trae QUI-657.
  readonly dianStatus = toSignal(this.store.select(selectDianConfigStatus), {
    initialValue: {
      configured: false,
      reason: null,
      default: null,
    } as DianConfigGateStatus,
  });
  readonly dianConfigsLoading = toSignal(
    this.store.select(selectDianConfigsLoading),
    { initialValue: false },
  );

  openCreateModal(): void {
    if (this.dianConfigsLoading()) return;

    const status = this.dianStatus();
    if (!status.configured) {
      this.notConfiguredReason.set(status.reason ?? 'missing');
      this.isNotConfiguredModalOpen.set(true);
      return;
    }
    this.isCreateModalOpen.set(true);
  }

  viewDocument(row: SupportDocumentRow): void {
    // El detalle llega en QUI-683 — por ahora cerramos con un mensaje para
    // que la fila no parezca muerta y deje claro que la acción es intencional.
    // eslint-disable-next-line no-console
    console.info(
      '[QUI-682 stub] Documento soporte seleccionado:',
      row.invoice_number,
      '(detalle en QUI-683)',
    );
  }

  onCreated(_invoice: Invoice | SupportDocumentRow): void {
    // El padre (routing) podría refrescar el tab padre si quisiera; por ahora
    // el list ya está recargado localmente desde el componente create.
  }
}