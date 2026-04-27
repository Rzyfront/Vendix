import { Component, DestroyRef, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { SubscriptionAdminService } from '../../services/subscription-admin.service';
import { PromotionalPlan } from '../../interfaces/subscription-admin.interface';
import {
  StatsComponent,
  InputsearchComponent,
  ButtonComponent,
  IconComponent,
  ResponsiveDataViewComponent,
  TableColumn,
  TableAction,
  ItemListCardConfig,
  PaginationComponent,
  ModalComponent,
  InputComponent,
  CardComponent,
  EmptyStateComponent,
} from '../../../../../../shared/components';

@Component({
  selector: 'app-promotional',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    StatsComponent,
    InputsearchComponent,
    ButtonComponent,
    IconComponent,
    CardComponent,
    EmptyStateComponent,
    ResponsiveDataViewComponent,
    PaginationComponent,
    ModalComponent,
    InputComponent,
  ],
  template: `
    <div class="w-full">
      <!-- Stats -->
      <div class="stats-container !mb-0 md:!mb-8 sticky top-0 z-20 bg-background md:static md:bg-transparent">
        <app-stats
          title="Total promos"
          [value]="pagination().total"
          iconName="tag"
          iconBgColor="bg-blue-100"
          iconColor="text-blue-600"
        ></app-stats>
        <app-stats
          title="Activas"
          [value]="activeCount()"
          iconName="check"
          iconBgColor="bg-green-100"
          iconColor="text-green-600"
        ></app-stats>
        <app-stats
          title="Expiradas"
          [value]="expiredCount()"
          iconName="clock"
          iconBgColor="bg-red-100"
          iconColor="text-red-600"
        ></app-stats>
        <app-stats
          title="Usos totales"
          [value]="totalUses()"
          iconName="users"
          iconBgColor="bg-purple-100"
          iconColor="text-purple-600"
        ></app-stats>
      </div>

      <div class="md:space-y-4">
        <app-card [responsive]="true" [padding]="false" customClasses="md:min-h-[600px]">
          <!-- Search Section -->
          <div class="sticky top-[99px] z-10 bg-background px-2 py-1.5 -mt-[5px] md:mt-0 md:static md:bg-transparent md:px-6 md:py-4 md:border-b md:border-border">
            <div class="flex flex-col gap-2 md:flex-row md:justify-between md:items-center md:gap-4">
              <h2 class="text-[13px] font-semibold text-text-secondary tracking-wide md:text-lg md:font-semibold md:text-text-primary md:tracking-normal">
                Planes promocionales <span class="font-normal text-text-secondary/50 md:font-semibold md:text-text-primary">({{ pagination().total }})</span>
              </h2>
              <div class="flex items-center gap-2 w-full md:w-auto">
                <app-inputsearch
                  class="flex-1 md:w-64 shadow-[0_2px_8px_rgba(0,0,0,0.07)] md:shadow-none rounded-[10px]"
                  size="sm"
                  placeholder="Buscar promos..."
                  [debounceTime]="500"
                  (searchChange)="onSearch($event)"
                />
                <app-button
                  variant="outline"
                  size="md"
                  customClasses="w-10 sm:w-11 !px-0 bg-surface shadow-[0_2px_8px_rgba(0,0,0,0.07)] md:shadow-none !rounded-[10px] shrink-0"
                  (clicked)="showCreateModal.set(true)"
                  title="Nueva promo"
                >
                  <app-icon slot="icon" name="plus" [size]="18"></app-icon>
                </app-button>
              </div>
            </div>
          </div>

          <!-- Loading -->
          @if (loading()) {
            <div class="p-4 md:p-6 text-center">
              <div class="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
              <p class="mt-2 text-text-secondary">Cargando...</p>
            </div>
          }

          <!-- Empty -->
          @if (!loading() && promos().length === 0) {
            <app-empty-state
              icon="gift"
              title="No hay promos"
              description="No hay planes promocionales que coincidan con los filtros."
              [showActionButton]="false"
            ></app-empty-state>
          }

          <!-- Data View + Pagination -->
          @if (!loading() && promos().length > 0) {
            <div class="px-2 pb-2 pt-3 md:p-4">
              <app-responsive-data-view
                [data]="promos()"
                [columns]="columns"
                [cardConfig]="cardConfig"
                [actions]="actions"
                [loading]="loading()"
              />
              @if (pagination().totalPages > 1) {
                <div class="mt-4 flex justify-center">
                  <app-pagination
                    [currentPage]="pagination().page"
                    [totalPages]="pagination().totalPages"
                    [total]="pagination().total"
                    [limit]="pagination().limit"
                    infoStyle="none"
                    (pageChange)="changePage($event)"
                  />
                </div>
              }
            </div>
          }
        </app-card>
      </div>

      @defer (when showCreateModal()) {
        <app-modal [(isOpen)]="showCreateModal" title="Nuevo plan promocional" size="md">
          <div class="p-4 space-y-4">
            <form [formGroup]="form">
              <app-input label="Nombre" formControlName="name" [control]="form.get('name')" [required]="true"></app-input>
              <app-input label="Código" formControlName="code" [control]="form.get('code')" [required]="true"></app-input>
              <app-input label="Descuento %" type="number" formControlName="discount_percent" [control]="form.get('discount_percent')" [required]="true"></app-input>
              <app-input label="Máx. usos" type="number" formControlName="max_uses" [control]="form.get('max_uses')"></app-input>
              <app-input label="Válido desde" type="date" formControlName="valid_from" [control]="form.get('valid_from')" [required]="true"></app-input>
              <app-input label="Válido hasta" type="date" formControlName="valid_until" [control]="form.get('valid_until')"></app-input>
            </form>
          </div>
          <div slot="footer" class="flex gap-3 justify-end w-full">
            <app-button variant="ghost" (clicked)="showCreateModal.set(false)">Cancelar</app-button>
            <app-button variant="primary" [loading]="submitting()" (clicked)="onCreate()">Crear</app-button>
          </div>
        </app-modal>
      }
    </div>
  `,
})
export class PromotionalComponent {
  private service = inject(SubscriptionAdminService);
  private destroyRef = inject(DestroyRef);
  private fb = inject(FormBuilder);
  readonly router = inject(Router);

  readonly promos = signal<PromotionalPlan[]>([]);
  readonly loading = signal(false);
  readonly searchTerm = signal('');
  readonly showCreateModal = signal(false);
  readonly submitting = signal(false);
  readonly activeCount = signal(0);
  readonly expiredCount = signal(0);
  readonly totalUses = signal(0);

  readonly pagination = signal({
    page: 1,
    limit: 10,
    total: 0,
    totalPages: 0,
  });

  form: FormGroup = this.fb.group({
    name: ['', Validators.required],
    code: ['', Validators.required],
    discount_percent: [0, [Validators.required, Validators.min(0), Validators.max(100)]],
    max_uses: [null],
    valid_from: ['', Validators.required],
    valid_until: [null],
  });

  columns: TableColumn[] = [
    { key: 'name', label: 'Nombre', sortable: true, width: '200px', priority: 1 },
    { key: 'code', label: 'Código', sortable: true, width: '150px', priority: 1 },
    { key: 'discount_percent', label: 'Descuento %', sortable: true, width: '100px', align: 'right', priority: 2 },
    { key: 'used_count', label: 'Usados', sortable: true, width: '80px', align: 'center', priority: 2 },
    { key: 'max_uses', label: 'Máx. usos', sortable: true, width: '100px', align: 'center', priority: 3 },
    {
      key: 'is_active',
      label: 'Estado',
      sortable: true,
      width: '100px',
      align: 'center',
      badge: true,
      priority: 1,
      badgeConfig: { type: 'status', size: 'sm' },
      transform: (v: boolean) => (v ? 'Activa' : 'Inactiva'),
    },
  ];

  actions: TableAction[] = [
    {
      label: 'Detalle',
      icon: 'eye',
      variant: 'primary',
      action: (item: PromotionalPlan) =>
        this.router.navigate(['/super-admin/subscriptions/promotional', item.id]),
    },
    {
      label: 'Eliminar',
      icon: 'trash-2',
      variant: 'danger',
      action: (item: PromotionalPlan) => this.deletePromo(item),
    },
  ];

  cardConfig: ItemListCardConfig = {
    titleKey: 'name',
    subtitleKey: 'code',
    badgeKey: 'is_active',
    badgeConfig: { type: 'status', size: 'sm' },
    badgeTransform: (v: boolean) => (v ? 'Activa' : 'Inactiva'),
    detailKeys: [
      { key: 'discount_percent', label: 'Descuento %' },
      { key: 'used_count', label: 'Usados' },
      { key: 'max_uses', label: 'Máx.' },
    ],
  };

  constructor() {
    this.loadPromos();
  }

  loadPromos(): void {
    this.loading.set(true);
    const pag = this.pagination();
    this.service
      .getPromotionalPlans({ page: pag.page, limit: pag.limit })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          if (res.success) {
            this.promos.set(res.data);
            this.pagination.update((p) => ({
              ...p,
              total: res.meta.total,
              totalPages: res.meta.totalPages,
            }));
            this.computeStats(res.data);
          }
          this.loading.set(false);
        },
        error: () => this.loading.set(false),
      });
  }

  computeStats(data: PromotionalPlan[]): void {
    const now = new Date();
    this.activeCount.set(data.filter((p) => p.is_active && (!p.valid_until || new Date(p.valid_until) > now)).length);
    this.expiredCount.set(data.filter((p) => !p.is_active || (p.valid_until && new Date(p.valid_until) <= now)).length);
    this.totalUses.set(data.reduce((sum, p) => sum + p.used_count, 0));
  }

  onSearch(term: string): void {
    this.searchTerm.set(term);
    this.pagination.update((p) => ({ ...p, page: 1 }));
    this.loadPromos();
  }

  changePage(page: number): void {
    this.pagination.update((p) => ({ ...p, page }));
    this.loadPromos();
  }

  onCreate(): void {
    if (this.form.invalid) return;
    this.submitting.set(true);
    this.service
      .createPromotionalPlan(this.form.value)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          if (res.success) {
            this.showCreateModal.set(false);
            this.form.reset();
            this.loadPromos();
          }
          this.submitting.set(false);
        },
        error: () => this.submitting.set(false),
      });
  }

  deletePromo(item: PromotionalPlan): void {
    this.service
      .deletePromotionalPlan(item.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          if (res.success) this.loadPromos();
        },
      });
  }
}
