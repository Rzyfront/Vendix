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
import { CategoriesService } from '../../services';
import { AuthFacade } from '../../../../../../core/store/auth/auth.facade';
import { extractApiErrorMessage } from '../../../../../../core/utils';

// Interfaces
import {
  ProductCategory,
  CreateCategoryDto,
  UpdateCategoryDto,
  CategoryQuery,
  CategoryState,
} from '../../interfaces';

// Child Components
import { CategoryFormModalComponent } from './components/category-form-modal.component';
import { CategoryListComponent } from './components/category-list/category-list.component';

@Component({
  selector: 'app-categories-page',
  standalone: true,
  imports: [StatsComponent, CategoryFormModalComponent, CategoryListComponent],
  template: `
    <div class="w-full overflow-x-hidden">
      <!-- Stats Grid: sticky at top on mobile -->
      <div
        class="stats-container sticky top-0 z-20 bg-background md:static md:bg-transparent"
      >
        <app-stats
          title="Total Categorías"
          [value]="stats().total"
          smallText="Categorías registradas"
          iconName="layers"
          iconBgColor="bg-blue-100"
          iconColor="text-blue-600"
        ></app-stats>

        <app-stats
          title="Activas"
          [value]="stats().active"
          smallText="Visibles para productos"
          iconName="check-circle"
          iconBgColor="bg-green-100"
          iconColor="text-green-600"
        ></app-stats>

        <app-stats
          title="Inactivas"
          [value]="stats().inactive"
          smallText="Ocultas en catálogo"
          iconName="x-circle"
          iconBgColor="bg-amber-100"
          iconColor="text-amber-600"
        ></app-stats>

        <app-stats
          title="Destacadas"
          [value]="stats().featured"
          smallText="Prioridad en el inicio"
          iconName="star"
          iconBgColor="bg-yellow-100"
          iconColor="text-yellow-600"
        ></app-stats>
      </div>

      <!-- Categories List -->
      <app-category-list
        [items]="categories()"
        [isLoading]="isLoading()"
        [totalItems]="totalItems()"
        [currentPage]="filters().page ?? 1"
        [totalPages]="totalPages()"
        [limit]="filters().limit ?? 10"
        [canCreate]="canCreate()"
        [canUpdate]="canUpdate()"
        [canDelete]="canDelete()"
        (refresh)="loadCategories()"
        (search)="onSearch($event)"
        (filter)="onFilter($event)"
        (create)="openCreate()"
        (edit)="openEdit($event)"
        (delete)="onDelete($event)"
        (toggleState)="onToggleState($event)"
        (toggleFeatured)="onToggleFeatured($event)"
        (sort)="onSort($event)"
        (pageChange)="onPageChange($event)"
      ></app-category-list>

      <!-- Create/Edit Modal -->
      @if (canMutate()) {
        <app-category-form-modal
          [isOpen]="isModalOpen()"
          [category]="selectedCategory()"
          [isSubmitting]="isSubmitting()"
          (cancel)="onModalCancel()"
          (save)="onModalSubmit($event)"
        ></app-category-form-modal>
      }
    </div>
  `,
})
export class CategoriesPageComponent implements OnInit {
  private categoriesService = inject(CategoriesService);
  private authFacade = inject(AuthFacade);
  private toastService = inject(ToastService);
  private dialogService = inject(DialogService);
  private destroyRef = inject(DestroyRef);

  categories = signal<ProductCategory[]>([]);
  selectedCategory = signal<ProductCategory | null>(null);

  filters = signal<CategoryQuery>({ page: 1, limit: 10 });
  totalItems = signal(0);

  stats = signal({
    total: 0,
    active: 0,
    inactive: 0,
    featured: 0,
  });

  searchTerm = signal('');
  statusFilter = signal<'all' | 'active' | 'inactive'>('all');
  featuredFilter = signal<'all' | 'featured' | 'not_featured'>('all');
  sortBy = signal<string | null>(null);
  sortOrder = signal<'asc' | 'desc' | null>(null);

  isLoading = signal(false);
  isModalOpen = signal(false);
  isSubmitting = signal(false);

  totalPages = computed(() => {
    const limit = this.filters().limit ?? 10;
    return Math.ceil(this.totalItems() / limit) || 1;
  });

  readonly canCreate = computed(() =>
    this.authFacade.hasPermission('store:categories:create'),
  );
  readonly canUpdate = computed(() =>
    this.authFacade.hasPermission('store:categories:update'),
  );
  readonly canDelete = computed(() =>
    this.authFacade.hasPermission('store:categories:delete'),
  );
  readonly canMutate = computed(
    () => this.canCreate() || this.canUpdate() || this.canDelete(),
  );

  ngOnInit(): void {
    this.loadCategories();
  }

  loadCategories(): void {
    this.isLoading.set(true);

    const query: CategoryQuery = {
      page: this.filters().page,
      limit: this.filters().limit,
    };

    if (this.searchTerm()) {
      query.search = this.searchTerm();
    }

    if (this.statusFilter() !== 'all') {
      query.state = this.statusFilter() as CategoryState;
    }

    if (this.featuredFilter() !== 'all') {
      query.is_featured = this.featuredFilter() === 'featured';
    }

    const sortBy = this.sortBy();
    const sortOrder = this.sortOrder();
    if (sortBy && sortOrder) {
      query.sort_by = sortBy;
      query.sort_order = sortOrder;
    }

    this.categoriesService
      .getPaginated(query)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response) => {
          if (response?.data) {
            this.categories.set(response.data);
            this.totalItems.set(
              response.meta?.pagination?.total ??
                response.meta?.total ??
                response.data.length,
            );
            this.calculateStats();
          }
          this.isLoading.set(false);
        },
        error: (error) => {
          this.toastService.error(extractApiErrorMessage(error));
          this.isLoading.set(false);
        },
      });
  }

  private calculateStats(): void {
    const list = this.categories();
    this.stats.set({
      total: this.totalItems(),
      active: list.filter((c) => c.state === 'active').length,
      inactive: list.filter((c) => c.state === 'inactive').length,
      featured: list.filter((c) => c.is_featured).length,
    });
  }

  onSearch(term: string): void {
    this.searchTerm.set(term);
    this.filters.update((f) => ({ ...f, page: 1 }));
    this.loadCategories();
  }

  onFilter(values: FilterValues): void {
    const stateValue = (values['state'] as string) || '';
    if (stateValue === 'active') {
      this.statusFilter.set('active');
    } else if (stateValue === 'inactive') {
      this.statusFilter.set('inactive');
    } else {
      this.statusFilter.set('all');
    }

    const featuredValue = (values['is_featured'] as string) || '';
    if (featuredValue === 'true') {
      this.featuredFilter.set('featured');
    } else if (featuredValue === 'false') {
      this.featuredFilter.set('not_featured');
    } else {
      this.featuredFilter.set('all');
    }

    this.filters.update((f) => ({ ...f, page: 1 }));
    this.loadCategories();
  }

  onPageChange(page: number): void {
    this.filters.update((f) => ({ ...f, page }));
    this.loadCategories();
  }

  onSort(event: { column: string; direction: 'asc' | 'desc' | null }): void {
    if (!event.direction) {
      this.sortBy.set(null);
      this.sortOrder.set(null);
      this.loadCategories();
      return;
    }
    this.sortBy.set(event.column);
    this.sortOrder.set(event.direction);
    this.filters.update((f) => ({ ...f, page: 1 }));
    this.loadCategories();
  }

  openCreate(): void {
    if (!this.canCreate()) return;
    this.selectedCategory.set(null);
    this.isModalOpen.set(true);
  }

  openEdit(category: ProductCategory): void {
    if (!this.canUpdate()) return;
    this.selectedCategory.set(category);
    this.isModalOpen.set(true);
  }

  onModalCancel(): void {
    this.isModalOpen.set(false);
    this.selectedCategory.set(null);
  }

  onModalSubmit(payload: CreateCategoryDto | UpdateCategoryDto): void {
    this.isSubmitting.set(true);
    const current = this.selectedCategory();

    if (current) {
      this.categoriesService
        .updateCategory(current.id, payload as UpdateCategoryDto)
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({
          next: () => {
            this.toastService.success('Categoría actualizada correctamente');
            this.isSubmitting.set(false);
            this.onModalCancel();
            this.loadCategories();
          },
          error: (error) => {
            this.toastService.error(extractApiErrorMessage(error));
            this.isSubmitting.set(false);
          },
        });
    } else {
      this.categoriesService
        .createCategory(payload as CreateCategoryDto)
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({
          next: () => {
            this.toastService.success('Categoría creada correctamente');
            this.isSubmitting.set(false);
            this.onModalCancel();
            this.loadCategories();
          },
          error: (error) => {
            this.toastService.error(extractApiErrorMessage(error));
            this.isSubmitting.set(false);
          },
        });
    }
  }

  onToggleState(category: ProductCategory): void {
    if (!this.canUpdate()) return;
    const nextState: CategoryState =
      category.state === 'active' ? 'inactive' : 'active';

    this.categoriesService
      .toggleCategoryState(category.id, nextState)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.toastService.success(
            nextState === 'active'
              ? 'Categoría activada'
              : 'Categoría desactivada',
          );
          this.loadCategories();
        },
        error: (error) => {
          this.toastService.error(extractApiErrorMessage(error));
          this.loadCategories();
        },
      });
  }

  onToggleFeatured(category: ProductCategory): void {
    if (!this.canUpdate()) return;
    const nextValue = !category.is_featured;

    this.categoriesService
      .updateCategory(category.id, { is_featured: nextValue })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.toastService.success(
            nextValue
              ? 'Categoría marcada como destacada'
              : 'Categoría retirada de destacadas',
          );
          this.loadCategories();
        },
        error: (error) => {
          this.toastService.error(extractApiErrorMessage(error));
          this.loadCategories();
        },
      });
  }

  onDelete(category: ProductCategory): void {
    if (!this.canDelete()) return;
    this.dialogService
      .confirm({
        title: 'Eliminar Categoría',
        message: `¿Está seguro de que desea eliminar "${category.name}"? Esta acción no se puede deshacer.`,
        confirmText: 'Eliminar',
        cancelText: 'Cancelar',
        confirmVariant: 'danger',
      })
      .then((confirmed) => {
        if (confirmed) {
          this.deleteCategory(category, false);
        }
      });
  }

  private deleteCategory(category: ProductCategory, force: boolean): void {
    this.categoriesService
      .deleteCategory(category.id, force)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.toastService.success('Categoría eliminada correctamente');
          this.loadCategories();
        },
        error: (error) => {
          const errorCode = error?.error?.error_code;
          if (errorCode === 'CAT_DELETE_HAS_PRODUCTS' && !force) {
            const productCount =
              error?.error?.details?.product_count ?? 0;
            this.dialogService
              .confirm({
                title: 'La categoría tiene productos asignados',
                message: `Hay ${productCount} producto(s) asignados a "${category.name}". Si continúas, los productos se desligarán de esta categoría (no se eliminarán) y la categoría se archivará. ¿Deseas continuar?`,
                confirmText: 'Eliminar y desligar',
                cancelText: 'Cancelar',
                confirmVariant: 'danger',
              })
              .then((confirmed) => {
                if (confirmed) this.deleteCategory(category, true);
              });
            return;
          }
          this.toastService.error(extractApiErrorMessage(error));
        },
      });
  }
}
