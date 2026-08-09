import {
  Component,
  computed,
  DestroyRef,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  FormBuilder,
  FormControl,
  FormGroup,
  ReactiveFormsModule,
} from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Subject, debounceTime, distinctUntilChanged } from 'rxjs';
import {
  ModalComponent,
  ButtonComponent,
  InputComponent,
  IconComponent,
  SpinnerComponent,
  EmptyStateComponent,
  ToastService,
  PaginationComponent,
} from '../../../../../../../shared/components/index';
import { CurrencyPipe } from '../../../../../../../shared/pipes/index';
import { ProductsService } from '../../../../products/services/products.service';
import {
  TableSessionAddItem,
  SellableProductOption,
} from '../../interfaces';

/**
 * Modal to append lines to an open table session (cuenta abierta).
 *
 * Single source of truth for selection survives page changes and modal
 * reopen: a `selectedQty` Map<product_id, qty> drives everything
 * (subtotal, decrement validation, submit payload). The server-side
 * product list is paginated to a fixed page size and is reset (along
 * with the search term and selection) whenever the modal transitions
 * from closed to open.
 */
@Component({
  selector: 'app-add-items-modal',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    ModalComponent,
    ButtonComponent,
    InputComponent,
    IconComponent,
    SpinnerComponent,
    EmptyStateComponent,
    PaginationComponent,
    CurrencyPipe,
  ],
  templateUrl: './add-items-modal.component.html',
  styleUrl: './add-items-modal.component.scss',
})
export class AddItemsModalComponent {
  private readonly fb = inject(FormBuilder);
  private readonly productsService = inject(ProductsService);
  private readonly toastService = inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);

  readonly isOpen = input(false);
  readonly loadingInput = input(false, { alias: 'loading' });
  readonly internalLoading = signal(false);
  readonly loading = computed(() => this.loadingInput() || this.internalLoading());

  readonly isOpenChange = output<boolean>();
  readonly addItems = output<TableSessionAddItem[]>();

  private readonly searchDebounce$ = new Subject<string>();

  // --- Paginated product list state ---------------------------------------
  readonly currentProducts = signal<SellableProductOption[]>([]);
  readonly isLoading = signal(false);
  readonly currentPage = signal(1);
  readonly totalPages = signal(1);
  readonly total = signal(0);
  readonly limit = signal(20);

  // --- Selection state (survives page change and reopen) -----------------
  readonly selectedQty = signal<Map<number, number>>(new Map());
  readonly productById = signal<Map<number, SellableProductOption>>(
    new Map(),
  );
  readonly searchTerm = signal('');

  readonly form: FormGroup<{ search: FormControl<string> }>;

  get searchControl(): FormControl<string> {
    return this.form.controls.search;
  }

  // --- Derived UI signals ------------------------------------------------
  readonly selectedCount = computed(
    () =>
      Array.from(this.selectedQty().values()).filter((q) => q > 0).length,
  );

  readonly hasItems = computed(() => this.selectedCount() > 0);

  readonly totalPreview = computed(() => {
    const byId = this.productById();
    let sum = 0;
    for (const [id, qty] of this.selectedQty()) {
      const p = byId.get(id);
      if (p) sum += Number(p.base_price ?? 0) * qty;
    }
    return sum;
  });

  constructor() {
    this.form = this.fb.group({
      search: this.fb.nonNullable.control(''),
    });

    // Debounced search → reload
    this.searchDebounce$
      .pipe(
        debounceTime(300),
        distinctUntilChanged(),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((term) => {
        this.searchTerm.set(term);
        this.currentPage.set(1);
        this.loadProducts();
      });

    // Reset state and reload every time the modal transitions false → true.
    // Wrapped in untracked() so the effect doesn't trigger on its own writes.
    effect(() => {
      const open = this.isOpen();
      if (!open) return;
      untracked(() => this.resetAndLoad());
    });
  }

  onOpenChange(open: boolean): void {
    this.isOpenChange.emit(open);
  }

  onCancel(): void {
    this.onOpenChange(false);
  }

  onSearchInput(value: string): void {
    this.searchDebounce$.next(value);
  }

  trackById(_i: number, row: SellableProductOption): number {
    return row.id;
  }

  quantityOf(productId: number): number {
    return this.selectedQty().get(productId) ?? 0;
  }

  /**
   * QUI-653 — productos marcados "para llevar" en esta tanda.
   *
   * Se lleva en un Set aparte y NO dentro de `selectedQty`, porque son dos
   * dimensiones independientes: la cantidad decide si la línea existe, el flag
   * decide cómo se entrega. Mezclarlos obligaría a un Map de objetos y a
   * reconstruirlo en cada `bumpQty`.
   *
   * El flag aplica a TODA la línea. Marcar solo algunas unidades de una línea
   * con cantidad > 1 exigiría partir la línea, que es el eje de QUI-655 y no de
   * este ticket.
   */
  readonly takeawayIds = signal<Set<number>>(new Set());

  isTakeaway(productId: number): boolean {
    return this.takeawayIds().has(productId);
  }

  toggleTakeaway(product: SellableProductOption): void {
    this.takeawayIds.update((prev) => {
      const next = new Set(prev);
      if (next.has(product.id)) next.delete(product.id);
      else next.add(product.id);
      return next;
    });
  }

  increment(product: SellableProductOption): void {
    this.bumpQty(product, 1);
  }

  decrement(product: SellableProductOption): void {
    this.bumpQty(product, -1);
  }

  onPageChange(page: number): void {
    this.currentPage.set(page);
    this.loadProducts();
  }

  onSubmit(): void {
    const items: TableSessionAddItem[] = [];
    for (const [productId, qty] of this.selectedQty()) {
      if (qty > 0)
        items.push({
          product_id: productId,
          quantity: qty,
          // Solo se envía cuando está marcado: el backend ya tiene default
          // false, y mandar `false` explícito en cada línea ensucia el payload
          // sin cambiar nada.
          ...(this.isTakeaway(productId) && { is_takeaway: true }),
        });
    }
    if (items.length === 0) {
      this.toastService.error('Agrega al menos un producto con cantidad > 0');
      return;
    }
    this.addItems.emit(items);
  }

  /**
   * Hide the broken <img> and let the parent .product-thumb show the
   * default icon. Mirrors the POS pattern (see
   * pos-product-selection.component.ts:onImageError).
   */
  onThumbError(event: Event): void {
    const target = event.target as HTMLImageElement;
    if (target) target.style.display = 'none';
  }

  // --- Private helpers ---------------------------------------------------
  private resetAndLoad(): void {
    this.selectedQty.set(new Map());
    // QUI-653 — sin esto un "para llevar" de la tanda anterior sobrevive al
    // cierre y se filtra a la siguiente, marcando un plato que nadie pidió así.
    this.takeawayIds.set(new Set());
    this.productById.set(new Map());
    this.searchTerm.set('');
    this.form.controls.search.setValue('', { emitEvent: false });
    this.currentPage.set(1);
    this.currentProducts.set([]);
    this.loadProducts();
  }

  private bumpQty(product: SellableProductOption, delta: number): void {
    const current = this.selectedQty().get(product.id) ?? 0;
    const next = Math.max(0, current + delta);
    const map = new Map(this.selectedQty());
    if (next === 0) {
      map.delete(product.id);
      // QUI-653 — al sacar el producto de la selección se limpia su flag. Si no,
      // volver a agregarlo lo traeria marcado "para llevar" sin que nadie lo
      // pidiera: la linea seria nueva pero el flag viejo.
      this.takeawayIds.update((prev) => {
        if (!prev.has(product.id)) return prev;
        const cleaned = new Set(prev);
        cleaned.delete(product.id);
        return cleaned;
      });
    } else {
      map.set(product.id, next);
    }
    this.selectedQty.set(map);

    // Cache metadata (name, price, image) for products in the selection
    // so subtotal keeps working when the user pages away.
    const byId = new Map(this.productById());
    byId.set(product.id, product);
    this.productById.set(byId);
  }

  private loadProducts(): void {
    this.isLoading.set(true);
    this.productsService
      .getProducts({
        limit: this.limit(),
        page: this.currentPage(),
        is_sellable: true,
        search: this.searchTerm().trim() || undefined,
      } as any)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          const list = (res.data ?? []) as unknown as SellableProductOption[];
          this.currentProducts.set(list);

          const p = res.pagination;
          if (p) {
            this.total.set(p.total ?? 0);
            this.totalPages.set(p.totalPages ?? 1);
            this.limit.set(p.limit ?? this.limit());
          } else {
            this.total.set(list.length);
            this.totalPages.set(1);
          }

          // Keep the byId cache warm for anything on screen so subtotal
          // works without the user re-clicking a row after a search.
          if (list.length > 0) {
            const byId = new Map(this.productById());
            for (const item of list) byId.set(item.id, item);
            this.productById.set(byId);
          }
          this.isLoading.set(false);
        },
        error: () => {
          this.isLoading.set(false);
        },
      });
  }
}
