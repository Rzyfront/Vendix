import { Component, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { Store } from '@ngrx/store';
import { toSignal } from '@angular/core/rxjs-interop';

import {
  clearDianRejection,
  loadInvoices,
  loadInvoiceStats,
  loadResolutions,
  loadDianConfigs,
} from './state/actions/invoicing.actions';
import {
  selectInvoices,
  selectInvoicesLoading,
  selectDianConfigStatus,
  selectDianConfigsLoading,
  DianConfigGateStatus,
  DianGateReason,
} from './state/selectors/invoicing.selectors';
import { Invoice } from './interfaces/invoice.interface';

import { InvoiceStatsComponent } from './components/invoice-stats/invoice-stats.component';
import { InvoiceListComponent } from './components/invoice-list/invoice-list.component';
import { InvoiceDetailComponent } from './components/invoice-detail/invoice-detail.component';
import { CreditNoteCreateComponent } from './components/credit-note-create/credit-note-create.component';
import { InvoicingNotConfiguredComponent } from './components/invoicing-not-configured/invoicing-not-configured.component';
import { CurrencyFormatService } from '../../../../shared/pipes/currency';
import { SaveRequirementsModalComponent } from '../../../../shared/components/index';
import { FiscalRequirementsService } from '../../../../shared/services/fiscal-requirements.service';

@Component({
  selector: 'vendix-invoicing',
  standalone: true,
  imports: [
    InvoiceStatsComponent,
    InvoiceListComponent,
    InvoiceDetailComponent,
    CreditNoteCreateComponent,
    InvoicingNotConfiguredComponent,
    SaveRequirementsModalComponent,
  ],
  template: `
    <div class="w-full">
      <!-- Stats: Sticky on mobile, static on desktop -->
      <div
        class="stats-container sticky top-0 z-20 bg-background md:static md:bg-transparent"
      >
        <vendix-invoice-stats></vendix-invoice-stats>
      </div>

      <!-- Invoice List -->
      <app-invoice-list
        [invoices]="invoices() || []"
        [loading]="loading() || false"
        (create)="openCreateModal()"
        (view)="viewInvoice($event)"
        (refresh)="refreshInvoices()"
      ></app-invoice-list>

      @defer (when isDetailModalOpen()) {
        <vendix-invoice-detail
          [(isOpen)]="isDetailModalOpen"
          [invoice]="selectedInvoice()"
          (creditNote)="openCreditNoteModal($event)"
        ></vendix-invoice-detail>
      }

      @defer (when isCreditNoteModalOpen()) {
        <vendix-credit-note-create
          [(isOpen)]="isCreditNoteModalOpen"
          [sourceInvoice]="creditNoteSourceInvoice()"
        ></vendix-credit-note-create>
      }

      @defer (when isNotConfiguredModalOpen()) {
        <app-invoicing-not-configured
          [(isOpen)]="isNotConfiguredModalOpen"
          [reason]="notConfiguredReason()"
        ></app-invoicing-not-configured>
      }

      <!-- Prevalidacion operativa de facturacion: un 4xx fiscal al validar /
           enviar a la DIAN / anular / nota credito se explica con el modal de
           requisitos compartido (motivo + CTA a la config correcta). Lo dispara
           InvoicingEffects via FiscalRequirementsService. -->
      <app-save-requirements-modal
        [(isOpen)]="fiscalReq.isOpen"
        [requirements]="fiscalReq.requirements()"
        (action)="fiscalReq.handleAction($event)"
      />
    </div>
  `,
})
export class InvoicingComponent {
  private currencyService = inject(CurrencyFormatService);
  private store = inject(Store);
  private router = inject(Router);
  /** Modal compartido de requisitos fiscales (accedido desde el template). */
  readonly fiscalReq = inject(FiscalRequirementsService);

  invoices$ = this.store.select(selectInvoices);
  loading$ = this.store.select(selectInvoicesLoading);

  // Signal-based properties
  readonly invoices = toSignal(this.invoices$, {
    initialValue: [] as Invoice[],
  });
  readonly loading = toSignal(this.loading$, { initialValue: false });

  // DIAN config gate (pre-invoice)
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

  // Modal states
  readonly isDetailModalOpen = signal(false);
  readonly isCreditNoteModalOpen = signal(false);
  readonly isNotConfiguredModalOpen = signal(false);
  readonly notConfiguredReason = signal<DianGateReason>('missing');
  readonly selectedInvoice = signal<Invoice | null>(null);
  readonly creditNoteSourceInvoice = signal<Invoice | null>(null);

  constructor() {
    // Limpia cualquier estado stale del modal dejado por otra superficie
    // (p.ej. una factura creada desde el POS) antes de que este contenedor
    // monte su propio host del modal.
    this.fiscalReq.close();
    this.currencyService.loadCurrency();
    this.store.dispatch(loadInvoices());
    this.store.dispatch(loadInvoiceStats());
    this.store.dispatch(loadResolutions());
    this.store.dispatch(loadDianConfigs());
  }

  /**
   * Entrada ÚNICA a la captura de una factura.
   *
   * Era un modal en este mismo componente y ahora es una ruta propia
   * (`/admin/invoicing/invoices/new`). Lo que NO cambia es la guarda: sin
   * configuración DIAN no se entra, porque la pantalla de captura gasta
   * numeración autorizada y entrar a llenarla para descubrirlo al final es el
   * peor sitio donde dar la noticia.
   */
  openCreateModal(): void {
    // Block until DIAN configs finish loading — avoid showing "missing" prematurely.
    if (this.dianConfigsLoading()) return;

    const status = this.dianStatus();
    if (!status.configured) {
      this.notConfiguredReason.set(status.reason ?? 'missing');
      this.isNotConfiguredModalOpen.set(true);
      return;
    }
    void this.router.navigate(['/admin/invoicing/invoices/new']);
  }

  viewInvoice(invoice: Invoice): void {
    // El rechazo en estado pertenece a la factura anterior. `viewInvoice` no
    // despacha `loadInvoice` (el detalle se pinta con la fila de la lista), asi
    // que el reducer no tiene forma de enterarse: hay que limpiarlo aqui o el
    // panel de rechazo aparecería sobre una factura que la DIAN nunca vio.
    this.store.dispatch(clearDianRejection());
    this.selectedInvoice.set(invoice);
    this.isDetailModalOpen.set(true);
  }

  openCreditNoteModal(invoice: Invoice): void {
    this.creditNoteSourceInvoice.set(invoice);
    this.isCreditNoteModalOpen.set(true);
  }

  refreshInvoices(): void {
    this.store.dispatch(loadInvoices());
    this.store.dispatch(loadInvoiceStats());
  }
}
