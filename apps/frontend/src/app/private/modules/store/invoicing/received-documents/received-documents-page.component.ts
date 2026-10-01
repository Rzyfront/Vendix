import { Component, DestroyRef, computed, effect, inject, signal, untracked } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { finalize, Subscription } from 'rxjs';
import {
  CardComponent,
  EmptyStateComponent,
  IconComponent,
  InputsearchComponent,
  PaginationComponent,
  ResponsiveDataViewComponent,
  ToastService,
  type ItemListCardConfig,
  type TableAction,
  type TableColumn,
} from '../../../../../shared/components/index';
import { AuthFacade } from '../../../../../core/store/auth/auth.facade';
import { CurrencyFormatService } from '../../../../../shared/pipes/currency';
import { formatDateOnlyUTC } from '../../../../../shared/utils/date.util';
import { describeApiFailure } from '../utils/invoicing-errors.util';
import { OrgFiscalScopeSelectorComponent } from '../../../organization/shared/components/org-fiscal-scope-selector.component';
import { ReceivedDocumentImportComponent } from './received-document-import.component';
import { ReceivedDocumentFormComponent } from './received-document-form.component';
import { DocumentReceptionConnectionsComponent } from './document-reception-connections.component';
import type { ReceivedDocument, ReceivedDocumentQuery, ReceivedDocumentsScope } from './received-documents.interface';
import { ReceivedDocumentsService } from './received-documents.service';

const STATUS_FILTERS = [
  { value: '', label: 'Todos los estados' },
  { value: 'pending', label: 'Validación pendiente' },
  { value: 'valid', label: 'Validación correcta' },
  { value: 'needs_review', label: 'Requieren revisión' },
  { value: 'invalid', label: 'Con inconsistencias' },
];

@Component({
  selector: 'app-received-documents-page',
  standalone: true,
  imports: [CardComponent, EmptyStateComponent, IconComponent, InputsearchComponent, PaginationComponent, ResponsiveDataViewComponent, OrgFiscalScopeSelectorComponent, ReceivedDocumentImportComponent, ReceivedDocumentFormComponent, DocumentReceptionConnectionsComponent],
  template: `
    <div class="w-full space-y-4">
      @if (scope === 'organization') {
        <app-org-fiscal-scope-selector
          [selectedStoreId]="storeId() ?? null"
          [showHeader]="false"
          (storeChange)="onFiscalStoreChange($event)"
        />
      }
      <app-card [responsive]="true" [padding]="false">
        <div class="flex flex-col gap-3 border-b border-border p-3 md:flex-row md:items-center md:justify-between md:p-4">
          <div class="min-w-0">
            <h2 class="text-base font-semibold text-text-primary">Bandeja de proveedores</h2>
            <p class="text-sm text-text-secondary">{{ total() }} documentos en el alcance actual</p>
          </div>
          <div class="flex flex-col gap-2 sm:flex-row sm:items-center">
            <app-inputsearch class="min-w-[220px]" placeholder="Buscar proveedor, NIT o número" [debounceTime]="300" (searchChange)="onSearch($event)" />
            <label class="sr-only" for="received-status">Filtrar por estado</label>
            <select id="received-status" class="rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text-primary" [value]="status()" (change)="onStatusChange($event)">
              @for (option of statusFilters; track option.value) { <option [value]="option.value">{{ option.label }}</option> }
            </select>
            @if (canConfigureConnections()) {
              <button type="button" class="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-border px-3 py-2 text-sm font-medium text-text-primary hover:bg-surface" (click)="connectionsOpen.set(true)">
                <app-icon name="settings" [size]="16" /> Conexiones
              </button>
            }
            @if (canImport()) {
              <button type="button" class="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-primary px-3 py-2 text-sm font-medium text-primary hover:bg-primary/5 disabled:cursor-not-allowed disabled:opacity-50" [disabled]="uploading() || !canImportInCurrentScope()" (click)="manualFormOpen.set(true)">
                <app-icon name="plus" [size]="16" /> Capturar manualmente
              </button>
              <label class="inline-flex cursor-pointer items-center justify-center gap-2 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-white hover:opacity-90" [class.opacity-60]="!canImportInCurrentScope()" [class.pointer-events-none]="!canImportInCurrentScope()" [attr.aria-disabled]="!canImportInCurrentScope()">
                <app-icon name="upload" [size]="16" />
                {{ uploading() ? 'Importando…' : 'Importar XML' }}
                <input class="sr-only" type="file" accept=".xml,text/xml,application/xml" [disabled]="uploading() || !canImportInCurrentScope()" (change)="onFileSelected($event)" />
              </label>
              <button type="button" class="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-primary px-3 py-2 text-sm font-medium text-primary hover:bg-primary/5 disabled:cursor-not-allowed disabled:opacity-50" [disabled]="uploading() || !canImportInCurrentScope()" (click)="scanImportOpen.set(true)">
                <app-icon name="scan-line" [size]="16" />
                Escanear PDF/foto
              </button>
            }
          </div>
        </div>

        @if (error()) {
          <div role="alert" class="m-3 flex items-center justify-between gap-3 rounded-lg border border-error/30 bg-error-light p-3 text-sm text-error md:m-4">
            <span>{{ error() }}</span><button type="button" class="rounded-md border border-error/30 px-3 py-1.5 font-medium" (click)="load()">Reintentar</button>
          </div>
        }
        @if (requiresStoreSelector() && !scopeReady()) {
          <div class="p-8 text-center text-sm text-text-secondary" role="status">Selecciona una tienda fiscal para consultar sus documentos recibidos.</div>
        } @else if (loading() && rows().length === 0) {
          <div class="p-10 text-center text-sm text-text-secondary" role="status">Cargando documentos…</div>
        } @else if (!loading() && rows().length === 0 && !error()) {
          <app-empty-state icon="inbox" title="No hay documentos recibidos" description="Importa un XML o captura manualmente un documento de proveedor para iniciar la revisión." [showActionButton]="false" />
        } @else {
          <div class="p-2 md:p-4">
            <app-responsive-data-view [data]="rows()" [columns]="columns" [cardConfig]="cardConfig" [actions]="rowActions" [loading]="loading()" [rowLabelKey]="'invoice_number'" (rowClick)="openDetail($event)" />
          </div>
          <app-pagination [currentPage]="page()" [totalPages]="totalPages()" [total]="total()" [limit]="limit()" (pageChange)="onPageChange($event)" />
        }
      </app-card>
      <p class="px-1 text-xs text-text-secondary">Los estados fiscales, de revisión, coincidencia y contabilización son independientes. “Listo” no significa aceptado por la DIAN.</p>
      @if (canImport()) {
        <app-received-document-import
          [(isOpen)]="scanImportOpen"
          [scope]="scope"
          [selectedStoreId]="storeId() ?? null"
          (completed)="onScanCompleted($event)"
        />
        <app-received-document-form
          [(isOpen)]="manualFormOpen"
          [scope]="scope"
          [selectedStoreId]="storeId() ?? null"
          (saved)="onManualSaved($event)"
        />
      }
      @if (canConfigureConnections()) {
        <app-document-reception-connections
          [(isOpen)]="connectionsOpen"
          [scope]="scope"
          [selectedStoreId]="storeId() ?? null"
          (syncCompleted)="load()"
        />
      }
    </div>
  `,
})
export class ReceivedDocumentsPageComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  private readonly service = inject(ReceivedDocumentsService);
  private readonly toast = inject(ToastService);
  private readonly auth = inject(AuthFacade);
  private readonly currency = inject(CurrencyFormatService);
  readonly statusFilters = STATUS_FILTERS;
  readonly scope: ReceivedDocumentsScope = this.readScope(this.route.snapshot.data['receivedDocumentsScope']);
  private readonly routeQueryParams = toSignal(this.route.queryParamMap, { initialValue: this.route.snapshot.queryParamMap });
  readonly requiresStoreSelector = computed(() => this.scope === 'organization' && this.auth.fiscalScope() === 'STORE');
  readonly storeId = computed(() => this.requiresStoreSelector() ? this.readStoreId(this.routeQueryParams().get('store_id')) : undefined);
  readonly rows = signal<ReceivedDocument[]>([]);
  readonly total = signal(0);
  readonly page = signal(1);
  readonly limit = signal(25);
  readonly search = signal('');
  readonly status = signal('');
  readonly loading = signal(false);
  readonly uploading = signal(false);
  readonly scanImportOpen = signal(false);
  readonly manualFormOpen = signal(false);
  readonly connectionsOpen = signal(false);
  readonly error = signal<string | null>(null);
  readonly canImport = computed(() => this.auth.hasPermission(`${this.scope === 'store' ? 'invoicing' : 'organization:invoicing'}:received:import`));
  readonly canConfigureConnections = computed(() => this.auth.hasPermission(`${this.scope === 'store' ? 'invoicing' : 'organization:invoicing'}:received:connections:configure`));
  readonly storeSelectionReady = signal(this.scope !== 'organization');
  readonly pendingStoreSelection = signal<number | null | undefined>(undefined);
  readonly scopeReady = computed(() => !this.requiresStoreSelector() || (this.storeSelectionReady() && this.storeId() != null && this.pendingStoreSelection() === undefined));
  readonly canImportInCurrentScope = computed(() => this.canImport() && this.scopeReady());
  readonly totalPages = computed(() => Math.max(1, Math.ceil(this.total() / this.limit())));

  readonly columns: TableColumn[] = [
    { key: 'issuer_name', label: 'Proveedor', priority: 1, transform: (v, row) => `${v || 'Proveedor sin nombre'}${row?.issuer_tax_id ? ` · ${row.issuer_tax_id}` : ''}` },
    { key: 'invoice_number', label: 'Número', priority: 1 },
    { key: 'issue_date', label: 'Fecha emisión', priority: 2, transform: (v) => this.formatDate(v) },
    { key: 'total_amount', label: 'Total', align: 'right', priority: 1, transform: (_v, row) => this.formatMoney(row) },
    { key: 'validation_status', label: 'Validación', badge: true, priority: 2, badgeTransform: (v) => this.label(v) },
    { key: 'review_status', label: 'Revisión', badge: true, priority: 3, badgeTransform: (v) => this.label(v) },
  ];
  readonly cardConfig: ItemListCardConfig = {
    titleKey: 'issuer_name', titleTransform: (row) => row.issuer_name || 'Proveedor sin nombre',
    subtitleKey: 'invoice_number', subtitleTransform: (row) => `${row.invoice_number || 'Sin número'} · ${this.formatDate(row.issue_date)}`,
    badgeKey: 'processing_status', badgeTransform: (v) => this.label(v),
    detailKeys: [
      { key: 'validation_status', label: 'Validación', transform: (v) => this.label(v) },
      { key: 'review_status', label: 'Revisión', transform: (v) => this.label(v) },
      { key: 'matching_status', label: 'Coincidencia', transform: (v) => this.label(v) },
    ],
    footerKey: 'total_amount', footerLabel: 'Total', footerTransform: (_v, row) => this.formatMoney(row), footerStyle: 'prominent',
  };
  readonly rowActions: TableAction[] = [{ label: 'Ver documento', icon: 'eye', variant: 'ghost', action: (row: ReceivedDocument) => this.openDetail(row) }];
  private activeRequest?: Subscription;
  private requestSequence = 0;
  constructor() {
    if (!this.route.snapshot.data['receivedDocumentsScope']) {
      this.error.set('No se pudo determinar el alcance fiscal de esta bandeja.');
      return;
    }
    effect(() => {
      const currentStoreId = this.storeId();
      untracked(() => {
        const pendingStoreId = this.pendingStoreSelection();
        if (pendingStoreId !== undefined && (pendingStoreId === currentStoreId || (pendingStoreId === null && currentStoreId === undefined))) {
          this.pendingStoreSelection.set(undefined);
          this.storeSelectionReady.set(true);
        }
        this.page.set(1);
        this.rows.set([]);
        this.total.set(0);
        this.load();
      });
    });
  }

  load(): void {
    const requestSequence = ++this.requestSequence;
    this.activeRequest?.unsubscribe();
    if (!this.scopeReady()) {
      this.rows.set([]);
      this.total.set(0);
      this.error.set(null);
      this.loading.set(false);
      return;
    }
    this.loading.set(true);
    this.error.set(null);
    const query: ReceivedDocumentQuery = { page: this.page(), limit: this.limit(), search: this.search() || undefined };
    if (this.status()) query.validation_status = this.status();
    if (this.scope === 'organization' && this.storeId()) query.store_id = this.storeId();
    this.activeRequest = this.service.list(this.scope, query).pipe(takeUntilDestroyed(this.destroyRef), finalize(() => {
      if (requestSequence === this.requestSequence) this.loading.set(false);
    })).subscribe({
      next: (response) => { this.rows.set(response.data ?? []); this.total.set(response.meta?.total ?? 0); },
      error: (err: unknown) => { this.rows.set([]); this.total.set(0); this.error.set(describeApiFailure(err).message || 'No se pudieron cargar los documentos.'); },
    });
  }

  onSearch(value: string): void { this.search.set(value.trim()); this.page.set(1); this.load(); }
  onStatusChange(event: Event): void { this.status.set((event.target as HTMLSelectElement).value); this.page.set(1); this.load(); }
  onPageChange(page: number): void { this.page.set(page); this.load(); }

  onFiscalStoreChange(storeId: number | null): void {
    const wasReadyForCurrentStore = this.scopeReady();
    this.storeSelectionReady.set(true);
    if (!this.requiresStoreSelector()) {
      if (this.routeQueryParams().has('store_id')) {
        void this.router.navigate([], {
          relativeTo: this.route,
          queryParams: { store_id: null, page: 1 },
          queryParamsHandling: 'merge',
        });
      }
      return;
    }
    if (storeId === (this.storeId() ?? null)) {
      if (!wasReadyForCurrentStore && storeId !== null && this.pendingStoreSelection() === undefined) {
        this.pendingStoreSelection.set(undefined);
        this.load();
      }
      return;
    }
    this.pendingStoreSelection.set(storeId);
    this.storeSelectionReady.set(false);
    this.rows.set([]);
    this.total.set(0);
    this.activeRequest?.unsubscribe();
    this.requestSequence++;
    this.loading.set(false);
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { store_id: storeId || null, page: 1 },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (!this.canImportInCurrentScope()) { input.value = ''; return; }
    const file = input.files?.[0];
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.xml') || file.size > 10 * 1024 * 1024) {
      this.toast.error('Selecciona un archivo XML de hasta 10 MB.'); input.value = ''; return;
    }
    this.uploading.set(true);
    this.service.importXml(this.scope, file, this.storeId()).pipe(takeUntilDestroyed(this.destroyRef), finalize(() => { this.uploading.set(false); input.value = ''; })).subscribe({
      next: () => { this.toast.success('XML importado. El documento quedó disponible para revisión.'); this.page.set(1); this.load(); },
      error: (err: unknown) => this.toast.error(describeApiFailure(err).message || 'No se pudo importar el XML.'),
    });
  }

  openDetail(row: ReceivedDocument): void {
    if (!row?.id) return;
    const queryParams = this.requiresStoreSelector() && this.storeId() ? { store_id: this.storeId() } : undefined;
    void this.router.navigate(['/admin/invoicing/received-documents', row.id], { queryParams });
  }

  onScanCompleted(documentId: number): void {
    if (!Number.isSafeInteger(documentId) || documentId <= 0) return;
    this.toast.success('Documento leído; requiere revisión.');
    this.page.set(1);
    this.load();
    const queryParams = this.requiresStoreSelector() && this.storeId() ? { store_id: this.storeId() } : undefined;
    void this.router.navigate(['/admin/invoicing/received-documents', documentId], { queryParams });
  }

  onManualSaved(documentId: number): void {
    if (!Number.isSafeInteger(documentId) || documentId <= 0) return;
    this.toast.success('Documento guardado para revisión. No fue aceptado ni contabilizado.');
    this.page.set(1);
    this.load();
    const queryParams = this.requiresStoreSelector() && this.storeId() ? { store_id: this.storeId() } : undefined;
    void this.router.navigate(['/admin/invoicing/received-documents', documentId], { queryParams });
  }

  formatDate(value: string | null | undefined): string {
    if (!value) return 'Sin fecha';
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return 'Fecha inválida';
    return formatDateOnlyUTC(date);
  }
  formatMoney(row: ReceivedDocument): string {
    const amount = row?.total_amount;
    if (amount == null || amount === '') return '—';
    const currency = row.currency?.toUpperCase();
    if (!currency || !/^[A-Z]{3}$/.test(currency)) return `${amount} · moneda desconocida`;
    if (this.currency.currencyCode().toUpperCase() === currency) return this.currency.format(amount);
    return `${amount} ${currency}`;
  }
  label(value: unknown): string { return String(value ?? 'pendiente').replaceAll('_', ' '); }
  private readScope(value: unknown): ReceivedDocumentsScope {
    if (value === 'store' || value === 'organization') return value;
    throw new Error('La ruta debe declarar data.receivedDocumentsScope como store u organization.');
  }
  private readStoreId(value: string | null): number | undefined { const id = Number(value); return Number.isInteger(id) && id > 0 ? id : undefined; }
}
