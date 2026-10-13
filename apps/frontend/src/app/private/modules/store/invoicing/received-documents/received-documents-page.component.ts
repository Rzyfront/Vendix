import { isPlatformBrowser } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Component, DestroyRef, ElementRef, PLATFORM_ID, computed, effect, inject, signal, untracked, viewChild } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { finalize } from 'rxjs';
import {
  ButtonComponent, CardComponent, EmptyStateComponent, IconComponent, InputsearchComponent,
  OptionsDropdownComponent, PaginationComponent, ResponsiveDataViewComponent, StatsComponent, ToastService,
  type ItemListCardConfig, type TableAction, type TableColumn,
} from '../../../../../shared/components/index';
import type { DropdownAction, FilterConfig, FilterValues } from '../../../../../shared/components/options-dropdown/options-dropdown.interfaces';
import { StoreSettingsFacade } from '../../../../../core/store/store-settings/store-settings.facade';
import { AuthFacade } from '../../../../../core/store/auth/auth.facade';
import { CurrencyFormatService } from '../../../../../shared/pipes/currency';
import { formatDateOnlyUTC, formatStoreDateTime } from '../../../../../shared/utils/date.util';
import { describeApiFailure } from '../utils/invoicing-errors.util';
import { OrgFiscalScopeSelectorComponent } from '../../../organization/shared/components/org-fiscal-scope-selector.component';
import { ReceivedDocumentImportComponent } from './received-document-import.component';
import { ReceivedDocumentFormComponent } from './received-document-form.component';
import type { ReceivedDocument, ReceivedDocumentInboxState, ReceivedDocumentLegalStatus, ReceivedDocumentQuery, ReceivedDocumentType, ReceivedDocumentsScope } from './received-documents.interface';
import { ReceivedDocumentsService } from './received-documents.service';
import { ReceivedDocumentsInboxFacade } from './received-documents-inbox.facade';
import {
  RECEIVED_INBOX_LABELS, RECEIVED_LEGAL_LABELS, RECEIVED_TYPE_LABELS, receivedChannelLabel, receivedInboxEmptyState,
  receivedInboxLabel, receivedLegalLabel, receivedOcrLabel, receivedTypeLabel,
} from './received-documents-inbox-projection.util';

@Component({
  selector: 'app-received-documents-page', standalone: true,
  providers: [ReceivedDocumentsInboxFacade],
  imports: [FormsModule, ButtonComponent, CardComponent, EmptyStateComponent, IconComponent, InputsearchComponent,
    OptionsDropdownComponent, PaginationComponent, ResponsiveDataViewComponent, StatsComponent,
    OrgFiscalScopeSelectorComponent, ReceivedDocumentImportComponent, ReceivedDocumentFormComponent],
  template: `
    <div class="w-full space-y-4">
      @if (scope === 'organization') {
        <app-org-fiscal-scope-selector [selectedStoreId]="storeId() ?? null" [showHeader]="false" (storeChange)="onFiscalStoreChange($event)" />
      }
      <div #statsStrip class="stats-container sticky top-0 z-20 bg-background md:static md:bg-transparent">
        <app-stats title="Nuevas" [value]="summaryValue('new')" smallText="Por revisar" iconName="inbox" iconBgColor="bg-primary/10" iconColor="text-primary" />
        <app-stats title="Requieren revisión" [value]="summaryValue('requires_review')" smallText="Atención pendiente" iconName="alert-circle" iconBgColor="bg-warning/10" iconColor="text-warning" />
        <app-stats title="Aceptadas" [value]="summaryValue('accepted')" smallText="Aceptación legal" iconName="check-circle" iconBgColor="bg-success/10" iconColor="text-success" />
        <app-stats title="Reclamadas" [value]="summaryValue('reclaimed')" smallText="Reclamo de factura" iconName="x-circle" iconBgColor="bg-error/10" iconColor="text-error" />
      </div>
      @if (inbox.summaryError()) {
        <p class="text-sm text-text-secondary" role="status">No se pudo actualizar el resumen. Los contadores no están disponibles; usa Actualizar para reintentar.</p>
      }
      <app-card [responsive]="true" [padding]="false" overflow="visible">
        <div class="sticky z-10 bg-background px-2 py-2 md:static md:bg-transparent md:px-6 md:py-4 md:border-b md:border-border" [style.top.px]="statsOffset()">
          <div class="flex flex-col gap-2 md:flex-row md:items-center md:justify-between md:gap-4">
            <h2 class="text-sm font-semibold text-text-primary md:text-lg">Buzón de facturas</h2>
            <div class="flex w-full min-w-0 flex-wrap items-center gap-2 md:w-auto">
              <app-inputsearch class="min-w-0 flex-1 basis-40 md:w-64" placeholder="Buscar proveedor, NIT o número" ariaLabel="Buscar facturas recibidas" [debounceTime]="300" [ngModel]="searchValue()" (ngModelChange)="searchValue.set($event)" (searchChange)="onSearch($event)" (clear)="onSearch('')" />
              <app-options-dropdown [filters]="filterConfigs" [filterValues]="filterValues()" [actions]="dropdownActions()" [isLoading]="inbox.refreshing()" (filterChange)="onFilterChange($event)" (clearAllFilters)="clearFilters()" (actionClick)="onDropdownAction($event, xmlInput)" />
              <input #xmlInput class="sr-only" type="file" aria-label="Importar XML" accept=".xml,text/xml,application/xml" [disabled]="uploading() || !canImportInCurrentScope()" (change)="onFileSelected($event)" />
            </div>
          </div>
        </div>
        <div class="px-2 pt-3 text-xs text-text-secondary md:px-6" role="status">
          <p>{{ receptionMessage() }}</p>
          <p>Última recepción: {{ formatTimestamp(inbox.health()?.last_received_at) }} · Última actualización: {{ formatTimestamp(inbox.lastUpdatedAt()) }}</p>
          @if (inbox.health()?.next_sync_at) { <p>Próxima consulta del proveedor: {{ formatTimestamp(inbox.health()?.next_sync_at) }}</p> }
          @if (inbox.summary() && !inbox.summaryError()) { <p>{{ inbox.summary()!.total }} facturas en búsqueda, canal y tipo · Corte: {{ formatTimestamp(inbox.summary()!.as_of) }}</p> }
          @if (canConfigure()) { <app-button variant="ghost" size="sm" (clicked)="openConfiguration()">Configurar recepción</app-button> }
        </div>
        @if (inbox.error()) {
          <div role="alert" class="mx-2 mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-error/30 bg-error-light p-3 text-sm text-error md:mx-6">
            <span>{{ inbox.error() }} Los datos anteriores se conservan.</span>
            <app-button variant="outline" size="sm" (clicked)="inbox.refresh()">Reintentar</app-button>
          </div>
        }
        @if (inbox.hasPendingUpdate()) {
          <div class="mx-2 mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border p-3 text-sm text-text-secondary md:mx-6" role="status" aria-live="polite">
            <span>{{ inbox.pendingNewCount() > 0 ? inbox.pendingNewCount() + ' nuevas facturas' : 'Hay una actualización disponible' }}. Tu página y trabajo se conservan.</span>
            <app-button variant="outline" size="sm" (clicked)="inbox.applyPendingUpdate()">Aplicar actualización</app-button>
          </div>
        }
        @if (!canRead()) {
          <p class="p-8 text-center text-sm text-text-secondary" role="status">No tienes permiso para consultar el buzón de facturas.</p>
        } @else if (requiresStoreSelector() && !scopeReady()) {
          <div class="p-8 text-center text-sm text-text-secondary" role="status">Selecciona una tienda fiscal para consultar su buzón de facturas.</div>
        } @else if (inbox.loading() && inbox.rows().length === 0) {
          <div class="p-10 text-center text-sm text-text-secondary" role="status">Cargando facturas…</div>
        } @else if (!inbox.loading() && inbox.rows().length === 0 && !inbox.error()) {
          <app-empty-state icon="inbox" [title]="emptyState().title" [description]="emptyState().description" [showActionButton]="emptyState().configure" actionButtonText="Configurar recepción" actionButtonIcon="settings" (actionClick)="openConfiguration()" [showClearFilters]="emptyState().clearFilters" (clearFiltersClick)="clearFilters()" [showRefreshButton]="true" (refreshClick)="inbox.refresh()" />
        } @else {
          <div class="px-2 pb-2 pt-3 md:p-4" (focusin)="listFocused.set(true)" (focusout)="onListFocusOut($event)">
            <app-responsive-data-view [data]="inbox.rows()" [columns]="columns" [cardConfig]="cardConfig" [actions]="rowActions" [loading]="inbox.loading()" [sortable]="false" rowLabelKey="invoice_number" (rowClick)="openDetail($event)" />
            <app-pagination [currentPage]="page()" [totalPages]="totalPages()" [total]="inbox.total()" [limit]="limit" (pageChange)="onPageChange($event)" />
          </div>
        }
      </app-card>
      <p class="text-xs text-text-secondary">Recepción, revisión, aceptación legal y conciliación son independientes. Leer por OCR no acepta ni contabiliza una factura.</p>
      @if (canImport()) {
        <app-received-document-import [(isOpen)]="scanImportOpen" [scope]="scope" [selectedStoreId]="storeId() ?? null" (completed)="onScanCompleted($event)" />
        <app-received-document-form [(isOpen)]="manualFormOpen" [scope]="scope" [selectedStoreId]="storeId() ?? null" (saved)="onManualSaved($event)" />
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
  private readonly storeSettings = inject(StoreSettingsFacade);
  private readonly browser = isPlatformBrowser(inject(PLATFORM_ID));
  readonly inbox = inject(ReceivedDocumentsInboxFacade);
  readonly scope: ReceivedDocumentsScope = this.readScope(this.route.snapshot.data['receivedDocumentsScope']);
  private readonly routeQueryParams = toSignal(this.route.queryParamMap, { initialValue: this.route.snapshot.queryParamMap });
  readonly requiresStoreSelector = computed(() => this.scope === 'organization' && this.auth.fiscalScope() === 'STORE');
  readonly storeId = computed(() => this.requiresStoreSelector() ? this.readStoreId(this.routeQueryParams().get('store_id')) : undefined);
  readonly storeSelectionReady = signal(this.scope !== 'organization');
  readonly pendingStoreSelection = signal<number | null | undefined>(undefined);
  readonly scopeReady = computed(() => !this.requiresStoreSelector() || (this.storeSelectionReady() && this.storeId() != null && this.pendingStoreSelection() === undefined));
  readonly page = computed(() => this.readStoreId(this.routeQueryParams().get('page')) ?? 1);
  readonly limit = 25;
  readonly search = computed(() => this.routeQueryParams().get('search')?.trim() ?? '');
  readonly searchValue = signal(this.search());
  readonly inboxState = computed(() => this.readChoice(this.routeQueryParams().get('inbox_state'), RECEIVED_INBOX_LABELS) as ReceivedDocumentInboxState | undefined);
  readonly legalStatus = computed(() => this.readChoice(this.routeQueryParams().get('legal_status'), RECEIVED_LEGAL_LABELS) as ReceivedDocumentLegalStatus | undefined);
  readonly sourceChannel = computed(() => this.readChoice(this.routeQueryParams().get('source_channel'), { api: '', automated: '', xml: '', manual: '', email: '' }));
  readonly documentType = computed(() => this.readChoice(this.routeQueryParams().get('document_type'), RECEIVED_TYPE_LABELS) as ReceivedDocumentType | undefined);
  readonly query = computed<ReceivedDocumentQuery>(() => ({ page: this.page(), limit: this.limit, search: this.search() || undefined,
    inbox_state: this.inboxState(), legal_status: this.legalStatus(), source_channel: this.sourceChannel(), document_type: this.documentType(), sort: 'inbox', store_id: this.storeId() }));
  readonly filterValues = computed<FilterValues>(() => ({ inbox_state: this.inboxState() ?? null, legal_status: this.legalStatus() ?? null, source_channel: this.sourceChannel() ?? null, document_type: this.documentType() ?? null }));
  readonly hasFilters = computed(() => !!(this.search() || this.inboxState() || this.legalStatus() || this.sourceChannel() || this.documentType()));
  readonly uploading = signal(false);
  readonly scanImportOpen = signal(false);
  readonly manualFormOpen = signal(false);
  readonly listFocused = signal(false);
  private scanContext = '';
  private manualContext = '';
  private writeContext(): string { return JSON.stringify([this.tenantKey(), this.storeId()]); }
  readonly totalPages = computed(() => Math.max(1, Math.ceil(this.inbox.total() / this.limit)));
  private readonly permissionPrefix = this.scope === 'store' ? 'invoicing:received' : 'organization:invoicing:received';
  readonly tenantKey = computed(() => JSON.stringify([this.auth.userId(), this.auth.userStore()?.id ?? null, this.auth.userOrganization()?.id ?? null]));
  readonly canRead = computed(() => this.auth.userId() !== null && this.auth.hasPermission(`${this.permissionPrefix}:read`));
  readonly canImport = computed(() => this.auth.hasPermission(`${this.permissionPrefix}:import`));
  readonly canImportInCurrentScope = computed(() => this.canImport() && this.scopeReady());
  readonly canConfigure = computed(() => this.inbox.health()?.dian_active === false
    ? this.auth.hasPermission(this.scope === 'store' ? 'invoicing:write' : 'organization:invoicing:dian:write')
    : this.auth.hasPermission(`${this.permissionPrefix}:connections:configure`));
  readonly emptyState = computed(() => receivedInboxEmptyState(this.inbox.healthError() ? null : this.inbox.health(), this.hasFilters(), this.canConfigure()));
  readonly statsStrip = viewChild<ElementRef<HTMLElement>>('statsStrip');
  readonly statsOffset = signal(96);
  private readonly timezone = computed(() => this.storeSettings.settings()?.general?.timezone ?? 'America/Bogota');
  readonly receptionMessage = computed(() => {
    if (this.inbox.healthError()) return 'No se pudo consultar la salud de recepción. El historial sigue disponible.';
    const health = this.inbox.health();
    if (!health) return 'Consultando el estado de recepción…';
    if (health.requires_operational_store) return 'Selecciona una tienda operativa para configurar recepción automática. El historial fiscal sigue disponible.';
    if (health.error_code) return 'La conexión de recepción requiere atención. El historial se conserva; solicita revisión al administrador.';
    if (!health.dian_active) return 'DIAN no activa para recepción automática. El historial y la importación manual siguen disponibles.';
    if (!health.configured) return this.canConfigure() ? 'Sin conexión automática: conecta un proveedor API o webhook compatible.' : 'Sin conexión automática. Solicita configuración al administrador.';
    if (!health.active_connections) return this.canConfigure() ? 'Activa un canal de recepción automática.' : 'Solicita al administrador que active un canal de recepción.';
    return `Recibiendo por ${health.channels.map(receivedChannelLabel).join(' y ') || 'canal configurado'}`;
  });
  readonly filterConfigs: FilterConfig[] = [
    { key: 'inbox_state', label: 'Estado de atención', type: 'select', options: Object.entries(RECEIVED_INBOX_LABELS).map(([value, label]) => ({ value, label })) },
    { key: 'legal_status', label: 'Estado legal', type: 'select', options: Object.entries(RECEIVED_LEGAL_LABELS).map(([value, label]) => ({ value, label })) },
    { key: 'source_channel', label: 'Canal de origen', type: 'select', options: ['api', 'automated', 'xml', 'manual', 'email'].map((value) => ({ value, label: receivedChannelLabel(value) })) },
    { key: 'document_type', label: 'Tipo de documento', type: 'select', options: Object.entries(RECEIVED_TYPE_LABELS).map(([value, label]) => ({ value, label })) },
  ];
  readonly dropdownActions = computed<DropdownAction[]>(() => [
    { label: 'Actualizar buzón', icon: 'refresh-cw', action: 'refresh' },
    ...(this.canImport() ? [
      { label: 'Importar XML', icon: 'upload', action: 'xml', disabled: this.uploading() || !this.canImportInCurrentScope() },
      { label: 'Capturar manualmente', icon: 'plus', action: 'manual', disabled: this.uploading() || !this.canImportInCurrentScope() },
      { label: 'Escanear PDF/foto', icon: 'scan-line', action: 'scan', disabled: this.uploading() || !this.canImportInCurrentScope() },
    ] : []),
  ]);
  readonly inboxBadgeConfig = { type: 'custom' as const, colorMap: {
    new: 'var(--color-info)', requires_review: 'var(--color-warning)', accepted: 'var(--color-success)', reclaimed: 'var(--color-error)',
  } };
  readonly columns: TableColumn[] = [
    { key: 'issuer_name', label: 'Proveedor', priority: 1, transform: (v, row) => `${v || 'Proveedor sin nombre'}${row?.issuer_tax_id ? ` · ${row.issuer_tax_id}` : ''}` },
    { key: 'invoice_number', label: 'Factura', priority: 1 },
    { key: 'document_type', label: 'Tipo', priority: 2, transform: receivedTypeLabel },
    { key: 'arrived_at', label: 'Llegó', priority: 2, transform: (v) => this.formatTimestamp(v) },
    { key: 'issue_date', label: 'Emisión', priority: 3, transform: (v) => this.formatDate(v) },
    { key: 'total_amount', label: 'Total', align: 'right', priority: 1, transform: (_v, row) => this.formatMoney(row) },
    { key: 'inbox_state', label: 'Atención', badge: true, badgeConfig: this.inboxBadgeConfig, priority: 1, transform: receivedInboxLabel, badgeTransform: receivedInboxLabel },
    { key: 'legal_status', label: 'Estado legal', badge: true, priority: 2, transform: receivedLegalLabel, badgeTransform: receivedLegalLabel },
    { key: 'processing_status', label: 'Lectura / OCR', priority: 3, transform: (v) => receivedOcrLabel(String(v)) },
  ];
  readonly cardConfig: ItemListCardConfig = {
    titleKey: 'issuer_name', titleTransform: (row) => row.issuer_name || 'Proveedor sin nombre',
    subtitleKey: 'invoice_number', subtitleTransform: (row) => `${row.invoice_number || 'Sin número'} · ${receivedTypeLabel(row.document_type)}`,
    badgeKey: 'inbox_state', badgeConfig: this.inboxBadgeConfig, badgeTransform: receivedInboxLabel,
    detailKeys: [
      { key: 'arrived_at', label: 'Llegó', transform: (v) => this.formatTimestamp(v) },
      { key: 'issue_date', label: 'Emisión', transform: (v) => this.formatDate(v) },
      { key: 'legal_status', label: 'Legal', transform: receivedLegalLabel },
      { key: 'processing_status', label: 'Lectura / OCR', transform: (v) => receivedOcrLabel(String(v)) },
    ],
    footerKey: 'total_amount', footerLabel: 'Total', footerTransform: (_v, row) => this.formatMoney(row), footerStyle: 'prominent',
  };
  readonly rowActions: TableAction[] = [{ label: 'Ver / revisar factura', icon: 'eye', variant: 'ghost', action: (row: ReceivedDocument) => this.openDetail(row) }];

  constructor() {
    let previousTenant = this.writeContext();
    effect(() => {
      const tenantKey = this.writeContext();
      if (tenantKey !== previousTenant) {
        previousTenant = tenantKey;
        untracked(() => { this.scanImportOpen.set(false); this.manualFormOpen.set(false); this.listFocused.set(false); });
      }
    });
    effect(() => {
      const currentStoreId = this.storeId();
      untracked(() => {
        const pending = this.pendingStoreSelection();
        if (pending !== undefined && (pending === currentStoreId || (pending === null && currentStoreId === undefined))) {
          this.pendingStoreSelection.set(undefined);
          this.storeSelectionReady.set(true);
        }
      });
    });
    effect(() => {
      const query = this.query();
      const ready = this.scopeReady() && this.canRead();
      const tenantKey = this.tenantKey();
      untracked(() => { this.searchValue.set(query.search ?? ''); this.inbox.setContext(this.scope, query, ready, tenantKey); });
    });
    effect(() => {
      const protectedWork = this.uploading() || this.scanImportOpen() || this.manualFormOpen() || this.listFocused();
      untracked(() => this.inbox.setProtected(protectedWork));
    });
    effect((onCleanup) => {
      const element = this.statsStrip()?.nativeElement;
      if (!element || !this.browser || typeof ResizeObserver === 'undefined') return;
      const observer = new ResizeObserver(([entry]) => this.statsOffset.set(Math.ceil(entry.contentRect.height)));
      observer.observe(element);
      onCleanup(() => observer.disconnect());
    });
  }
  summaryValue(key: ReceivedDocumentInboxState): number | string {
    return this.inbox.summaryError() ? '—' : this.inbox.summary()?.[key] ?? '—';
  }
  onSearch(value: string): void {
    if (value !== this.searchValue()) return;
    this.navigateQuery({ search: value.trim() || null, page: 1 });
  }
  onFilterChange(values: FilterValues): void {
    const queryParams: Record<string, string | number | null> = { page: 1 };
    for (const key of ['inbox_state', 'legal_status', 'source_channel', 'document_type']) {
      queryParams[key] = typeof values[key] === 'string' ? values[key] : null;
    }
    this.navigateQuery(queryParams);
  }
  clearFilters(): void {
    this.searchValue.set('');
    this.navigateQuery({ search: null, inbox_state: null, legal_status: null, source_channel: null, document_type: null, page: 1 });
  }
  onPageChange(page: number): void {
    if (!Number.isInteger(page) || page < 1 || page > this.totalPages()) return;
    this.navigateQuery({ page });
  }
  private navigateQuery(queryParams: Record<string, string | number | null>): void {
    void this.router.navigate([], { relativeTo: this.route, queryParams, queryParamsHandling: 'merge', replaceUrl: true });
  }
  onFiscalStoreChange(storeId: number | null): void {
    this.storeSelectionReady.set(true);
    if (!this.requiresStoreSelector()) {
      if (this.routeQueryParams().has('store_id')) this.navigateQuery({ store_id: null, page: 1 });
      return;
    }
    if (storeId === (this.storeId() ?? null)) return;
    this.pendingStoreSelection.set(storeId);
    this.storeSelectionReady.set(false);
    this.inbox.setContext(this.scope, this.query(), false, this.tenantKey());
    this.navigateQuery({ store_id: storeId || null, page: 1 });
  }
  onListFocusOut(event: FocusEvent): void {
    const container = event.currentTarget as HTMLElement;
    this.listFocused.set(!!event.relatedTarget && container.contains(event.relatedTarget as Node));
  }
  onDropdownAction(action: string, input: HTMLInputElement): void {
    if (action === 'refresh') { this.inbox.refresh(); return; }
    if (!this.canImportInCurrentScope() || this.uploading()) return;
    if (action === 'manual') { this.manualContext = this.writeContext(); this.manualFormOpen.set(true); }
    if (action === 'scan') { this.scanContext = this.writeContext(); this.scanImportOpen.set(true); }
    if (action === 'xml') input.click();
  }
  openConfiguration(): void {
    if (!this.canConfigure()) return;
    void this.router.navigate(['/admin/invoicing/dian-config'], { queryParams: this.storeId() ? { store_id: this.storeId() } : undefined });
  }
  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (!this.canImportInCurrentScope()) { input.value = ''; return; }
    const file = input.files?.[0];
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.xml') || file.size > 10 * 1024 * 1024) {
      this.toast.error('Selecciona un archivo XML de hasta 10 MB.'); input.value = ''; return;
    }
    const scope = this.scope;
    const storeId = this.storeId();
    const tenantKey = this.tenantKey();
    this.uploading.set(true);
    this.service.importXml(scope, file, storeId).pipe(takeUntilDestroyed(this.destroyRef), finalize(() => { this.uploading.set(false); input.value = ''; })).subscribe({
      next: () => {
        if (storeId !== this.storeId() || tenantKey !== this.tenantKey()) return;
        this.toast.success('XML importado. El documento quedó disponible para revisión.'); this.inbox.refreshAfterMutation();
      },
      error: (err: unknown) => { if (storeId === this.storeId() && tenantKey === this.tenantKey()) this.toast.error(describeApiFailure(err).message || 'No se pudo importar el XML.'); },
    });
  }
  openDetail(row: ReceivedDocument): void {
    if (!row?.id) return;
    this.openDocumentDetail(row.id);
  }
  private openDocumentDetail(id: number): void {
    void this.router.navigate(['/admin/invoicing/received-documents', id], { queryParams: this.route.snapshot.queryParams });
  }
  onScanCompleted(documentId: number): void {
    if (this.scanContext !== this.writeContext()) return;
    if (!Number.isSafeInteger(documentId) || documentId <= 0) return;
    this.toast.success('Documento leído; requiere revisión.');
    this.inbox.refreshAfterMutation();
    this.openDocumentDetail(documentId);
  }
  onManualSaved(documentId: number): void {
    if (this.manualContext !== this.writeContext()) return;
    if (!Number.isSafeInteger(documentId) || documentId <= 0) return;
    this.toast.success('Documento guardado para revisión. No fue aceptado ni contabilizado.');
    this.inbox.refreshAfterMutation();
    this.openDocumentDetail(documentId);
  }
  formatDate(value: unknown): string {
    if (!value) return 'Sin fecha';
    const date = new Date(String(value));
    return Number.isFinite(date.getTime()) ? formatDateOnlyUTC(date) : 'Fecha inválida';
  }
  formatTimestamp(value: unknown): string {
    return value ? formatStoreDateTime(String(value), this.timezone()) || 'Fecha inválida' : 'Sin registro';
  }
  formatMoney(row: ReceivedDocument): string {
    const amount = row?.total_amount;
    if (amount == null || amount === '') return '—';
    const currency = row.currency?.toUpperCase();
    if (!currency || !/^[A-Z]{3}$/.test(currency)) return `${amount} · moneda desconocida`;
    if (this.currency.currencyCode().toUpperCase() === currency) return this.currency.format(amount);
    return `${amount} ${currency}`;
  }
  private readScope(value: unknown): ReceivedDocumentsScope {
    if (value === 'store' || value === 'organization') return value;
    throw new Error('La ruta debe declarar data.receivedDocumentsScope como store u organization.');
  }
  private readStoreId(value: string | null): number | undefined {
    const id = Number(value); return Number.isSafeInteger(id) && id > 0 ? id : undefined;
  }
  private readChoice(value: string | null, choices: Readonly<Record<string, string>>): string | undefined {
    return value && Object.hasOwn(choices, value) ? value : undefined;
  }
}
