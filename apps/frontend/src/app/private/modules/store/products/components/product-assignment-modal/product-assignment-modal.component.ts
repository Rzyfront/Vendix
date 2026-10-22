import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  inject,
  input,
  model,
  output,
  signal,
  untracked,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { firstValueFrom, lastValueFrom } from 'rxjs';

import {
  ButtonComponent,
  DialogService,
  IconComponent,
  InputsearchComponent,
  ModalComponent,
  PaginationComponent,
  ToastService,
} from '../../../../../../shared/components/index';
import { runChunked } from '../../../../../../shared/utils/run-chunked';
import { extractApiErrorMessage } from '../../../../../../core/utils';
import { BrandsService } from '../../services/brands.service';
import { CategoriesService } from '../../services/categories.service';
import { ProductsBulkEditService } from '../../bulk-edit/products-bulk-edit.service';
import type { Product } from '../../interfaces';
import {
  BrandMoveGroup,
  MAX_ASSIGN_PRODUCT_IDS,
  ProductAssignmentAction,
} from './product-assignment.types';

export type ProductAssignmentMode = 'category' | 'brand';

const PAGE_SIZE = 20;

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Modal reutilizable "Productos de <nombre>": asigna o quita productos en bloque
 * de una categoría o una marca. El diff (agregados / quitados) se calcula contra
 * los miembros actuales y se envía en tandas de 100 ids.
 */
@Component({
  selector: 'app-product-assignment-modal',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule,
    ModalComponent,
    ButtonComponent,
    IconComponent,
    InputsearchComponent,
    PaginationComponent,
  ],
  template: `
    <app-modal
      [isOpen]="isOpen()"
      (isOpenChange)="isOpen.set($event)"
      size="lg"
      [dialog]="true"
      [fullScreenOnMobile]="true"
      [title]="'Productos de ' + entityName()"
      [subtitle]="mode() === 'brand' ? 'Asigna productos a esta marca' : 'Asigna productos a esta categoría'"
    >
      <div class="flex flex-col gap-3">
        <app-inputsearch
          size="sm"
          placeholder="Buscar por nombre o SKU..."
          [debounceTime]="300"
          [ngModel]="searchTerm()"
          (ngModelChange)="onSearch($event)"
        ></app-inputsearch>

        <div class="flex flex-wrap items-center gap-2">
          <app-button
            variant="outline"
            size="sm"
            [disabled]="isBusy() || total() === 0"
            [loading]="isSelectingAll()"
            (clicked)="selectAllResults()"
          >
            Seleccionar todos los resultados ({{ total() }})
          </app-button>
          <app-button
            variant="ghost"
            size="sm"
            [disabled]="isBusy() || selectedCount() === 0"
            (clicked)="clearSelection()"
          >
            Limpiar
          </app-button>
          <span class="ml-auto text-sm font-medium text-[var(--color-text-secondary)]">
            {{ selectedCount() }} seleccionados
          </span>
        </div>

        @if (isLoading()) {
          <div
            class="flex items-center justify-center gap-2 py-12 text-[var(--color-text-secondary)]"
          >
            <app-icon name="loader-2" [size]="20" [spin]="true" />
            <span class="text-sm">Cargando productos...</span>
          </div>
        } @else if (products().length === 0) {
          <div
            class="flex flex-col items-center justify-center gap-2 py-12 text-center text-[var(--color-text-secondary)]"
          >
            <app-icon name="package" [size]="28" />
            <span class="text-sm">
              {{
                searchTerm()
                  ? 'Ningún producto coincide con la búsqueda'
                  : 'No hay productos disponibles'
              }}
            </span>
          </div>
        } @else {
          <div class="flex flex-col gap-2 max-h-[50vh] overflow-y-auto pr-1">
            @for (product of products(); track product.id) {
              <button
                type="button"
                role="checkbox"
                [attr.aria-checked]="isSelected(product.id)"
                (click)="toggle(product.id)"
                [disabled]="isBusy()"
                class="flex items-center gap-3 p-2.5 rounded-xl border text-left transition-colors hover:border-primary-600 disabled:cursor-not-allowed"
                [class.border-primary-600]="isSelected(product.id)"
                [class.bg-primary-50]="isSelected(product.id)"
                [class.border-border]="!isSelected(product.id)"
              >
                <div
                  class="w-5 h-5 rounded-md border flex items-center justify-center shrink-0 transition-colors"
                  [class.bg-primary-600]="isSelected(product.id)"
                  [class.border-primary-600]="isSelected(product.id)"
                  [class.border-gray-300]="!isSelected(product.id)"
                >
                  @if (isSelected(product.id)) {
                    <app-icon name="check" [size]="12" class="text-white" />
                  }
                </div>
                <div
                  class="w-10 h-10 rounded-md overflow-hidden shrink-0 flex items-center justify-center bg-[var(--color-surface-muted)] text-[var(--color-text-secondary)]"
                >
                  @if (imageOf(product); as url) {
                    <img
                      [src]="url"
                      [alt]="product.name"
                      class="w-full h-full object-cover"
                      style="max-width: 100%;"
                    />
                  } @else {
                    <app-icon name="image" [size]="18" />
                  }
                </div>
                <div class="min-w-0 flex-1">
                  <span
                    class="block font-medium text-[var(--color-text-primary)] truncate"
                  >
                    {{ product.name }}
                  </span>
                  @if (product.sku) {
                    <span
                      class="block truncate text-xs text-[var(--color-text-secondary)]"
                    >
                      SKU: {{ product.sku }}
                    </span>
                  }
                </div>
                @if (isMember(product.id)) {
                  <span
                    class="shrink-0 px-1.5 py-0.5 rounded text-[10px] font-medium bg-[var(--color-surface-muted)] text-[var(--color-text-secondary)]"
                  >
                    {{ mode() === 'brand' ? 'En la marca' : 'En la categoría' }}
                  </span>
                }
              </button>
            }
          </div>

          @if (totalPages() > 1) {
            <div class="flex justify-center">
              <app-pagination
                [currentPage]="page()"
                [totalPages]="totalPages()"
                [total]="total()"
                [limit]="pageSize"
                (pageChange)="onPageChange($event)"
              />
            </div>
          }
        }
      </div>

      <div slot="footer" class="flex items-center justify-between gap-3">
        <span class="text-xs sm:text-sm text-[var(--color-text-secondary)]">
          @if (hasChanges()) {
            +{{ toAdd().length }} agregar · −{{ toRemove().length }} quitar
          }
        </span>
        <div class="flex items-center gap-2">
          <app-button
            variant="ghost"
            [disabled]="isSaving()"
            (clicked)="isOpen.set(false)"
          >
            Cancelar
          </app-button>
          <app-button
            variant="primary"
            [disabled]="!hasChanges() || isBusy()"
            [loading]="isSaving()"
            (clicked)="save()"
          >
            Guardar
          </app-button>
        </div>
      </div>
    </app-modal>
  `,
})
export class ProductAssignmentModalComponent {
  private readonly categoriesService = inject(CategoriesService);
  private readonly brandsService = inject(BrandsService);
  private readonly productsApi = inject(ProductsBulkEditService);
  private readonly toast = inject(ToastService);
  private readonly dialog = inject(DialogService);
  private readonly destroyRef = inject(DestroyRef);

  readonly isOpen = model<boolean>(false);
  readonly mode = input.required<ProductAssignmentMode>();
  readonly entityId = input<number | null>(null);
  readonly entityName = input<string>('');

  /** Emite tras guardar con éxito (total o parcial) para que el padre refresque. */
  readonly saved = output<void>();

  readonly pageSize = PAGE_SIZE;

  readonly products = signal<Product[]>([]);
  readonly total = signal(0);
  readonly page = signal(1);
  readonly searchTerm = signal('');
  readonly isLoading = signal(false);
  readonly isSelectingAll = signal(false);
  readonly isSaving = signal(false);

  private readonly members = signal<ReadonlySet<number>>(new Set());
  private readonly selected = signal<ReadonlySet<number>>(new Set());
  private readonly membersLoaded = signal(false);
  private loadToken = 0;

  readonly totalPages = computed(
    () => Math.ceil(this.total() / PAGE_SIZE) || 1,
  );
  readonly selectedCount = computed(() => this.selected().size);
  readonly toAdd = computed(() => {
    const members = this.members();
    return [...this.selected()].filter((id) => !members.has(id));
  });
  readonly toRemove = computed(() => {
    const selected = this.selected();
    return [...this.members()].filter((id) => !selected.has(id));
  });
  readonly hasChanges = computed(
    () => this.toAdd().length > 0 || this.toRemove().length > 0,
  );
  readonly isBusy = computed(
    () => this.isSaving() || this.isSelectingAll() || !this.membersLoaded(),
  );

  constructor() {
    effect(() => {
      const open = this.isOpen();
      const id = this.entityId();
      if (open && id != null) {
        untracked(() => this.initialize(id));
      }
    });
  }

  isSelected(id: number): boolean {
    return this.selected().has(id);
  }

  isMember(id: number): boolean {
    return this.members().has(id);
  }

  imageOf(product: Product): string | null {
    if (product.image_url) return product.image_url;
    const images = product.product_images ?? [];
    return (images.find((i) => i.is_main) ?? images[0])?.image_url ?? null;
  }

  toggle(id: number): void {
    this.selected.update((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  clearSelection(): void {
    this.selected.set(new Set());
  }

  onSearch(term: string): void {
    this.searchTerm.set(term ?? '');
    this.page.set(1);
    this.loadPage();
  }

  onPageChange(page: number): void {
    this.page.set(page);
    this.loadPage();
  }

  async selectAllResults(): Promise<void> {
    this.isSelectingAll.set(true);
    try {
      const search = this.searchTerm().trim() || undefined;
      const result = await firstValueFrom(
        this.productsApi.getProductIds({ search }),
      );
      this.selected.update((current) => {
        const next = new Set(current);
        result.ids.forEach((id) => next.add(id));
        return next;
      });
      if (result.capped) {
        this.toast.warning(
          `Se seleccionaron los primeros ${result.ids.length} de ${result.total} productos. Afina la búsqueda para el resto.`,
        );
      }
    } catch (error) {
      this.toast.error(extractApiErrorMessage(error));
    } finally {
      this.isSelectingAll.set(false);
    }
  }

  async save(): Promise<void> {
    const id = this.entityId();
    if (id == null || !this.hasChanges() || this.isBusy()) return;
    const added = this.toAdd();
    const removed = this.toRemove();

    this.isSaving.set(true);
    try {
      if (this.mode() === 'brand' && added.length > 0) {
        const groups = await this.previewMoves(id, added);
        if (groups.length > 0 && !(await this.confirmMoves(groups))) {
          return;
        }
      }

      let addedCount = 0;
      let removedCount = 0;
      let failure: unknown = null;

      for (const [action, ids] of [
        ['add', added],
        ['remove', removed],
      ] as [ProductAssignmentAction, number[]][]) {
        if (ids.length === 0 || failure) continue;
        const progress = await lastValueFrom(
          runChunked(
            ids,
            (chunk) => this.assign(id, action, chunk),
            MAX_ASSIGN_PRODUCT_IDS,
          ),
        );
        for (const r of progress.results) {
          addedCount += r.added ?? 0;
          removedCount += r.removed ?? 0;
        }
        if (progress.error) failure = progress.error;
      }

      if (addedCount + removedCount > 0 || !failure) {
        this.toast.success(this.summary(addedCount, removedCount));
      }
      if (failure) {
        this.toast.error(extractApiErrorMessage(failure));
      }
      if (addedCount + removedCount > 0 || !failure) {
        this.saved.emit();
      }
      if (!failure) {
        this.isOpen.set(false);
      } else {
        // Conserva el modal abierto con membresía fresca para reintentar.
        await this.reloadMembers(id);
      }
    } catch (error) {
      this.toast.error(extractApiErrorMessage(error));
    } finally {
      this.isSaving.set(false);
    }
  }

  private assign(id: number, action: ProductAssignmentAction, ids: number[]) {
    return this.mode() === 'brand'
      ? this.brandsService.assignProducts(id, action, ids)
      : this.categoriesService.assignProducts(id, action, ids);
  }

  private async previewMoves(
    id: number,
    ids: number[],
  ): Promise<BrandMoveGroup[]> {
    const merged = new Map<number, BrandMoveGroup>();
    for (let i = 0; i < ids.length; i += MAX_ASSIGN_PRODUCT_IDS) {
      const preview = await firstValueFrom(
        this.brandsService.previewAssignProducts(
          id,
          ids.slice(i, i + MAX_ASSIGN_PRODUCT_IDS),
        ),
      );
      for (const group of preview.to_move ?? []) {
        const prev = merged.get(group.brand_id);
        merged.set(group.brand_id, {
          brand_id: group.brand_id,
          brand_name: group.brand_name,
          count: (prev?.count ?? 0) + group.count,
        });
      }
    }
    return [...merged.values()];
  }

  private confirmMoves(groups: BrandMoveGroup[]): Promise<boolean> {
    const lines = groups
      .map(
        (g) =>
          `${g.count} ${g.count === 1 ? 'producto dejará' : 'productos dejarán'} la marca ${escapeHtml(g.brand_name)}`,
      )
      .join('<br>');
    return this.dialog.confirm({
      title: 'Mover productos de otras marcas',
      message: `${lines}<br><br>¿Deseas continuar?`,
      confirmText: 'Continuar',
      cancelText: 'Cancelar',
    });
  }

  private summary(added: number, removed: number): string {
    const parts: string[] = [];
    if (added > 0) parts.push(`${added} ${added === 1 ? 'agregado' : 'agregados'}`);
    if (removed > 0) parts.push(`${removed} ${removed === 1 ? 'quitado' : 'quitados'}`);
    return parts.length > 0 ? parts.join(', ') : 'Sin cambios';
  }

  private initialize(id: number): void {
    this.searchTerm.set('');
    this.page.set(1);
    this.products.set([]);
    this.total.set(0);
    this.selected.set(new Set());
    this.members.set(new Set());
    this.membersLoaded.set(false);
    this.loadPage();
    void this.reloadMembers(id);
  }

  private async reloadMembers(id: number): Promise<void> {
    try {
      const result = await firstValueFrom(
        this.mode() === 'brand'
          ? this.brandsService.getProductIds(id)
          : this.categoriesService.getProductIds(id),
      );
      const ids = new Set(result.product_ids ?? []);
      this.members.set(ids);
      this.selected.set(new Set(ids));
      this.membersLoaded.set(true);
    } catch (error) {
      this.toast.error(extractApiErrorMessage(error));
    }
  }

  private loadPage(): void {
    const token = ++this.loadToken;
    this.isLoading.set(true);
    this.productsApi
      .getProductsPage({
        page: this.page(),
        limit: PAGE_SIZE,
        search: this.searchTerm().trim() || undefined,
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          if (token !== this.loadToken) return;
          this.products.set(res.data);
          this.total.set(res.total);
          this.isLoading.set(false);
        },
        error: (error) => {
          if (token !== this.loadToken) return;
          this.toast.error(extractApiErrorMessage(error));
          this.isLoading.set(false);
        },
      });
  }
}
