import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, ActivatedRoute } from '@angular/router';
import { Store } from '@ngrx/store';
import { Observable } from 'rxjs';

import {
  loadInvoices,
  loadInvoiceStats,
  loadResolutions,
} from './state/actions/invoicing.actions';
import {
  selectInvoices,
  selectInvoicesLoading,
} from './state/selectors/invoicing.selectors';
import { Invoice } from './interfaces/invoice.interface';

import { InvoiceStatsComponent } from './components/invoice-stats/invoice-stats.component';
import { InvoiceListComponent } from './components/invoice-list/invoice-list.component';
import { InvoiceCreateComponent } from './components/invoice-create/invoice-create.component';
import { InvoiceDetailComponent } from './components/invoice-detail/invoice-detail.component';
import { CreditNoteCreateComponent } from './components/credit-note-create/credit-note-create.component';
import { ResolutionsComponent } from './components/resolutions/resolutions.component';
import { IconComponent } from '../../../../shared/components/icon/icon.component';
import { CurrencyFormatService } from '../../../../shared/pipes/currency';

@Component({
  selector: 'vendix-invoicing',
  standalone: true,
  imports: [
    CommonModule,
    InvoiceStatsComponent,
    InvoiceListComponent,
    InvoiceCreateComponent,
    InvoiceDetailComponent,
    CreditNoteCreateComponent,
    ResolutionsComponent,
    IconComponent,
  ],
  template: `
    <div class="w-full">
      <!-- Stats: Sticky on mobile, static on desktop -->
      <div
        class="stats-container sticky top-0 z-20 bg-background md:static md:bg-transparent"
      >
        <vendix-invoice-stats></vendix-invoice-stats>
      </div>

      <!-- DIAN Config Banner -->
      <div class="mb-4 px-1">
        <button
          (click)="navigateToDianConfig()"
          class="w-full flex items-center justify-between p-3 rounded-lg border border-border bg-white hover:bg-gray-50 transition-colors group"
        >
          <div class="flex items-center gap-3">
            <div class="p-1.5 rounded-md bg-primary/10">
              <app-icon
                name="shield"
                [size]="16"
                class="text-primary"
              ></app-icon>
            </div>
            <div class="text-left">
              <span class="text-sm font-medium text-text-primary"
                >Configuracion DIAN</span
              >
              <p class="text-xs text-text-secondary">Facturacion electronica</p>
            </div>
          </div>
          <app-icon
            name="chevron-right"
            [size]="16"
            class="text-text-secondary group-hover:text-primary transition-colors"
          ></app-icon>
        </button>
      </div>

      <!-- Invoice List -->
      <app-invoice-list
        [invoices]="(invoices$ | async) || []"
        [loading]="(loading$ | async) || false"
        (create)="openCreateModal()"
        (view)="viewInvoice($event)"
        (resolutions)="openResolutionsModal()"
        (refresh)="refreshInvoices()"
      ></app-invoice-list>

      @defer (when isCreateModalOpen) {
        <vendix-invoice-create
          [(isOpen)]="isCreateModalOpen"
        ></vendix-invoice-create>
      }

      @defer (when isDetailModalOpen) {
        <vendix-invoice-detail
          [(isOpen)]="isDetailModalOpen"
          [invoice]="selectedInvoice"
          (creditNote)="openCreditNoteModal($event)"
        ></vendix-invoice-detail>
      }

      @defer (when isCreditNoteModalOpen) {
        <vendix-credit-note-create
          [(isOpen)]="isCreditNoteModalOpen"
          [sourceInvoice]="creditNoteSourceInvoice"
        ></vendix-credit-note-create>
      }

      @defer (when isResolutionsModalOpen) {
        <vendix-resolutions
          [(isOpen)]="isResolutionsModalOpen"
        ></vendix-resolutions>
      }
    </div>
  `,
})
export class InvoicingComponent implements OnInit {
  private currencyService = inject(CurrencyFormatService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);

  invoices$: Observable<Invoice[]>;
  loading$: Observable<boolean>;

  // Modal states
  isCreateModalOpen = false;
  isDetailModalOpen = false;
  isCreditNoteModalOpen = false;
  isResolutionsModalOpen = false;
  selectedInvoice: Invoice | null = null;
  creditNoteSourceInvoice: Invoice | null = null;

  constructor(private store: Store) {
    this.invoices$ = this.store.select(selectInvoices);
    this.loading$ = this.store.select(selectInvoicesLoading);
  }

  ngOnInit(): void {
    this.currencyService.loadCurrency();
    this.store.dispatch(loadInvoices());
    this.store.dispatch(loadInvoiceStats());
    this.store.dispatch(loadResolutions());
  }

  // Modal handlers
  openCreateModal(): void {
    this.isCreateModalOpen = true;
  }

  openResolutionsModal(): void {
    this.isResolutionsModalOpen = true;
  }

  viewInvoice(invoice: Invoice): void {
    this.selectedInvoice = invoice;
    this.isDetailModalOpen = true;
  }

  openCreditNoteModal(invoice: Invoice): void {
    this.creditNoteSourceInvoice = invoice;
    this.isDetailModalOpen = false;
    this.isCreditNoteModalOpen = true;
  }

  refreshInvoices(): void {
    this.store.dispatch(loadInvoices());
    this.store.dispatch(loadInvoiceStats());
  }

  navigateToDianConfig(): void {
    this.router.navigate(['dian-config'], { relativeTo: this.route });
  }
}
