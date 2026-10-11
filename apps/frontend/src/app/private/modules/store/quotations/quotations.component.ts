import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Observable } from 'rxjs';
import { StatsComponent } from '../../../../shared/components/stats/stats.component';
import { ToastService } from '../../../../shared/components/toast/toast.service';
import { DialogService } from '../../../../shared/components/dialog/dialog.service';
import { extractApiErrorMessage } from '../../../../core/utils/api-error-handler';
import { QuotationsService } from './services/quotations.service';
import { QuotationListComponent } from './components/quotation-list/quotation-list.component';
import { QuotationFormModalComponent } from './components/quotation-form-modal/quotation-form-modal.component';
import { AuthFacade } from '../../../../core/store/auth/auth.facade';
import { CreateQuotationDto, QuotationDestination, QuotationFormSaveDto } from './interfaces/quotation.interface';
import { ContractsService } from '../contracts/services/contracts.service';
import { CurrencyFormatService } from '../../../../shared/pipes/currency/currency.pipe';
import {
  Quotation,
  QuotationStats,
  QuotationQuery,
  QuotationStatus,
} from './interfaces/quotation.interface';
import { FilterValues } from '../../../../shared/components/options-dropdown/options-dropdown.interfaces';

@Component({
  selector: 'app-quotations',
  standalone: true,
  imports: [
    StatsComponent,
    QuotationListComponent,
    QuotationFormModalComponent,
  ],
  template: `
    <div class="w-full [&_button]:min-h-11 [&_button]:min-w-11 [&_input]:!text-base [&_select]:!text-base [&_select]:!min-h-11 [&_.inputsearch-wrapper]:!min-h-11">
      <!-- Stats: Sticky on mobile, static on desktop -->
      <div
        class="stats-container sticky top-0 z-20 bg-background md:static md:bg-transparent"
      >
        <app-stats
          title="Total Cotizaciones"
          [value]="stats().total"
          smallText="Cotizaciones creadas"
          iconName="file-text"
          iconBgColor="bg-blue-100"
          iconColor="text-blue-500"
          [loading]="statsLoading()"
        ></app-stats>
        <app-stats
          title="Pendientes"
          [value]="stats().pending"
          smallText="Por responder"
          iconName="clock"
          iconBgColor="bg-amber-100"
          iconColor="text-amber-500"
          [loading]="statsLoading()"
        ></app-stats>
        <app-stats
          title="Tasa Conversión"
          [value]="stats().conversion_rate + '%'"
          smallText="Convertidas a orden"
          iconName="trending-up"
          iconBgColor="bg-emerald-100"
          iconColor="text-emerald-500"
          [loading]="statsLoading()"
        ></app-stats>
        <app-stats
          title="Valor Promedio"
          [value]="currencyService.formatCompact(stats().average_value)"
          smallText="Promedio por cotización"
          iconName="dollar-sign"
          iconBgColor="bg-purple-100"
          iconColor="text-purple-500"
          [loading]="statsLoading()"
        ></app-stats>
      </div>

      <!-- List Component (contains search + data view) -->
      <app-quotation-list
        [quotations]="quotations()"
        [loading]="loading()"
        [loadError]="loadError()"
        [showContractAction]="canCreateContractQuotation()"
        [canCreateQuotation]="canCreateQuotation()"
        [canReadProfiles]="canReadQuotationProfiles()"
        [canCreateFromQuotation]="canCreateContractFromQuotation()"
        [canConvertToOrder]="canConvertToOrder()"
        [canMutateQuotation]="canUpdateQuotation()"
        [canUpdateContractQuotation]="canUpdateContractQuotation()"
        [canDeleteQuotation]="canDeleteQuotation()"
        [paginationData]="paginationData()"
        [searchTerm]="searchTerm()"
        [filterValues]="filterValues()"
        (viewDetail)="onViewDetail($event)"
        (send)="onSend($event)"
        (accept)="onAccept($event)"
        (reject)="onReject($event)"
        (cancel)="onCancel($event)"
        (convert)="onConvert($event)"
        (duplicate)="onDuplicate($event)"
        (deleteQuotation)="onDelete($event)"
        (edit)="onEdit($event)"
        (create)="navigateToQuotationMode()"
        (createContract)="openQuotationModal('contract')"
        (createFromQuotation)="createContractFromAccepted($event)"
        (manageProfiles)="navigateToQuotationProfiles()"
        (search)="onSearch($event)"
        (filterChange)="onFilterChange($event)"
        (clearAllFilters)="clearFilters()"
        (pageChange)="onPageChange($event)"
        (refresh)="loadQuotations()"
      ></app-quotation-list>

      @if (quotationModalOpen()) {
        <app-quotation-form-modal
          [quotation]="selectedQuotation()"
          [initialDestination]="initialDestination()"
          [saving]="savingQuotation()"
          (save)="saveQuotation($event)"
          (close)="closeQuotationModal()"
        ></app-quotation-form-modal>
      }


    </div>
  `,
})
export class QuotationsComponent {
  private quotationsService = inject(QuotationsService);
  private router = inject(Router);
  private toastService = inject(ToastService);
  private dialogService = inject(DialogService);
  private destroyRef = inject(DestroyRef);
  private route = inject(ActivatedRoute);
  private authFacade = inject(AuthFacade);
  private contractsService = inject(ContractsService);
  readonly currencyService = inject(CurrencyFormatService);

  stats = signal<QuotationStats>({
    total: 0, pending: 0, conversion_rate: 0, average_value: 0,
    draft: 0, sent: 0, accepted: 0, converted: 0,
  });
  quotations = signal<Quotation[]>([]);
  loading = signal(false);
  readonly loadError = signal('');
  statsLoading = signal(false);
  quotationModalOpen = signal(false);
  selectedQuotation = signal<Quotation | null>(null);
  initialDestination = signal<QuotationDestination>('sale');
  savingQuotation = signal(false);
  private readonly contractCreationLocks = new Set<number>();
  private quotationRequestId = 0;
  readonly canCreateContractQuotation = computed(() =>
    this.authFacade.storeIndustries().includes('construction') &&
    (this.isSuperAdmin() || (this.authFacade.userPermissions().includes('store:quotations:create') &&
    this.authFacade.userPermissions().includes('store:contracts:create'))),
  );
  readonly canCreateQuotation = computed(() =>
    this.authFacade.userPermissions().includes('store:quotations:create') || this.isSuperAdmin(),
  );
  readonly canCreateContractFromQuotation = computed(() =>
    this.authFacade.storeIndustries().includes('construction') &&
    (this.authFacade.userPermissions().includes('store:contracts:create') || this.isSuperAdmin()),
  );
  readonly canUpdateContractQuotation = computed(() =>
    this.authFacade.storeIndustries().includes('construction') &&
    (this.authFacade.userPermissions().includes('store:quotations:update') &&
    this.authFacade.userPermissions().includes('store:quotations:read:one') || this.isSuperAdmin()),
  );
  readonly canConvertToOrder = computed(() =>
    this.authFacade.userPermissions().includes('store:quotations:convert') || this.isSuperAdmin(),
  );
  readonly canUpdateQuotation = computed(() =>
    this.authFacade.userPermissions().includes('store:quotations:update') || this.isSuperAdmin(),
  );
  readonly canDeleteQuotation = computed(() =>
    this.authFacade.userPermissions().includes('store:quotations:delete') || this.isSuperAdmin(),
  );
  readonly canReadQuotationProfiles = computed(() =>
    this.authFacade.userPermissions().includes('store:quotations:read') || this.isSuperAdmin(),
  );

  private isSuperAdmin(): boolean {
    const roles = this.authFacade.userRoles();
    return roles.includes('super_admin') || roles.includes('SUPER_ADMIN');
  }

  readonly searchTerm = signal('');
  readonly filterValues = signal<FilterValues>({ status: '' });
  readonly statusFilter = computed<QuotationStatus | undefined>(() => {
    const status = this.filterValues()['status'];
    return status ? status as QuotationStatus : undefined;
  });
  readonly filters = signal({ page: 1, limit: 50 });
  readonly page = computed(() => this.filters().page);
  readonly limit = computed(() => this.filters().limit);
  readonly totalItems = signal(0);
  readonly totalPages = computed(() => Math.ceil(this.totalItems() / this.limit()));
  readonly paginationData = computed(() => ({
    page: this.page(), limit: this.limit(), total: this.totalItems(), totalPages: this.totalPages(),
  }));

  constructor() {
    this.loadStats();
    this.loadQuotations();
    this.route.queryParamMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((params) => {
      if (params.get('destination') !== 'contract' || !this.canCreateContractQuotation()) return;
      this.openQuotationModal('contract');
      void this.router.navigate([], {
        relativeTo: this.route,
        queryParams: { destination: null },
        queryParamsHandling: 'merge',
        replaceUrl: true,
      });
    });
  }

  loadStats(): void {
    this.statsLoading.set(true);
    this.quotationsService.getQuotationStats()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (s) => { this.stats.set(s); this.statsLoading.set(false); },
        error: () => { this.toastService.error('Error al cargar estadísticas'); this.statsLoading.set(false); },
      });
  }

  loadQuotations(): void {
    const requestId = ++this.quotationRequestId;
    this.loading.set(true);
    this.loadError.set('');
    const query: QuotationQuery = {
      page: this.page(),
      limit: this.limit(),
      ...(this.searchTerm() && { search: this.searchTerm() }),
      ...(this.statusFilter() && { status: this.statusFilter() }),
    };

    this.quotationsService.getQuotations(query)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response) => {
          if (requestId !== this.quotationRequestId) return;
          this.quotations.set(response.data);
          this.filters.set({ page: response.pagination.page, limit: response.pagination.limit });
          this.totalItems.set(response.pagination.total);
          this.loading.set(false);
        },
        error: (error) => {
          if (requestId !== this.quotationRequestId) return;
          const message = extractApiErrorMessage(error);
          const errorMessage = message || 'Error al cargar cotizaciones';
          this.loadError.set(errorMessage);
          this.toastService.error(errorMessage);
          this.loading.set(false);
        },
      });
  }

  onSearch(term: string): void {
    this.searchTerm.set(term);
    this.filters.update((filters) => ({ ...filters, page: 1 }));
    this.loadQuotations();
  }

  onFilterChange(values: FilterValues): void {
    this.filterValues.set({ ...values });
    this.filters.update((filters) => ({ ...filters, page: 1 }));
    this.loadQuotations();
  }

  clearFilters(): void {
    this.filterValues.set({ status: '' });
    this.searchTerm.set('');
    this.filters.update((filters) => ({ ...filters, page: 1 }));
    this.loadQuotations();
  }

  onPageChange(page: number): void {
    this.filters.update((filters) => ({ ...filters, page }));
    this.loadQuotations();
  }

  onViewDetail(quotation: Quotation): void {
    this.router.navigate(['/admin/orders/quotations', quotation.id]);
  }

  onSend(q: Quotation): void {
    this.quotationsService.sendQuotation(q.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => { this.toastService.success('Cotización enviada'); this.refresh(); },
        error: (err) => this.showQuotationError(err, 'Error al enviar cotización'),
      });
  }

  onAccept(q: Quotation): void {
    this.quotationsService.acceptQuotation(q.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => { this.toastService.success('Cotización aceptada'); this.refresh(); },
        error: (err) => this.showQuotationError(err, 'Error al aceptar cotización'),
      });
  }

  onReject(q: Quotation): void {
    this.quotationsService.rejectQuotation(q.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => { this.toastService.success('Cotización rechazada'); this.refresh(); },
        error: (err) => this.showQuotationError(err, 'Error al rechazar cotización'),
      });
  }

  async onCancel(q: Quotation): Promise<void> {
    const confirmed = await this.dialogService.confirm({
      title: 'Cancelar cotización',
      message: `¿Cancelar la cotización ${q.quotation_number}?`,
      confirmText: 'Cancelar cotización',
      cancelText: 'Volver',
      confirmVariant: 'danger',
    });
    if (!confirmed) return;

    this.quotationsService.cancelQuotation(q.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => { this.toastService.success('Cotización cancelada'); this.refresh(); },
        error: (err) => this.showQuotationError(err, 'Error al cancelar cotización'),
      });
  }

  async onConvert(q: Quotation): Promise<void> {
    if (!this.canConvertToOrder()) return;
    if (q.destination !== undefined && q.destination !== 'sale') {
      this.toastService.error('Solo las cotizaciones de venta pueden convertirse en orden.');
      return;
    }
    const blockedMessage = this.getConvertBlockedMessage(q);
    if (blockedMessage) {
      this.toastService.error(blockedMessage);
      return;
    }

    const confirmed = await this.dialogService.confirm({
      title: 'Convertir a orden',
      message: `¿Convertir la cotización ${q.quotation_number} en una orden de venta?`,
      confirmText: 'Convertir',
      cancelText: 'Cancelar',
    });
    if (!confirmed) return;

    this.quotationsService.convertToOrder(q.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => { this.toastService.success('Cotización convertida a orden'); this.refresh(); },
        error: (err) => this.showQuotationError(err, 'Error al convertir cotización'),
      });
  }

  onDuplicate(q: Quotation): void {
    this.quotationsService.duplicateQuotation(q.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => { this.toastService.success('Cotización duplicada'); this.refresh(); },
        error: (err) => this.showQuotationError(err, 'Error al duplicar cotización'),
      });
  }

  async onDelete(q: Quotation): Promise<void> {
    const confirmed = await this.dialogService.confirm({
      title: 'Eliminar cotización',
      message: `¿Eliminar la cotización ${q.quotation_number}? Esta acción no se puede deshacer.`,
      confirmText: 'Eliminar',
      cancelText: 'Cancelar',
      confirmVariant: 'danger',
    });
    if (!confirmed) return;

    this.quotationsService.deleteQuotation(q.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => { this.toastService.success('Cotización eliminada'); this.refresh(); },
        error: (err) => this.showQuotationError(err, 'Error al eliminar cotización'),
      });
  }

  onEdit(q: Quotation): void {
    if (q.destination === 'contract') {
      if (q.status !== 'draft' || !this.canUpdateContractQuotation()) return;
      this.quotationsService.getQuotationById(q.id)
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({
          next: (fullQuotation) => {
            this.selectedQuotation.set(fullQuotation);
            this.initialDestination.set('contract');
            this.quotationModalOpen.set(true);
          },
          error: (err) => this.showQuotationError(err, 'Error al cargar la cotización'),
        });
      return;
    }
    if (!this.canUpdateQuotation()) return;
    this.router.navigate(['/admin/pos'], { queryParams: { mode: 'quotation', editQuotation: q.id } });
  }

  navigateToQuotationMode(): void {
    this.router.navigate(['/admin/pos'], { queryParams: { mode: 'quotation' } });
  }

  navigateToQuotationProfiles(): void {
    if (!this.canReadQuotationProfiles()) return;
    this.router.navigate(['/admin/orders/quotations/profiles']);
  }

  openQuotationModal(destination: QuotationDestination = 'sale'): void {
    if (destination === 'contract' && !this.canCreateContractQuotation()) return;
    this.selectedQuotation.set(null);
    this.initialDestination.set(destination);
    this.quotationModalOpen.set(true);
  }

  closeQuotationModal(): void {
    if (this.savingQuotation()) return;
    this.quotationModalOpen.set(false);
    this.selectedQuotation.set(null);
  }

  saveQuotation(dto: QuotationFormSaveDto): void {
    if (this.savingQuotation()) return;
    const editing = this.selectedQuotation();
    if (editing) {
      const editableContract = editing.destination === 'contract' && editing.status === 'draft' && this.canUpdateContractQuotation();
      if (editing.destination === 'contract' ? !editableContract : !this.canUpdateQuotation()) {
        this.toastService.error('No tienes permiso para editar esta cotización.');
        return;
      }
    } else if (!this.canCreateQuotation()) {
      this.toastService.error('No tienes permiso para crear cotizaciones.');
      return;
    }
    if (!editing && dto.destination === 'contract' && !this.canCreateContractQuotation()) {
      this.toastService.error('No tienes permiso para cotizar contratos en esta tienda.');
      return;
    }
    const destination = editing?.destination ?? dto.destination ?? 'sale';
    if (destination === 'contract' && !(dto.customer_id ?? editing?.customer_id)) {
      this.toastService.error('Selecciona un cliente para cotizar un contrato');
      return;
    }
    this.savingQuotation.set(true);
    const updateDto = { ...dto };
    delete updateDto.destination;
    delete updateDto.profile_id;
    let request$: Observable<Quotation>;
    if (editing) {
      request$ = this.quotationsService.updateQuotation(editing.id, updateDto);
    } else {
      if (!dto.items) {
        this.savingQuotation.set(false);
        this.toastService.error('La cotización nueva necesita al menos una línea.');
        return;
      }
      const createDto: CreateQuotationDto = { ...dto, items: dto.items };
      request$ = this.quotationsService.createQuotation(createDto);
    }
    request$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (savedQuotation) => {
        this.toastService.success(editing ? 'Cotización actualizada' : 'Cotización creada');
        this.savingQuotation.set(false);
        this.quotationModalOpen.set(false);
        this.selectedQuotation.set(null);
        this.refresh();
        this.router.navigate(['/admin/orders/quotations', savedQuotation.id]);
      },
      error: (err) => {
        this.savingQuotation.set(false);
        this.showQuotationError(err, 'Error al guardar cotización');
      },
    });
  }

  async createContractFromAccepted(q: Quotation): Promise<void> {
    if (!this.canCreateContractFromQuotation() || q.destination !== 'contract' || q.status !== 'accepted' || this.contractCreationLocks.has(q.id)) return;
    this.contractCreationLocks.add(q.id);
    const confirmed = await this.dialogService.confirm({
      title: 'Crear contrato',
      message: `¿Crear un contrato desde la cotización ${q.quotation_number}?`,
      confirmText: 'Crear contrato',
      cancelText: 'Volver',
    });
    if (!confirmed) {
      this.contractCreationLocks.delete(q.id);
      return;
    }
    this.contractsService.createFromQuotation(q.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (contract) => {
          this.refresh();
          this.router.navigate(['/admin/orders/contracts', contract.id]);
        },
        error: (err) => {
          this.contractCreationLocks.delete(q.id);
          const contractId = Number(err?.details?.contract_id);
          if (err?.code === 'QUOTE_CONTRACT_001' && Number.isInteger(contractId) && contractId > 0) {
            this.refresh();
            this.router.navigate(['/admin/orders/contracts', contractId]);
            return;
          }
          this.showQuotationError(err, 'Error al crear el contrato');
        },
      });
  }

  private refresh(): void {
    this.quotationsService.invalidateCache();
    this.loadStats();
    this.loadQuotations();
  }

  private getConvertBlockedMessage(q: Quotation): string | null {
    if (q.status === 'accepted') {
      return null;
    }

    if (q.status === 'draft') {
      return 'Antes de convertirla en orden, envía la cotización y márcala como aceptada.';
    }

    if (q.status === 'sent') {
      return 'Antes de convertirla en orden, márcala como aceptada cuando el cliente la apruebe.';
    }

    return 'Solo las cotizaciones aceptadas pueden convertirse en orden.';
  }

  private showQuotationError(error: any, fallback: string): void {
    const message = extractApiErrorMessage(error);
    this.toastService.error(message || fallback);
  }
}
