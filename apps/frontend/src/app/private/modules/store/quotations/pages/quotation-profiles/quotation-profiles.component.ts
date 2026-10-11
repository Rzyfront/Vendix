import { Component, computed, DestroyRef, inject, OnDestroy, OnInit, signal, viewChild } from '@angular/core';
import { DatePipe, JsonPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { finalize, Observable, startWith } from 'rxjs';
import { Router } from '@angular/router';
import { CardComponent } from '../../../../../../shared/components/card/card.component';
import { ButtonComponent } from '../../../../../../shared/components/button/button.component';
import { DialogService } from '../../../../../../shared/components/dialog/dialog.service';
import { InputComponent } from '../../../../../../shared/components/input/input.component';
import { InputsearchComponent } from '../../../../../../shared/components/inputsearch/inputsearch.component';
import { AlertBannerComponent } from '../../../../../../shared/components/alert-banner/alert-banner.component';
import { EmptyStateComponent } from '../../../../../../shared/components/empty-state/empty-state.component';
import type { ItemListCardConfig } from '../../../../../../shared/components/item-list/item-list.interfaces';
import { ModalComponent } from '../../../../../../shared/components/modal/modal.component';
import { OptionsDropdownComponent } from '../../../../../../shared/components/options-dropdown/options-dropdown.component';
import type { DropdownAction, FilterConfig, FilterValues } from '../../../../../../shared/components/options-dropdown/options-dropdown.interfaces';
import { PaginationComponent } from '../../../../../../shared/components/pagination/pagination.component';
import { ResponsiveDataViewComponent } from '../../../../../../shared/components/responsive-data-view/responsive-data-view.component';
import { StatsComponent } from '../../../../../../shared/components/stats/stats.component';
import type { TableAction, TableColumn } from '../../../../../../shared/components/table/table.component';
import { ToastService } from '../../../../../../shared/components/toast/toast.service';
import { AuthFacade } from '../../../../../../core/store/auth/auth.facade';
import { extractApiErrorMessage } from '../../../../../../core/utils/api-error-handler';
import { QuotationProfileFormModalComponent } from '../../components/quotation-profile-form-modal/quotation-profile-form-modal.component';
import { QuotationProfile, QuotationProfileVersion } from '../../interfaces/quotation-profile.interface';
import { QuotationProfilesService } from '../../services/quotation-profiles.service';

@Component({
  selector: 'app-quotation-profiles',
  standalone: true,
  imports: [FormsModule, ReactiveFormsModule, DatePipe, JsonPipe, AlertBannerComponent, ButtonComponent, CardComponent, EmptyStateComponent, InputComponent, InputsearchComponent, ModalComponent, OptionsDropdownComponent, PaginationComponent, ResponsiveDataViewComponent, StatsComponent, QuotationProfileFormModalComponent],
  template: `
    <div class="w-full [&_button]:min-h-11 [&_button]:min-w-11 [&_input]:!text-base [&_select]:!text-base [&_select]:!min-h-11 [&_.inputsearch-wrapper]:!min-h-11">
      @if (canRead()) {
        <div class="stats-container sticky top-0 z-20 bg-background md:static md:bg-transparent">
          <app-stats title="Perfiles" [value]="total()" [loading]="isLoading()" smallText="Total de perfiles" iconName="file-text" iconBgColor="bg-blue-100" iconColor="text-blue-600" />
          <app-stats title="Activos" [value]="pageStats().active" [loading]="isLoading()" smallText="En esta página" iconName="check-circle" iconBgColor="bg-emerald-100" iconColor="text-emerald-600" />
          <app-stats title="Inactivos" [value]="pageStats().inactive" [loading]="isLoading()" smallText="En esta página" iconName="circle-x" iconBgColor="bg-gray-100" iconColor="text-gray-500" />
          <app-stats title="Predeterminados" [value]="pageStats().default" [loading]="isLoading()" smallText="En esta página" iconName="star" iconBgColor="bg-amber-100" iconColor="text-amber-600" />
        </div>
      }

      @if (!canRead()) { <app-alert-banner class="m-3" variant="danger" tone="token">No tienes permiso para consultar perfiles de cotización.</app-alert-banner> } @else {

      <app-card [responsive]="true" [padding]="false" overflow="visible">
        <div class="sticky top-[99px] z-10 bg-background px-2 py-1.5 -mt-[5px] md:mt-0 md:static md:bg-transparent md:px-6 md:py-4 md:border-b md:border-border">
          <div class="flex flex-col gap-2 md:flex-row md:justify-between md:items-center md:gap-4">
            <h2 class="text-[13px] font-semibold text-text-secondary tracking-wide md:text-lg md:text-text-primary md:tracking-normal">
              Perfiles de cotización <span class="font-normal text-text-secondary/70">({{ total() }})</span>
            </h2>
            <div class="flex flex-wrap items-center gap-2 w-full md:w-auto">
              <app-inputsearch class="flex-1 md:w-64 rounded-[10px]" ariaLabel="Buscar perfiles de cotización" placeholder="Buscar perfiles…" [debounceTime]="350" [ngModel]="search()" (ngModelChange)="onSearch($event)" />
              <app-options-dropdown class="rounded-[10px]" [filters]="filterConfigs" [filterValues]="filterValues()" [actions]="dropdownActions()" [isLoading]="isLoading()" (filterChange)="onFilterChange($event)" (clearAllFilters)="clearFilters()" (actionClick)="onActionClick($event)" />
            </div>
          </div>
        </div>

        <div class="space-y-4 px-2 pb-2 pt-3 md:p-4">
          <app-alert-banner variant="info" tone="token" icon="info" heading="Configuración comercial, no fiscal">
            Los porcentajes y textos de estos perfiles son configuración comercial; no determinan el régimen, las responsabilidades ni el tratamiento fiscal de una operación.
          </app-alert-banner>

          @if (isLoading()) {
            <div class="p-8 text-center text-text-secondary" role="status" aria-live="polite">Cargando perfiles…</div>
          } @else if (errorMessage()) {
            <app-alert-banner variant="danger" tone="token" heading="No se pudieron cargar los perfiles">
              {{ errorMessage() }}
              <div bannerActions class="mt-3"><app-button variant="outline" (clicked)="load()">Reintentar</app-button></div>
            </app-alert-banner>
          } @else if (!profiles().length) {
            <app-empty-state icon="file-text" [title]="search() || state() ? 'No se encontraron perfiles' : 'Aún no hay perfiles'" [description]="search() || state() ? 'Prueba con otros filtros o limpia la búsqueda.' : 'Crea un perfil para reutilizar condiciones comerciales en nuevas cotizaciones.'" actionButtonText="Crear primer perfil" actionButtonIcon="plus" [showActionButton]="!search() && !state() && canCreate()" [showRefreshButton]="true" [showClearFilters]="!!search() || !!state()" (actionClick)="formModal()?.open(null)" (refreshClick)="load()" (clearFiltersClick)="clearFilters()" />
          } @else {
            <app-responsive-data-view [data]="profiles()" [columns]="tableColumns" [actions]="tableActions()" [cardConfig]="cardConfig" [loading]="isLoading()" [rowLabelKey]="'name'" />
            <app-pagination [currentPage]="page()" [totalPages]="totalPages()" [total]="total()" [limit]="limit()" (pageChange)="changePage($event)" />
          }
        </div>
      </app-card>
      @if (expandedId() !== null) {
        <app-card class="mt-4 block" [responsive]="true" [padding]="false" overflow="visible">
          <div class="border-b border-border px-4 py-3 md:px-6"><h2 class="font-semibold text-text-primary">Historial de versiones</h2><p class="mt-1 text-sm text-text-secondary">Configuración guardada del perfil seleccionado.</p></div>
          <div class="space-y-3 p-3 md:p-4">
            @if (versionsLoading()) { <div class="p-4 text-center text-text-secondary" role="status" aria-live="polite">Cargando historial…</div> }
            @else if (versionsError()) { <app-alert-banner variant="danger" tone="token" heading="No se pudo cargar el historial">{{ versionsError() }}<div bannerActions class="mt-3"><app-button variant="outline" (clicked)="loadVersions(expandedId()!, versionsPage())">Reintentar</app-button></div></app-alert-banner> }
            @else if (versions().length) {
              <app-responsive-data-view [data]="versions()" [columns]="versionColumns" [actions]="versionActions" [cardConfig]="versionCardConfig" [loading]="versionsLoading()" [rowLabelKey]="'version'" />
              <app-pagination [currentPage]="versionsPage()" [totalPages]="versionsTotalPages()" [total]="versionsTotal()" [limit]="versionsLimit()" (pageChange)="loadVersions(expandedId()!, $event)" />
            } @else { <app-empty-state icon="history" title="Sin versiones" description="No hay versiones registradas para este perfil." size="sm" /> }
          </div>
        </app-card>
      }
      }
      <app-quotation-profile-form-modal (saved)="onSaved()"></app-quotation-profile-form-modal>

    <app-modal [(isOpen)]="cloneOpen" title="Clonar perfil" subtitle="El clon conserva una configuración independiente." size="sm" [dialog]="true" [canClose]="canCloseClone" [closeOnEscape]="!cloneLoading()" [showCloseButton]="!cloneLoading()">
      <form [formGroup]="cloneForm" (ngSubmit)="clone()" class="space-y-3">
        <app-input label="Nombre del nuevo perfil *" formControlName="name" [maxlength]="150" customClasses="!min-h-11 !text-base" [error]="cloneNameError()"></app-input>
        @if (cloneError()) { <p class="text-sm text-[var(--color-error)]" role="alert">{{ cloneError() }}</p> }
      </form>
      <div slot="footer" class="flex justify-end gap-2"><app-button variant="outline" customClasses="min-h-11" [disabled]="cloneLoading()" (clicked)="cloneOpen.set(false)">Cancelar</app-button><app-button variant="primary" customClasses="min-h-11" [loading]="cloneLoading()" [disabled]="cloneFormStatus() !== 'VALID' || cloneLoading()" (clicked)="clone()">Clonar</app-button></div>
    </app-modal>

    <app-modal [(isOpen)]="versionConfigOpen" title="Configuración guardada" subtitle="Valores registrados en esta versión del perfil." size="md" [dialog]="true">
      @if (selectedVersion(); as selected) {
        <div class="space-y-2">
          <p class="text-sm text-text-secondary">Versión {{ selected.version }} · {{ selected.created_at | date:'medium' }}</p>
          <pre class="max-h-[60vh] overflow-auto whitespace-pre-wrap break-words rounded-lg border border-border bg-background p-3 text-xs text-text-primary">{{ selected.config | json }}</pre>
        </div>
      }
      <div slot="footer" class="flex justify-end"><app-button variant="outline" customClasses="min-h-11" (clicked)="versionConfigOpen.set(false)">Cerrar</app-button></div>
    </app-modal>
    </div>
  `,
})
export class QuotationProfilesComponent implements OnInit, OnDestroy {
  private readonly profilesService = inject(QuotationProfilesService);
  private readonly auth = inject(AuthFacade);
  private readonly dialog = inject(DialogService);
  private readonly toast = inject(ToastService);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  readonly profiles = signal<QuotationProfile[]>([]);
  readonly isLoading = signal(false);
  readonly errorMessage = signal('');
  readonly search = signal('');
  readonly state = signal('');
  readonly filterValues = signal<FilterValues>({ state: null });
  readonly filterConfigs: FilterConfig[] = [{ key: 'state', label: 'Estado', type: 'select', placeholder: 'Todos', options: [{ label: 'Todos', value: '' }, { label: 'Activos', value: 'active' }, { label: 'Inactivos', value: 'inactive' }] }];
  readonly filters = signal({ page: 1, limit: 20 });
  readonly page = computed(() => this.filters().page);
  readonly limit = computed(() => this.filters().limit);
  readonly total = signal(0);
  readonly totalPages = computed(() => Math.ceil(this.total() / this.limit()) || 1);
  readonly pageStats = computed(() => ({
    active: this.profiles().filter((profile) => profile.state === 'active').length,
    inactive: this.profiles().filter((profile) => profile.state === 'inactive').length,
    default: this.profiles().filter((profile) => profile.is_default).length,
  }));
  readonly expandedId = signal<number | null>(null);
  readonly selectedVersion = signal<QuotationProfileVersion | null>(null);
  readonly versionConfigOpen = signal(false);
  readonly versions = signal<QuotationProfileVersion[]>([]);
  readonly versionsLoading = signal(false);
  readonly versionsError = signal('');
  readonly versionsFilters = signal({ page: 1, limit: 20 });
  readonly versionsPage = computed(() => this.versionsFilters().page);
  readonly versionsTotal = signal(0);
  readonly versionsLimit = computed(() => this.versionsFilters().limit);
  readonly versionsTotalPages = computed(() => Math.ceil(this.versionsTotal() / this.versionsLimit()) || 1);
  readonly pendingIds = signal<ReadonlySet<number>>(new Set());
  readonly cloneOpen = signal(false);
  readonly cloneLoading = signal(false);
  readonly cloneError = signal('');
  readonly cloneSource = signal<number | null>(null);
  readonly cloneForm = inject(FormBuilder).nonNullable.group({ name: ['', [Validators.required, Validators.maxLength(150)]] });
  readonly cloneFormStatus = toSignal(this.cloneForm.statusChanges.pipe(startWith(this.cloneForm.status)), { initialValue: this.cloneForm.status });
  readonly cloneFormEvents = toSignal(this.cloneForm.events, { initialValue: null });
  readonly canCloseClone = (): boolean => !this.cloneLoading();
  readonly formModal = viewChild(QuotationProfileFormModalComponent);
  private searchTimer: ReturnType<typeof setTimeout> | undefined;
  private loadSequence = 0;
  private versionsSequence = 0;

  readonly tableColumns: TableColumn[] = [
    { key: 'name', label: 'Nombre', sortable: true, priority: 1 },
    { key: 'state', label: 'Estado', priority: 1, transform: (value: string) => value === 'active' ? 'Activo' : 'Inactivo', badge: true, badgeConfig: { type: 'status' } },
    { key: 'is_default', label: 'Predeterminado', priority: 2, transform: (value: boolean) => value ? 'Sí' : 'No' },
    { key: 'current_version', label: 'Versión', priority: 2 },
    { key: 'updated_at', label: 'Actualizado', priority: 3, transform: (value: string) => value ? new Date(value).toLocaleDateString() : '—' },
  ];
  readonly versionColumns: TableColumn[] = [
    { key: 'version', label: 'Versión', sortable: true, priority: 1, transform: (value: number) => `Versión ${value}` },
    { key: 'created_at', label: 'Fecha', priority: 1, transform: (value: string) => value ? new Date(value).toLocaleString('es-CO') : '—' },
  ];

  readonly versionCardConfig: ItemListCardConfig = {
    titleKey: 'version',
    titleTransform: (version: QuotationProfileVersion) => `Versión ${version.version}`,
    subtitleKey: 'created_at',
    subtitleTransform: (version: QuotationProfileVersion) => version.created_at ? new Date(version.created_at).toLocaleString('es-CO') : 'Fecha no disponible',
    detailKeys: [{ key: 'id', label: 'Detalle', icon: 'file-text', transform: () => 'Consulta la configuración completa desde la acción de la versión.' }],
  };

  readonly versionActions: TableAction[] = [{ label: 'Ver configuración', icon: 'file-text', variant: 'info', action: (version: QuotationProfileVersion) => this.openVersionConfig(version) }];

  readonly dropdownActions = computed<DropdownAction[]>(() => [
    { label: 'Volver a cotizaciones', icon: 'arrow-left', action: 'back', variant: 'outline' },
    ...(this.canCreate() ? [{ label: 'Nuevo perfil', icon: 'plus', action: 'new', variant: 'primary' as const }] : []),
  ]);

  readonly cardConfig: ItemListCardConfig = {
    titleKey: 'name',
    subtitleKey: 'current_version',
    subtitleTransform: (profile: QuotationProfile) => `Versión ${profile.current_version}`,
    avatarFallbackIcon: 'file-text',
    avatarShape: 'square',
    badgeKey: 'state',
    badgeConfig: { type: 'status', size: 'sm' },
    badgeTransform: (value: string) => value === 'active' ? 'Activo' : 'Inactivo',
    detailKeys: [
      { key: 'is_default', label: 'Predeterminado', icon: 'star', transform: (value: boolean) => value ? 'Sí' : 'No' },
      { key: 'updated_at', label: 'Actualizado', icon: 'calendar', transform: (value: string) => value ? new Date(value).toLocaleDateString() : '—' },
    ],
  };

  readonly tableActions = computed<TableAction[]>(() => [
    { label: 'Editar', icon: 'edit', variant: 'info', action: (item: QuotationProfile) => this.edit(item), show: () => this.canUpdate() && this.canReadOne(), disabled: (item: QuotationProfile) => this.isPending(item.id) },
    { label: 'Clonar', icon: 'copy', variant: 'secondary', action: (item: QuotationProfile) => this.openClone(item), show: () => this.canCreate(), disabled: (item: QuotationProfile) => this.isPending(item.id) },
    { label: 'Hacer predeterminado', icon: 'star', variant: 'warning', action: (item: QuotationProfile) => this.setDefault(item), show: (item: QuotationProfile) => this.canUpdate() && !item.is_default, disabled: (item: QuotationProfile) => this.isPending(item.id) },
    { label: (item: QuotationProfile) => item.state === 'active' ? 'Desactivar' : 'Activar', icon: 'power', variant: 'muted', action: (item: QuotationProfile) => this.setActive(item), show: () => this.canUpdate(), disabled: (item: QuotationProfile) => this.isPending(item.id) },
    { label: 'Eliminar', icon: 'trash-2', variant: 'danger', action: (item: QuotationProfile) => this.remove(item), show: () => this.canDelete(), disabled: (item: QuotationProfile) => this.isPending(item.id) },
    { label: (item: QuotationProfile) => this.expandedId() === item.id ? 'Ocultar historial' : 'Ver historial', icon: 'history', variant: 'ghost', action: (item: QuotationProfile) => this.toggleVersions(item), show: () => this.canReadOne() },
  ]);

  ngOnInit(): void { this.load(); }

  ngOnDestroy(): void {
    this.loadSequence++;
    this.versionsSequence++;
    if (this.searchTimer) clearTimeout(this.searchTimer);
  }

  canRead(): boolean { return this.auth.hasPermission('store:quotations:read'); }
  canReadOne(): boolean { return this.auth.hasPermission('store:quotations:read:one'); }
  canCreate(): boolean { return this.auth.hasPermission('store:quotations:create'); }
  canUpdate(): boolean { return this.auth.hasPermission('store:quotations:update'); }
  canDelete(): boolean { return this.auth.hasPermission('store:quotations:delete'); }

  isPending(id: number): boolean { return this.pendingIds().has(id); }

  back(): void { void this.router.navigate(['/admin/orders/quotations']); }

  onSearch(value: string): void {
    this.search.set(value);
    if (this.searchTimer) clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(() => { this.filters.update((filters) => ({ ...filters, page: 1 })); this.load(); }, 250);
  }

  setState(value: string): void {
    if (this.searchTimer) clearTimeout(this.searchTimer);
    this.state.set(value);
    this.filterValues.set({ state: value || null });
    this.filters.update((filters) => ({ ...filters, page: 1 }));
    this.load();
  }
  onFilterChange(values: FilterValues): void {
    if (this.searchTimer) clearTimeout(this.searchTimer);
    const state = typeof values['state'] === 'string' ? values['state'] : '';
    this.filterValues.set({ state: state || null });
    this.state.set(state);
    this.filters.update((filters) => ({ ...filters, page: 1 }));
    this.load();
  }
  clearFilters(): void {
    this.search.set('');
    if (this.searchTimer) clearTimeout(this.searchTimer);
    this.state.set('');
    this.filterValues.set({ state: null });
    this.filters.update((filters) => ({ ...filters, page: 1 }));
    this.load();
  }
  onActionClick(action: string): void {
    if (action === 'back') this.back();
    if (action === 'new' && this.canCreate()) this.formModal()?.open(null);
  }

  openVersionConfig(version: QuotationProfileVersion): void {
    this.selectedVersion.set(version);
    this.versionConfigOpen.set(true);
  }
  changePage(page: number): void { this.filters.update((filters) => ({ ...filters, page })); this.load(); }

  load(): void {
    if (!this.canRead()) return;
    const sequence = ++this.loadSequence;
    const requestedPage = this.page();
    this.isLoading.set(true);
    this.errorMessage.set('');
    this.profilesService.getProfiles({ page: this.page(), limit: this.limit(), search: this.search().trim() || undefined, state: (this.state() || undefined) as 'active' | 'inactive' | undefined })
      .pipe(finalize(() => { if (sequence === this.loadSequence) this.isLoading.set(false); }), takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (result) => {
          if (sequence !== this.loadSequence) return;
          const lastPage = result.total > 0 ? Math.ceil(result.total / this.limit()) : 1;
          if (requestedPage > lastPage) {
            this.filters.update((filters) => ({ ...filters, page: lastPage }));
            this.load();
            return;
          }
          this.profiles.set(result.data);
          this.total.set(result.total);
          this.filters.update((filters) => ({ ...filters, page: result.total > 0 ? result.page : 1 }));
        },
        error: (error) => { if (sequence === this.loadSequence) this.errorMessage.set(extractApiErrorMessage(error)); },
      });
  }

  edit(profile: QuotationProfile): void {
    if (!this.canReadOne() || !this.canUpdate()) return;
    this.profilesService.getProfile(profile.id).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (full) => this.formModal()?.open(full),
      error: (error) => this.toast.error(extractApiErrorMessage(error)),
    });
  }

  openClone(profile: QuotationProfile): void {
    if (!this.canCreate()) return;
    this.cloneSource.set(profile.id);
    this.cloneError.set('');
    this.cloneForm.reset({ name: `${profile.name} (copia)` });
    this.cloneOpen.set(true);
  }

  cloneNameError(): string {
    this.cloneFormEvents();
    const control = this.cloneForm.controls.name;
    if (!control.touched) return '';
    if (control.hasError('required')) return 'El nombre es obligatorio.';
    if (control.hasError('maxlength')) return 'Máximo 150 caracteres.';
    return '';
  }
  clone(): void {
    if (!this.canCreate()) return;
    if (this.cloneLoading()) return;
    if (this.cloneForm.invalid) { this.cloneForm.markAllAsTouched(); return; }
    const id = this.cloneSource();
    if (id === null) return;
    this.cloneLoading.set(true);
    this.profilesService.clone(id, this.cloneForm.controls.name.value.replace(/\s+/g, ' ').trim()).pipe(finalize(() => this.cloneLoading.set(false)), takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => { this.cloneOpen.set(false); this.toast.success('Perfil clonado.'); this.load(); },
      error: (error) => this.cloneError.set(extractApiErrorMessage(error)),
    });
  }

  setDefault(profile: QuotationProfile): void {
    if (!this.canUpdate()) return;
    this.runProfileMutation(profile.id, this.profilesService.setDefault(profile.id), 'Perfil predeterminado actualizado.');
  }

  setActive(profile: QuotationProfile): void {
    if (!this.canUpdate()) return;
    this.runProfileMutation(profile.id, this.profilesService.setActive(profile.id, profile.state !== 'active'), profile.state === 'active' ? 'Perfil desactivado.' : 'Perfil activado.');
  }

  remove(profile: QuotationProfile): void {
    if (!this.canDelete()) return;
    void this.dialog.confirm({ title: 'Eliminar perfil', message: `¿Eliminar el perfil «${profile.name}»? Esta acción no se puede deshacer.`, confirmText: 'Eliminar', confirmVariant: 'danger' }).then((confirmed) => {
      if (!confirmed) return;
      this.runProfileMutation(profile.id, this.profilesService.remove(profile.id), 'Perfil eliminado.');
    });
  }

  toggleVersions(profile: QuotationProfile): void {
    if (!this.canReadOne()) return;
    if (this.expandedId() === profile.id) {
      this.expandedId.set(null);
      this.versionsSequence++;
      this.versionsLoading.set(false);
      this.versions.set([]);
      this.versionsTotal.set(0);
      return;
    }
    this.expandedId.set(profile.id);
    this.loadVersions(profile.id);
  }

  loadVersions(id: number, page = 1): void {
    if (!this.canReadOne() || this.expandedId() !== id) return;
    const sequence = ++this.versionsSequence;
    this.versionsLoading.set(true);
    this.versionsError.set('');
    this.versions.set([]);
    this.versionsFilters.update((filters) => ({ ...filters, page }));
    this.profilesService.getVersions(id, page, this.versionsLimit()).pipe(
      finalize(() => {
        if (sequence === this.versionsSequence && this.expandedId() === id) this.versionsLoading.set(false);
      }),
      takeUntilDestroyed(this.destroyRef),
    ).subscribe({
      next: (result) => {
        if (sequence !== this.versionsSequence || this.expandedId() !== id || this.versionsPage() !== page) return;
        this.versions.set(result.data);
        this.versionsTotal.set(result.total);
        this.versionsFilters.update((filters) => ({ ...filters, page: result.page }));
      },
      error: (error) => {
        if (sequence === this.versionsSequence && this.expandedId() === id && this.versionsPage() === page) this.versionsError.set(extractApiErrorMessage(error));
      },
    });
  }

  onSaved(): void { this.toast.success('Perfil guardado.'); this.filters.update((filters) => ({ ...filters, page: 1 })); this.load(); }

  private runProfileMutation(id: number, request: Observable<unknown>, successMessage: string): void {
    if (this.isPending(id)) return;
    this.pendingIds.update((pending) => new Set([...pending, id]));
    request.pipe(finalize(() => this.pendingIds.update((pending) => { const next = new Set(pending); next.delete(id); return next; })), takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => { this.toast.success(successMessage); this.load(); },
      error: (error) => this.toast.error(extractApiErrorMessage(error)),
    });
  }

}
