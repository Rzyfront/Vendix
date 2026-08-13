import { Component, inject, signal, viewChild } from '@angular/core';
import { Store } from '@ngrx/store';
import { toSignal } from '@angular/core/rxjs-interop';

import { SupportDocumentListComponent } from './support-document-list.component';
import { SupportDocumentCreateComponent } from './support-document-create.component';
import { InvoicingNotConfiguredComponent } from '../invoicing-not-configured/invoicing-not-configured.component';
import { SaveRequirementsModalComponent } from '../../../../../../shared/components/index';
import { FiscalRequirementsService } from '../../../../../../shared/services/fiscal-requirements.service';
import { ToastService } from '../../../../../../shared/components/toast/toast.service';
import {
  selectDianConfigsLoading,
  selectDianConfigStatus,
  type DianConfigGateStatus,
  type DianGateReason,
} from '../../state/selectors/invoicing.selectors';
import { loadDianConfigs } from '../../state/actions/invoicing.actions';
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
        #listRef
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
  private toast = inject(ToastService);

  /** Modal compartido de requisitos fiscales (accedido desde el template). */
  readonly fiscalReq = inject(FiscalRequirementsService);

  /** Referencia al listado para poder re-disparar la carga tras una creación. */
  readonly listRef = viewChild<SupportDocumentListComponent>('listRef');

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

  constructor() {
    // Necesario para el deep-link directo a `/admin/invoicing/support-documents`
    // sin pasar por la pestaña de facturas: si nadie despacha la carga, el
    // `selectDianConfigStatus` queda en su `initialValue` (no configurado) y
    // el gate abre el modal "missing" al primer clic en "Nuevo".
    this.store.dispatch(loadDianConfigs());
  }

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
    // El detalle real llega en QUI-683. Mientras tanto, mostramos un toast
    // para que la fila no parezca muerta y deje claro que la acción es
    // intencional. Evita añadir un modal nuevo y abre solo cuando el usuario
    // interactúa con la fila.
    this.toast.show({
      title: 'Detalle en construcción',
      description: `El detalle del documento ${row.invoice_number ?? row.id} llega en QUI-683.`,
      variant: 'info',
    });
  }

  onCreated(_invoice: Invoice | SupportDocumentRow): void {
    // Tras un create exitoso, el form ya emite el documento por `created` y se
    // cierra. El listado debe re-cargar para mostrar la nueva fila.
    const list = this.listRef();
    if (list) {
      list.load();
    }
  }
}