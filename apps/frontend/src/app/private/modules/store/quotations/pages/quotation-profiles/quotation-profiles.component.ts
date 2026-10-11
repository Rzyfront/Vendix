import { Component, computed, DestroyRef, inject, OnDestroy, OnInit, signal, viewChild } from '@angular/core';
import { DatePipe, JsonPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { finalize, Observable } from 'rxjs';
import { Router } from '@angular/router';
import { ButtonComponent } from '../../../../../../shared/components/button/button.component';
import { CardComponent } from '../../../../../../shared/components/card/card.component';
import { DialogService } from '../../../../../../shared/components/dialog/dialog.service';
import { InputComponent } from '../../../../../../shared/components/input/input.component';
import { InputsearchComponent } from '../../../../../../shared/components/inputsearch/inputsearch.component';
import type { ItemListCardConfig } from '../../../../../../shared/components/item-list/item-list.interfaces';
import { ModalComponent } from '../../../../../../shared/components/modal/modal.component';
import { PaginationComponent } from '../../../../../../shared/components/pagination/pagination.component';
import { ResponsiveDataViewComponent } from '../../../../../../shared/components/responsive-data-view/responsive-data-view.component';
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
  imports: [DatePipe, JsonPipe, FormsModule, ReactiveFormsModule, ButtonComponent, CardComponent, InputComponent, InputsearchComponent, ModalComponent, PaginationComponent, ResponsiveDataViewComponent, QuotationProfileFormModalComponent],
  template: `
    <div class="w-full">
      <header class="sticky top-0 z-20 flex flex-wrap items-center justify-between gap-3 bg-background px-3 py-3 md:static md:bg-transparent md:px-0">
        <div class="flex items-center gap-3">
          <app-button variant="outline" size="sm" (clicked)="back()" aria-label="Volver a cotizaciones">Volver</app-button>
          <div><h1 class="text-xl font-semibold">Perfiles de cotización</h1><p class="text-sm text-[var(--color-text-secondary)]">Configura valores comerciales por tienda.</p></div>
        </div>
        @if (canCreate()) { <app-button variant="primary" (clicked)="formModal()?.open(null)">Nuevo perfil</app-button> }
      </header>

      <aside class="mx-2 my-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950 md:mx-0" role="note">
        Los porcentajes y textos de estos perfiles son configuración comercial; no determinan el régimen, las responsabilidades ni el tratamiento fiscal de una operación.
      </aside>

      @if (!canRead()) { <div class="m-3 rounded-xl border p-6 text-center" role="alert">No tienes permiso para consultar perfiles de cotización.</div> } @else {

      <app-card [responsive]="true" [padding]="false">
        <div class="sticky top-[99px] z-10 flex flex-col gap-2 bg-background px-3 py-2 md:static md:flex-row md:items-end md:justify-between md:border-b md:border-border md:px-6 md:py-4">
          <app-inputsearch class="min-w-0 flex-1" placeholder="Buscar perfiles…" (searchChange)="onSearch($event)"></app-inputsearch>
          <label class="flex flex-col gap-1 text-sm">Estado
            <select class="h-10 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3" [ngModel]="state()" (ngModelChange)="setState($event)">
              <option value="">Todos</option><option value="active">Activos</option><option value="inactive">Inactivos</option>
            </select>
          </label>
        </div>

      @if (isLoading()) {
        <div class="p-8 text-center" role="status">Cargando perfiles…</div>
      } @else if (errorMessage()) {
        <div class="p-6 text-center" role="alert"><p>{{ errorMessage() }}</p><app-button variant="outline" class="mt-3" (clicked)="load()">Reintentar</app-button></div>
      } @else if (!profiles().length) {
        <div class="p-8 text-center"><h2 class="font-semibold">{{ search() || state() ? 'No se encontraron perfiles' : 'Aún no hay perfiles' }}</h2><p class="mt-1 text-sm text-[var(--color-text-secondary)]">{{ search() || state() ? 'Prueba con otros filtros.' : 'Crea un perfil para reutilizar condiciones comerciales en nuevas cotizaciones.' }}</p>@if (!search() && !state() && canCreate()) { <app-button variant="primary" class="mt-4" (clicked)="formModal()?.open(null)">Crear primer perfil</app-button> }</div>
      } @else {
        <div class="px-2 pb-2 pt-3 md:p-4">
          <app-responsive-data-view [data]="profiles()" [columns]="tableColumns" [actions]="tableActions()" [cardConfig]="cardConfig" [loading]="isLoading()" />
          <app-pagination [currentPage]="page()" [totalPages]="totalPages()" [total]="total()" [limit]="limit()" (pageChange)="changePage($event)" />
        </div>
      }
      </app-card>
      @if (expandedId() !== null) {
        <section class="mt-4" aria-label="Historial de versiones">
          @if (versionsLoading()) { <div class="p-4" role="status">Cargando historial…</div> }
          @else if (versionsError()) { <div class="p-4 text-red-700" role="alert">{{ versionsError() }} <button class="underline" (click)="loadVersions(expandedId()!, versionsPage())">Reintentar</button></div> }
          @else if (versions().length) { <ol class="space-y-2">@for (version of versions(); track version.id) { <li class="rounded-md border bg-[var(--color-surface)] p-3 text-sm"><strong>Versión {{ version.version }}</strong><span class="ml-2 text-[var(--color-text-secondary)]">{{ version.created_at | date:'short' }}</span><pre class="mt-1 whitespace-pre-wrap text-xs">{{ version.config | json }}</pre></li> }</ol><app-pagination class="mt-3 block" [currentPage]="versionsPage()" [totalPages]="versionsTotalPages()" [total]="versionsTotal()" [limit]="versionsLimit()" (pageChange)="loadVersions(expandedId()!, $event)" /> }
          @else { <p class="p-4 text-sm text-[var(--color-text-secondary)]">No hay versiones registradas.</p> }
        </section>
      }
      }
      <app-quotation-profile-form-modal (saved)="onSaved()"></app-quotation-profile-form-modal>
    </div>

    <app-modal [(isOpen)]="cloneOpen" title="Clonar perfil" subtitle="El clon conserva una configuración independiente." size="sm" [dialog]="true" [closeOnEscape]="!cloneLoading()" [showCloseButton]="!cloneLoading()">
      <form [formGroup]="cloneForm" (ngSubmit)="clone()" class="space-y-3">
        <app-input label="Nombre del nuevo perfil *" formControlName="name" [maxlength]="150" [error]="cloneNameError()"></app-input>
        @if (cloneError()) { <p class="text-sm text-[var(--color-error)]" role="alert">{{ cloneError() }}</p> }
      </form>
      <div slot="footer" class="flex justify-end gap-2"><app-button variant="outline" [disabled]="cloneLoading()" (clicked)="cloneOpen.set(false)">Cancelar</app-button><app-button variant="primary" [loading]="cloneLoading()" [disabled]="cloneForm.invalid || cloneLoading()" (clicked)="clone()">Clonar</app-button></div>
    </app-modal>
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
  readonly page = signal(1);
  readonly limit = signal(20);
  readonly total = signal(0);
  readonly totalPages = computed(() => Math.ceil(this.total() / this.limit()) || 1);
  readonly expandedId = signal<number | null>(null);
  readonly versions = signal<QuotationProfileVersion[]>([]);
  readonly versionsLoading = signal(false);
  readonly versionsError = signal('');
  readonly versionsPage = signal(1);
  readonly versionsTotal = signal(0);
  readonly versionsLimit = signal(20);
  readonly versionsTotalPages = computed(() => Math.ceil(this.versionsTotal() / this.versionsLimit()) || 1);
  readonly pendingIds = signal<ReadonlySet<number>>(new Set());
  readonly cloneOpen = signal(false);
  readonly cloneLoading = signal(false);
  readonly cloneError = signal('');
  readonly cloneSource = signal<number | null>(null);
  readonly cloneForm = inject(FormBuilder).nonNullable.group({ name: ['', [Validators.required, Validators.maxLength(150)]] });
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

  readonly cardConfig: ItemListCardConfig = {
    titleKey: 'name',
    subtitleKey: 'current_version',
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
    this.searchTimer = setTimeout(() => { this.page.set(1); this.load(); }, 250);
  }

  setState(value: string): void { this.state.set(value); this.page.set(1); this.load(); }
  changePage(page: number): void { this.page.set(page); this.load(); }

  load(): void {
    if (!this.canRead()) return;
    const sequence = ++this.loadSequence;
    this.isLoading.set(true);
    this.errorMessage.set('');
    this.profilesService.getProfiles({ page: this.page(), limit: this.limit(), search: this.search().trim() || undefined, state: (this.state() || undefined) as 'active' | 'inactive' | undefined })
      .pipe(finalize(() => { if (sequence === this.loadSequence) this.isLoading.set(false); }), takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (result) => { if (sequence !== this.loadSequence) return; this.profiles.set(result.data); this.total.set(result.total); this.page.set(result.page); },
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

  cloneNameError(): string { return this.cloneForm.controls.name.touched && this.cloneForm.controls.name.hasError('maxlength') ? 'Máximo 150 caracteres.' : ''; }
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
    this.versionsPage.set(page);
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
        this.versionsPage.set(result.page);
      },
      error: (error) => {
        if (sequence === this.versionsSequence && this.expandedId() === id && this.versionsPage() === page) this.versionsError.set(extractApiErrorMessage(error));
      },
    });
  }

  onSaved(): void { this.toast.success('Perfil guardado.'); this.page.set(1); this.load(); }

  private runProfileMutation(id: number, request: Observable<unknown>, successMessage: string): void {
    if (this.isPending(id)) return;
    this.pendingIds.update((pending) => new Set([...pending, id]));
    request.pipe(finalize(() => this.pendingIds.update((pending) => { const next = new Set(pending); next.delete(id); return next; })), takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => { this.toast.success(successMessage); this.load(); },
      error: (error) => this.toast.error(extractApiErrorMessage(error)),
    });
  }

}
