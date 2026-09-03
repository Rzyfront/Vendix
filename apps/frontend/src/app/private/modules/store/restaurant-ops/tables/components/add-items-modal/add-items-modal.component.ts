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
import { TablesService } from '../../services/tables.service';
import {
  TableSessionAddItem,
  SellableProductOption,
} from '../../interfaces';

/**
 * CP-POLLO-ARABE-727 C.4 (QUI-736) — producto del picker con la variante.
 * `GET /store/products` con `include_variants: true` devuelve `product_variants`
 * en el JSON (el backend lo mapea con `parseVariantAttributes` a
 * `[{attribute_name, attribute_value}]`). `SellableProductOption` no lo declara,
 * así que se extiende localmente para que el template pueda leerlo sin `as any`.
 */
interface AddItemsVariant {
  id: number;
  name?: string | null;
  sku?: string | null;
  attributes?:
    | Array<{ attribute_name: string; attribute_value: string }>
    | Record<string, unknown>
    | null;
  effective_track_inventory?: boolean;
  stock_quantity?: number;
  is_available?: boolean;
}

interface AddItemsProductOption extends SellableProductOption {
  product_variants?: AddItemsVariant[];
}

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
  private readonly tablesService = inject(TablesService);
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
  readonly currentProducts = signal<AddItemsProductOption[]>([]);
  readonly isLoading = signal(false);
  readonly currentPage = signal(1);
  readonly totalPages = signal(1);
  readonly total = signal(0);
  readonly limit = signal(20);

  // --- Selection state (survives page change and reopen) -----------------
  readonly selectedQty = signal<Map<number, number>>(new Map());
  readonly productById = signal<Map<number, AddItemsProductOption>>(
    new Map(),
  );
  /**
   * CP-POLLO-ARABE-727 C.4 (QUI-736) — variante seleccionada por producto.
   * Una línea de un producto VARIANTIZADO no se puede agregar sobre la base: se
   * guarda en su propio Map porque la cantidad (`selectedQty`) es una dimensión
   * y la variante es otra, igual que `takeawayIds`.
   */
  readonly selectedVariantByProduct = signal<Map<number, number>>(new Map());
  readonly searchTerm = signal('');

  // --- C3 — nota libre del mesero por línea ("sin cebolla", "término medio").
  // Persiste aunque el toggle se cierre para no perder lo escrito. Se envia en
  // TableSessionAddItem.notes solo si trae texto no-vacio (el default del
  // backend es null). El DTO backend TableSessionAddItemDto todavia no declara
  // `notes` — pendiente de ventana corta para table-sessions.service.ts /
  // table-session.dto.ts (verificacion documentada a nancy).
  readonly notesByProduct = signal<Map<number, string>>(new Map());
  /** Productos cuyo campo de nota esta desplegado (toggle del UI). */
  readonly showNotesByProduct = signal<Set<number>>(new Set());

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

  /**
   * CP-POLLO-ARABE-727 C.4 (QUI-736) — ¿algún producto VARIANTIZADO en la
   * selección quedó sin variante? Bloquea el submit: agregar la línea sobre la
   * base descontaría inventario en la fila equivocada (base XOR variante).
   */
  readonly hasMissingVariant = computed(() => {
    for (const [productId, qty] of this.selectedQty()) {
      if (qty <= 0) continue;
      const p = this.productById().get(productId);
      if (p?.product_variants?.length && this.selectedVariantOf(productId) == null) {
        return true;
      }
    }
    return false;
  });

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

  /**
   * QUI-655 — "sin papas" capturado AL PEDIR, por producto.
   *
   * Es la INTENCION del cliente, no el consumo: el KDS la muestra tachada y el
   * cocinero decide al confirmar. Se guarda por `product_id` porque en este punto
   * la linea de pedido todavia no existe.
   */
  readonly excludedByProduct = signal<Map<number, Set<number>>>(new Map());
  /** Receta cargada del producto cuyo picker esta abierto. */
  readonly recipeProductId = signal<number | null>(null);
  readonly recipeItems = signal<
    Array<{ component_product_id: number; name: string; quantity: string | number }>
  >([]);
  readonly loadingRecipe = signal(false);

  /**
   * Abre el picker de insumos de un plato. Se carga la receta on-demand y no al
   * listar: pedir la receta de cada producto del catalogo seria N llamadas para una
   * captura que la mayoria de las veces nadie usa.
   */
  openRecipePicker(product: SellableProductOption): void {
    if (this.recipeProductId() === product.id) {
      this.recipeProductId.set(null);
      return;
    }
    this.recipeProductId.set(product.id);
    this.recipeItems.set([]);
    this.loadingRecipe.set(true);
    this.tablesService
      .getRecipeByProduct(product.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (items) => {
          this.recipeItems.set(items);
          this.loadingRecipe.set(false);
        },
        error: () => {
          // Sin receta activa no hay nada que excluir: se cierra en silencio en vez
          // de mostrar un error por algo que es un caso normal.
          this.loadingRecipe.set(false);
          this.recipeProductId.set(null);
        },
      });
  }

  isComponentExcluded(productId: number, componentId: number): boolean {
    return this.excludedByProduct().get(productId)?.has(componentId) === true;
  }

  toggleComponent(productId: number, componentId: number): void {
    this.excludedByProduct.update((prev) => {
      const next = new Map(prev);
      const set = new Set(next.get(productId) ?? []);
      if (set.has(componentId)) set.delete(componentId);
      else set.add(componentId);
      if (set.size === 0) next.delete(productId);
      else next.set(productId, set);
      return next;
    });
  }

  excludedCountFor(productId: number): number {
    return this.excludedByProduct().get(productId)?.size ?? 0;
  }

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

  // --- C3 — notas por línea ----------------------------------------------
  notesFor(productId: number): string {
    return this.notesByProduct().get(productId) ?? '';
  }

  isNotesOpen(productId: number): boolean {
    return this.showNotesByProduct().has(productId);
  }

  /**
   * Toggle del campo de nota. Si el producto ya tiene texto y el toggle se
   * reabre, mostramos el texto previo en vez de un textarea vacio.
   */
  toggleNotes(productId: number): void {
    this.showNotesByProduct.update((prev) => {
      const next = new Set(prev);
      if (next.has(productId)) next.delete(productId);
      else next.add(productId);
      return next;
    });
  }

  setNotes(productId: number, value: string): void {
    this.notesByProduct.update((prev) => {
      const next = new Map(prev);
      if (value.trim()) next.set(productId, value);
      else next.delete(productId);
      return next;
    });
  }

  // --- CP-POLLO-ARABE-727 C.4 (QUI-736): variant picker -------------------
  /** Variante seleccionada para un producto, o `null` si ninguna. */
  selectedVariantOf(productId: number): number | null {
    return this.selectedVariantByProduct().get(productId) ?? null;
  }

  /**
   * Alterna la variante de un producto. Tocar la variante ya seleccionada la
   * deselecciona (para volver a la base), pero el submit lo bloquea si el
   * producto es variantizado y quedó sin variante.
   */
  selectVariant(product: AddItemsProductOption, variantId: number): void {
    const map = new Map(this.selectedVariantByProduct());
    if (map.get(product.id) === variantId) map.delete(product.id);
    else map.set(product.id, variantId);
    this.selectedVariantByProduct.set(map);
  }

  /** ¿Este producto exige elegir variante? */
  hasVariants(product: AddItemsProductOption): boolean {
    return (product.product_variants?.length ?? 0) > 0;
  }

  /** Etiqueta legible de la variante (atributos → name → sku). */
  variantLabel(variant: AddItemsVariant): string {
    const attrs = variant.attributes;
    if (Array.isArray(attrs) && attrs.length > 0) {
      return attrs.map((a) => a.attribute_value).join(' / ');
    }
    return variant.name || variant.sku || `Variante #${variant.id}`;
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
      if (qty <= 0) continue;
      const product = this.productById().get(productId);
      const variantId = this.selectedVariantOf(productId);
      // CP-POLLO-ARABE-727 C.4 (QUI-736) — una línea de producto variantizado
      // sin variante se rechaza: vender la base descontaría inventario en la
      // fila equivocada (base XOR variante). El botón también se deshabilita.
      if (product?.product_variants?.length && variantId == null) {
        this.toastService.error(
          `Selecciona una variante para "${product.name}"`,
        );
        return;
      }
      items.push({
        product_id: productId,
        quantity: qty,
        // CP-POLLO-ARABE-727 C.4 (QUI-736) — la variante elegida viaja a la línea.
        ...(variantId != null && { product_variant_id: variantId }),
        // Solo se envía cuando está marcado: el backend ya tiene default
        // false, y mandar `false` explícito en cada línea ensucia el payload
        // sin cambiar nada.
        ...(this.isTakeaway(productId) && { is_takeaway: true }),
        // Solo se manda cuando hay algo excluido: el backend trata la ausencia
        // como "receta completa".
        ...(this.excludedCountFor(productId) > 0 && {
          excluded_component_ids: [...this.excludedByProduct().get(productId)!],
        }),
        // C3 — nota del mesero. Solo viaja si trae texto no-vacio para no
        // ensuciar el payload. El backend la persiste en order_items.notes.
        ...(this.notesFor(productId).trim() && {
          notes: this.notesFor(productId).trim(),
        }),
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
    // CP-POLLO-ARABE-727 C.4 (QUI-736) — la variante elegida en la tanda
    // anterior no debe filtrarse a la siguiente.
    this.selectedVariantByProduct.set(new Map());
    // Sin esto una exclusion de la tanda anterior se filtra y se captura un "sin
    // papas" que nadie pidio en ESTE pedido.
    this.excludedByProduct.set(new Map());
    // C3 — sin esto una nota de la tanda anterior se filtra y aparece en el
    // pedido siguiente sin que nadie la pidiera.
    this.notesByProduct.set(new Map());
    this.showNotesByProduct.set(new Set());
    this.recipeProductId.set(null);
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
      // CP-POLLO-ARABE-727 C.4 (QUI-736) — la variante se limpia igual: una línea
      // recién agregada no debe arrastrar la variante de la anterior.
      this.selectedVariantByProduct.update((prev) => {
        if (!prev.has(product.id)) return prev;
        const cleaned = new Map(prev);
        cleaned.delete(product.id);
        return cleaned;
      });
      this.excludedByProduct.update((prev) => {
        if (!prev.has(product.id)) return prev;
        const cleaned = new Map(prev);
        cleaned.delete(product.id);
        return cleaned;
      });
      // C3 — si el mesero escribio una nota y luego saca el producto de la
      // seleccion, limpiamos la nota. Igual que takeaway: una linea nueva
      // no debe arrastrar la nota de la anterior.
      this.notesByProduct.update((prev) => {
        if (!prev.has(product.id)) return prev;
        const cleaned = new Map(prev);
        cleaned.delete(product.id);
        return cleaned;
      });
      this.showNotesByProduct.update((prev) => {
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
    // so subtotal keeps working when the user pages away. El producto viene
    // tipado como `SellableProductOption` pero en runtime arrastra
    // `product_variants` (el picker lo exige); por eso el cast.
    const byId = new Map(this.productById());
    byId.set(product.id, product as AddItemsProductOption);
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
        // CP-POLLO-ARABE-727 C.4 (QUI-736) — para el picker de variante de
        // platos `prepared`. Sin esto el backend no incluye `product_variants`
        // y el picker no tiene nada que mostrar.
        include_variants: true,
      } as any)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          const list = (res.data ?? []) as unknown as AddItemsProductOption[];
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
