import { Component, inject, signal } from '@angular/core';
import { Store } from '@ngrx/store';
import { toSignal } from '@angular/core/rxjs-interop';

import {
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
import { InvoiceCreateComponent } from './components/invoice-create/invoice-create.component';
import { InvoiceDetailComponent } from './components/invoice-detail/invoice-detail.component';
import { CreditNoteCreateComponent } from './components/credit-note-create/credit-note-create.component';
import { InvoicingNotConfiguredComponent } from './components/invoicing-not-configured/invoicing-not-configured.component';
import { CurrencyFormatService } from '../../../../shared/pipes/currency';

@Component({
  selector: 'vendix-invoicing',
  standalone: true,
  imports: [
    InvoiceStatsComponent,
    InvoiceListComponent,
    InvoiceCreateComponent,
    InvoiceDetailComponent,
    CreditNoteCreateComponent,
    InvoicingNotConfiguredComponent,
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

      @defer (when isCreateModalOpen()) {
        <vendix-invoice-create
          [(isOpen)]="isCreateModalOpen"
        ></vendix-invoice-create>
      }

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
    </div>
  `,
})
export class InvoicingComponent {
  private currencyService = inject(CurrencyFormatService);
  private store = inject(Store);

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
  readonly isCreateModalOpen = signal(false);
  readonly isDetailModalOpen = signal(false);
  readonly isCreditNoteModalOpen = signal(false);
  readonly isNotConfiguredModalOpen = signal(false);
  readonly notConfiguredReason = signal<DianGateReason>('missing');
  readonly selectedInvoice = signal<Invoice | null>(null);
  readonly creditNoteSourceInvoice = signal<Invoice | null>(null);

  constructor() {
    this.currencyService.loadCurrency();
    this.store.dispatch(loadInvoices());
    this.store.dispatch(loadInvoiceStats());
    this.store.dispatch(loadResolutions());
    this.store.dispatch(loadDianConfigs());
  }

  // Modal handlers
  openCreateModal(): void {
    // Block until DIAN configs finish loading — avoid showing "missing" prematurely.
    if (this.dianConfigsLoading()) return;

    const status = this.dianStatus();
    if (!status.configured) {
      this.notConfiguredReason.set(status.reason ?? 'missing');
      this.isNotConfiguredModalOpen.set(true);
      return;
    }
    this.isCreateModalOpen.set(true);
  }

  viewInvoice(invoice: Invoice): void {
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
