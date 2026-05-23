import {
  Component,
  OnInit,
  signal,
  computed,
  DestroyRef,
  inject,
} from '@angular/core';

import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

// Shared Components
import {
  ToastService,
  DialogService,
  StatsComponent,
  FilterValues,
} from '../../../../../../shared/components/index';

// Services
import { BrandsService } from '../../services/brands.service';
import { AuthFacade } from '../../../../../../core/store/auth/auth.facade';

// Interfaces
import {
  Brand,
  BrandQuery,
  BrandState,
  CreateBrandDto,
  UpdateBrandDto,
} from '../../interfaces';

// Child Components
import { BrandFormModalComponent } from './components/brand-form-modal.component';
import { BrandListComponent } from './components/brand-list/brand-list.component';

type BrandStateFilter = BrandState | 'all';

@Component({
  selector: 'app-brands-page',
  standalone: true,
  imports: [StatsComponent, BrandFormModalComponent, BrandListComponent],
  template: `
    <div class="w-full overflow-x-hidden">
      <!-- Stats Grid: sticky at top on mobile -->
      <div
        class="stats-container sticky top-0 z-20 bg-background md:static md:bg-transparent"
      >
        <app-stats
          title="Total Marcas"
          [value]="stats().total"
          smallText="Marcas registradas"
          iconName="tag"
          iconBgColor="bg-blue-100"
          iconColor="text-blue-600"
        ></app-stats>

        <app-stats
          title="Activas"
          [value]="stats().active"
          smallText="Visibles en el catálogo"
          iconName="check-circle"
          iconBgColor="bg-green-100"
          iconColor="text-green-600"
        ></app-stats>

        <app-stats
          title="Inactivas"
          [value]="stats().inactive"
          smallText="Ocultas del catálogo"
          iconName="x-circle"
          iconBgColor="bg-amber-100"
          iconColor="text-amber-600"
        ></app-stats>
      </div>

      <!-- Brand List -->
      <app-brand-list
        [brands]="brands()"
        [isLoading]="is_loading()"
        [totalItems]="totalItems()"
        [currentPage]="filters().page"
        [totalPages]="totalPages()"
        [limit]="filters().limit"
        [canCreate]="canCreate()"
        [canUpdate]="canUpdate()"
        [canDelete]="canDelete()"
        (refresh)="loadBrands()"
        (search)="onSearch($event)"
        (filter)="onFilter($event)"
        (create)="openCreate()"
        (edit)="openEdit($event)"
        (toggleState)="onToggleState($event)"
        (delete)="onDelete($event)"
        (sort)="onSort($event)"
        (pageChange)="onPageChange($event)"
      ></app-brand-list>

      <!-- Create/Edit Modal (only mounted when the user can mutate) -->
      @if (canMutate()) {
        <app-brand-form-modal
          [isOpen]="is_modal_open()"
          [brand]="selected_brand()"
          [isSubmitting]="is_submitting()"
          (cancel)="onModalCancel()"
          (save)="onModalSubmit($event)"
        ></app-brand-form-modal>
      }
    </div>
  `,
})
export class BrandsPageComponent implements OnInit {
  brands = signal<Brand[]>([]);
  selected_brand = signal<Brand | null>(null);

  filters = signal<{ page: number; limit: number }>({ page: 1, limit: 10 });
  totalItems = signal(0);

  stats = signal({
    total: 0,
    active: 0,
    inactive: 0,
  });

  state_filter = signal<BrandStateFilter>('all');
  search_term = signal('');
  sort_by = signal<string | null>(null);
  sort_order = signal<'asc' | 'desc' | null>(null);

  is_loading = signal(false);
  is_modal_open = signal(false);
  is_submitting = signal(false);

  totalPages = computed(() => {
    return Math.ceil(this.totalItems() / this.filters().limit) || 1;
  });

  private destroyRef = inject(DestroyRef);
  private authFacade = inject(AuthFacade);
  private brandsService = inject(BrandsService);
  private toastService = inject(ToastService);
  private dialogService = inject(DialogService);

  // Permissions — delete uses the asymmetric `admin_delete` permission.
  readonly canCreate = computed(() =>
    this.authFacade.hasPermission('store:brands:create'),
  );
  readonly canUpdate = computed(() =>
    this.authFacade.hasPermission('store:brands:update'),
  );
  readonly canDelete = computed(() =>
    this.authFacade.hasPermission('store:brands:admin_delete'),
  );
  readonly canMutate = computed(
    () => this.canCreate() || this.canUpdate() || this.canDelete(),
  );

  ngOnInit(): void {
    this.loadBrands();
  }

  loadBrands(): void {
    this.is_loading.set(true);

    const query: BrandQuery = {
      page: this.filters().page,
      limit: this.filters().limit,
    };

    if (this.search_term()) {
      query.search = this.search_term();
    }

    if (this.state_filter() !== 'all') {
      query.state = this.state_filter() as BrandState;
    }

    const sortBy = this.sort_by();
    const sortOrder = this.sort_order();
    if (sortBy && sortOrder) {
      query.sort_by = sortBy;
      query.sort_order = sortOrder;
    }

    this.brandsService
      .getPaginated(query)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response) => {
          this.brands.set(response.data ?? []);
          this.totalItems.set(
            response.meta?.pagination?.total ?? response.data?.length ?? 0,
          );
          this.calculateStats();
          this.is_loading.set(false);
        },
        error: (error) => {
          this.toastService.error(error?.message || 'Error al cargar marcas');
          this.is_loading.set(false);
        },
      });
  }

  private calculateStats(): void {
    const list = this.brands();
    this.stats.set({
      total: list.length,
      active: list.filter((b) => b.state === 'active').length,
      inactive: list.filter((b) => b.state === 'inactive').length,
    });
  }

  onSearch(term: string): void {
    this.search_term.set(term);
    this.filters.update((f) => ({ ...f, page: 1 }));
    this.loadBrands();
  }

  onFilter(values: FilterValues): void {
    const stateValue = values['state'] as string | undefined;
    if (stateValue === 'active' || stateValue === 'inactive') {
      this.state_filter.set(stateValue);
    } else {
      this.state_filter.set('all');
    }
    this.filters.update((f) => ({ ...f, page: 1 }));
    this.loadBrands();
  }

  onPageChange(page: number): void {
    this.filters.update((f) => ({ ...f, page }));
    this.loadBrands();
  }

  onSort(event: { column: string; direction: 'asc' | 'desc' | null }): void {
    if (!event.direction) {
      this.sort_by.set(null);
      this.sort_order.set(null);
    } else {
      this.sort_by.set(event.column);
      this.sort_order.set(event.direction);
    }
    this.filters.update((f) => ({ ...f, page: 1 }));
    this.loadBrands();
  }

  openCreate(): void {
    if (!this.canCreate()) return;
    this.selected_brand.set(null);
    this.is_modal_open.set(true);
  }

  openEdit(brand: Brand): void {
    if (!this.canUpdate()) return;
    this.selected_brand.set(brand);
    this.is_modal_open.set(true);
  }

  onModalCancel(): void {
    this.is_modal_open.set(false);
    this.selected_brand.set(null);
  }

  onModalSubmit(data: CreateBrandDto | UpdateBrandDto): void {
    this.is_submitting.set(true);
    const current = this.selected_brand();

    if (current) {
      if (!this.canUpdate()) {
        this.is_submitting.set(false);
        return;
      }
      this.brandsService
        .updateBrand(current.id, data as UpdateBrandDto)
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({
          next: () => {
            this.toastService.success('Marca actualizada correctamente');
            this.is_submitting.set(false);
            this.onModalCancel();
            this.loadBrands();
          },
          error: (error) => {
            this.toastService.error(
              error?.message || 'Error al actualizar la marca',
            );
            this.is_submitting.set(false);
          },
        });
    } else {
      if (!this.canCreate()) {
        this.is_submitting.set(false);
        return;
      }
      this.brandsService
        .createBrand(data as CreateBrandDto)
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({
          next: () => {
            this.toastService.success('Marca creada correctamente');
            this.is_submitting.set(false);
            this.onModalCancel();
            this.loadBrands();
          },
          error: (error) => {
            this.toastService.error(
              error?.message || 'Error al crear la marca',
            );
            this.is_submitting.set(false);
          },
        });
    }
  }

  onToggleState(brand: Brand): void {
    if (!this.canUpdate()) return;
    const nextState: BrandState =
      brand.state === 'active' ? 'inactive' : 'active';
    this.brandsService
      .toggleBrandState(brand.id, nextState)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.toastService.success(
            nextState === 'active'
              ? 'Marca activada correctamente'
              : 'Marca desactivada correctamente',
          );
          this.loadBrands();
        },
        error: (error) => {
          this.toastService.error(
            error?.message || 'Error al cambiar el estado de la marca',
          );
        },
      });
  }

  onDelete(brand: Brand): void {
    if (!this.canDelete()) return;
    this.dialogService
      .confirm({
        title: 'Eliminar Marca',
        message: `¿Está seguro de que desea eliminar "${brand.name}"? Esta acción no se puede deshacer.`,
        confirmText: 'Eliminar',
        cancelText: 'Cancelar',
        confirmVariant: 'danger',
      })
      .then((confirmed) => {
        if (confirmed) {
          this.deleteBrand(brand, false);
        }
      });
  }

  private deleteBrand(brand: Brand, force: boolean): void {
    this.brandsService
      .deleteBrand(brand.id, force)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.toastService.success('Marca eliminada correctamente');
          this.loadBrands();
        },
        error: (error) => {
          const errorCode = error?.error?.error_code;
          if (errorCode === 'BRAND_DELETE_HAS_PRODUCTS' && !force) {
            const productCount =
              error?.error?.details?.product_count ?? 0;
            this.dialogService
              .confirm({
                title: 'La marca tiene productos asignados',
                message: `Hay ${productCount} producto(s) asignados a "${brand.name}". Si continúas, los productos quedarán sin marca (no se eliminarán) y la marca se archivará. ¿Deseas continuar?`,
                confirmText: 'Eliminar y desligar',
                cancelText: 'Cancelar',
                confirmVariant: 'danger',
              })
              .then((confirmed) => {
                if (confirmed) this.deleteBrand(brand, true);
              });
            return;
          }
          this.toastService.error(
            error?.error?.message || 'Error al eliminar la marca',
          );
        },
      });
  }
}
