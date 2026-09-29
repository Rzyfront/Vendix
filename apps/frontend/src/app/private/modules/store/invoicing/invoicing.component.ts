import { of } from 'rxjs';
import { catchError, distinctUntilChanged, map, switchMap } from 'rxjs/operators';
import { InvoicingService } from './services/invoicing.service';
import { ToastService } from '../../../../shared/components';
import { extractApiErrorMessage } from '../../../../core/utils/api-error-handler';
import { Component, DestroyRef, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { Store } from '@ngrx/store';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';

import {
  clearDianRejection,
  clearFilters,
  loadInvoices,
  loadInvoiceStats,
  loadResolutions,
  loadDianConfigs,
  setDateRange,
  setPage,
  setSearch,
  setSort,
  setStatusFilter,
  setTypeFilter,
} from './state/actions/invoicing.actions';
import {
  selectInvoices,
  selectInvoicesLoading,
  selectInvoicesMeta,
  selectDianConfigStatus,
  selectDianConfigsLoading,
  selectSearch,
  selectSortBy,
  selectSortOrder,
  selectStatusFilter,
  selectTypeFilter,
  DianConfigGateStatus,
  DianGateReason,
} from './state/selectors/invoicing.selectors';
import { Invoice } from './interfaces/invoice.interface';
import {
  VexiUiHost,
  VexiUiHostRegistry,
  vexiWhenReady,
} from '../../../../core/services/vexi-ui-host.registry';

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
  private readonly route = inject(ActivatedRoute);
  private readonly invoiceApi = inject(InvoicingService);
  private readonly toast = inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);
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

  private readonly vexiHosts = inject(VexiUiHostRegistry);
  private readonly invoiceMeta = toSignal(this.store.select(selectInvoicesMeta), {
    initialValue: null as {
      total: number;
      page: number;
      limit: number;
      totalPages: number;
    } | null,
  });
  private readonly invoiceSearch = toSignal(this.store.select(selectSearch), {
    initialValue: '',
  });
  private readonly invoiceStatusFilter = toSignal(
    this.store.select(selectStatusFilter),
    { initialValue: '' },
  );
  private readonly invoiceTypeFilter = toSignal(
    this.store.select(selectTypeFilter),
    { initialValue: '' },
  );
  private readonly invoiceSortBy = toSignal(this.store.select(selectSortBy), {
    initialValue: '',
  });
  private readonly invoiceSortOrder = toSignal(
    this.store.select(selectSortOrder),
    { initialValue: 'desc' as 'asc' | 'desc' },
  );

  constructor() {
    this.vexiHosts.register(this.vexiHostAdapter);
    this.destroyRef.onDestroy(() =>
      this.vexiHosts.unregister(this.vexiHostAdapter),
    );

    // Limpia cualquier estado stale del modal dejado por otra superficie
    // (p.ej. una factura creada desde el POS) antes de que este contenedor
    // monte su propio host del modal.
    this.fiscalReq.close();
    this.currencyService.loadCurrency();
    this.store.dispatch(loadInvoices());
    this.store.dispatch(loadInvoiceStats());
    this.store.dispatch(loadResolutions());
    this.store.dispatch(loadDianConfigs());
    this.route.queryParamMap.pipe(
      map((params) => Number(params.get('invoiceId'))),
      distinctUntilChanged(),
      switchMap((id) => Number.isSafeInteger(id) && id > 0
        ? this.invoiceApi.getInvoice(id).pipe(catchError((error) => {
            this.toast.error(extractApiErrorMessage(error));
            return of(null);
          }))
        : of(null)),
      takeUntilDestroyed(this.destroyRef),
    ).subscribe((response) => { if (response?.data) this.viewInvoice(response.data); });

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

  // ── Host de Vexi (G8) ─────────────────────────────────────────────────
  //
  // Adapter over the NgRx filter-as-state actions — the same actions the
  // list's own controls dispatch. Invoicing never exposes a mutating action
  // here: issuing and credit-noting pass the DIAN gate and their own capture
  // screens, which the chat must not drive around.
  private readonly vexiHostAdapter: VexiUiHost = {
    vexiModuleKey: 'invoicing',
    readScreen: () => {
      const selected = this.selectedInvoice();
      const meta = this.invoiceMeta();
      const sortBy = this.invoiceSortBy();
      return {
        module_key: 'invoicing',
        title: 'Facturación electrónica',
        visible_count: this.invoices().length,
        selection: selected
          ? `Factura ${selected.invoice_number}${selected.customer_name ? ` de ${selected.customer_name}` : ''}`
          : null,
        filters: {
          search: this.invoiceSearch() || undefined,
          status: this.invoiceStatusFilter() || undefined,
          type: this.invoiceTypeFilter() || undefined,
        },
        page: meta?.page,
        limit: meta?.limit,
        total: meta?.total,
        total_pages: meta?.totalPages,
        sort: sortBy ? `${sortBy}:${this.invoiceSortOrder()}` : undefined,
        open_modal: this.vexiOpenModal(),
        notes: this.loading()
          ? 'La lista todavía está cargando.'
          : `Hay ${meta?.total ?? this.invoices().length} factura(s) en total.`,
      };
    },
    listActions: () => [
      { id: 'nueva_factura', label: 'Ir a la captura de una factura' },
      { id: 'limpiar_filtros', label: 'Quitar todos los filtros de la lista' },
    ],
    runAction: async (id) => {
      switch (id) {
        case 'nueva_factura':
          this.openCreateModal();
          return {
            status: 'needs_user_input' as const,
            message:
              'Abrí la captura de factura. La numeración DIAN y los datos los completa la persona ahí.',
          };
        case 'limpiar_filtros':
          this.store.dispatch(clearFilters());
          return { status: 'ok' as const, message: 'Quité los filtros de la lista.' };
        default:
          return {
            status: 'not_found' as const,
            message: `La pantalla de Facturación no tiene una acción "${id}".`,
          };
      }
    },
    setFilter: async (values) => {
      const applied: string[] = [];
      const ignored: string[] = [];
      let note: string | undefined;

      if (typeof values['search'] === 'string') {
        this.store.dispatch(setSearch({ search: values['search'] }));
        applied.push(`búsqueda "${values['search']}"`);
      }

      if (typeof values['status'] === 'string') {
        this.store.dispatch(setStatusFilter({ statusFilter: values['status'] }));
        applied.push(`estado ${values['status']}`);
      }

      if (typeof values['type'] === 'string') {
        this.store.dispatch(setTypeFilter({ typeFilter: values['type'] }));
        applied.push(`tipo ${values['type']}`);
      }

      if (values['date_from'] !== undefined || values['date_to'] !== undefined) {
        this.store.dispatch(
          setDateRange({
            dateFrom: String(values['date_from'] ?? ''),
            dateTo: String(values['date_to'] ?? ''),
          }),
        );
        applied.push('fechas');
      }

      if (typeof values['sort'] === 'string') {
        const [by, dir] = values['sort'].split(':');
        if (by && (dir === 'asc' || dir === 'desc')) {
          this.store.dispatch(setSort({ sortBy: by, sortOrder: dir }));
          applied.push(`orden ${by} ${dir}`);
        } else {
          ignored.push('sort');
        }
      }

      if (values['limit'] !== undefined) {
        ignored.push('limit');
      }

      if (values['page'] !== undefined) {
        const totalPages = this.invoiceMeta()?.totalPages || 1;
        let page = Math.floor(Number(values['page']));
        if (!Number.isFinite(page)) {
          ignored.push('page');
        } else {
          if (page < 1) page = 1;
          if (page > totalPages) {
            note = `Pediste la página ${page} pero solo hay ${totalPages}; te dejé en la última.`;
            page = totalPages;
          }
          this.store.dispatch(setPage({ page }));
          applied.push(`página ${page}`);
        }
      }

      for (const key of Object.keys(values)) {
        if (
          ![
            'search',
            'status',
            'type',
            'date_from',
            'date_to',
            'sort',
            'limit',
            'page',
          ].includes(key)
        ) {
          ignored.push(key);
        }
      }

      if (!applied.length) {
        return {
          status: 'not_found' as const,
          message:
            'La lista de Facturación filtra por búsqueda, estado, tipo o fechas, y pagina con page. No cambia filas por página.',
        };
      }

      return {
        status: 'ok' as const,
        message:
          `Apliqué ${applied.join(', ')} en facturación. La lista se está recargando; si necesitas el conteo, léelo de la pantalla después.` +
          (note ? ` ${note}` : '') +
          (ignored.length
            ? ` No apliqué ${ignored.join(', ')} porque esta lista no lo soporta.`
            : ''),
        detail: note ? { note } : undefined,
      };
    },
    closeModal: async () => {
      const open = this.vexiOpenModal();
      if (!open) {
        return {
          status: 'not_found' as const,
          message: 'No hay ningún modal abierto en Facturación.',
        };
      }
      this.isDetailModalOpen.set(false);
      this.isCreditNoteModalOpen.set(false);
      this.isNotConfiguredModalOpen.set(false);
      return { status: 'ok' as const, message: `Cerré ${open.title}.` };
    },
    refresh: () => {
      this.refreshInvoices();
      return { status: 'ok' as const, message: 'Recargué las facturas.' };
    },
    whenReady: () => vexiWhenReady(() => this.loading()),
  };

  /** El modal abierto en forma accionable (U-5): `ui_close_modal` cierra este. */
  private vexiOpenModal(): { id: string; title: string } | undefined {
    if (this.isDetailModalOpen())
      return { id: 'detalle_factura', title: 'el detalle de la factura' };
    if (this.isCreditNoteModalOpen())
      return { id: 'nota_credito', title: 'la nota crédito' };
    if (this.isNotConfiguredModalOpen())
      return { id: 'sin_configurar', title: 'el aviso de DIAN sin configurar' };
    return undefined;
  }
}
