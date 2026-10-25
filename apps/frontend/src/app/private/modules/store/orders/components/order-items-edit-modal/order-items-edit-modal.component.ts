import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  model,
  output,
  signal,
  untracked,
} from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { Subject, merge, of } from 'rxjs';
import {
  catchError,
  debounceTime,
  distinctUntilChanged,
  map,
  switchMap,
  tap,
} from 'rxjs/operators';

import {
  ButtonComponent,
  IconComponent,
  ModalComponent,
  ToastService,
} from '../../../../../../shared/components';
import type { IconName } from '../../../../../../shared/components/icon/icons.registry';
import { CurrencyPipe } from '../../../../../../shared/pipes/currency';
import { extractApiErrorMessage } from '../../../../../../core/utils/api-error-handler';
import { parseApiError } from '../../../../../../core/utils/parse-api-error';
import {
  ItemCancellationType,
  ItemChangesDto,
  ItemChangesPreview,
  ItemChangesPreviewLine,
  ItemChangesTotals,
  Order,
  OrderItem,
} from '../../interfaces/order.interface';
import { StoreOrdersService } from '../../services/store-orders.service';
import { ProductsService } from '../../../products/services/products.service';
import {
  Product,
  ProductState,
  ProductVariant,
} from '../../../products/interfaces/product.interface';

/** Línea del borrador local. `existing` es la fila persistida (null si es nueva). */
export interface OrderItemDraftLine {
  key: string;
  existing: OrderItem | null;
  product_id: number | null;
  product_variant_id: number | null;
  product_name: string;
  variant_sku: string | null;
  variant_label: string;
  /** Precio unitario mostrado (existente: final con impuesto; nueva: base sin impuesto). */
  display_price: number;
  /** Precio base de una línea nueva. */
  base_price: number;
  quantity: number;
  /** Cantidad persistida (solo líneas existentes). */
  original_quantity: number;
  /** Producto por peso: la cantidad no se edita, solo se quita. */
  weighted: boolean;
  /** Línea existente marcada para quitar (se cancela al guardar). */
  removed: boolean;
  /** Ya se entregó al cliente: no se puede quitar ni bajar. */
  delivered: boolean;
  /** Ya está en cocina: no se reduce; quitar cancela su comanda. */
  in_kitchen: boolean;
  kitchen_ticket_number: number | null;
  kitchen_status_label: string;
  /** Línea nueva creada con "+" sobre una línea que ya estaba en cocina/entregada. */
  from_locked: boolean;
}

export interface ChipView {
  icon: IconName;
  text: string;
}

export interface TotalsRow {
  label: string;
  before: number;
  after: number;
  changed: boolean;
  strong: boolean;
}

const KDS_STATUS_ES: Record<string, string> = {
  pending: 'pendiente',
  in_preparation: 'en preparación',
  ready: 'lista',
  delivered: 'entregada',
  cancelled: 'cancelada',
};

const PREVIEW_DEBOUNCE_MS = 400;
export const VERSION_CONFLICT_CODE = 'ORD_EDIT_INVALID_STATE_001';
export const VERSION_CONFLICT_MESSAGE = 'La orden cambió mientras editabas; revisa los cambios';

const MAX_RESULTS = 20;
const SEARCH_DEBOUNCE_MS = 300;

const round2 = (value: number): number => Math.round((Number(value) + Number.EPSILON) * 100) / 100;

/** Precio base (sin impuesto) efectivo de un producto/variante. */
export function resolveBaseUnitPrice(product: Product, variant?: ProductVariant | null): number {
  if (variant) {
    if (variant.is_on_sale && Number(variant.sale_price) > 0) return Number(variant.sale_price);
    if (Number(variant.price_override) > 0) return Number(variant.price_override);
  }
  if (product.is_on_sale && Number(product.sale_price) > 0) return Number(product.sale_price);
  return Number(product.base_price) || 0;
}

function variantLabelOf(raw: unknown): string {
  if (raw == null || raw === '') return '';
  let value: unknown = raw;
  if (typeof raw === 'string') {
    try {
      value = JSON.parse(raw);
    } catch {
      return raw;
    }
  }
  if (value && typeof value === 'object') {
    return Object.values(value as Record<string, unknown>)
      .filter((v) => v != null && v !== '')
      .join(' / ');
  }
  return String(value);
}

/**
 * QUI-650 — edición de productos de la orden en el mismo detalle (sin ir al POS).
 * Trabaja por DIFERENCIAS: solo viajan las líneas tocadas
 * (`POST .../flow/items/changes[/preview]`); el preview explica las
 * consecuencias (cocina, stock, totales) antes de guardar.
 */
@Component({
  selector: 'app-order-items-edit-modal',
  standalone: true,
  imports: [FormsModule, ModalComponent, ButtonComponent, IconComponent, CurrencyPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './order-items-edit-modal.component.html',
})
export class OrderItemsEditModalComponent {
  private readonly ordersService = inject(StoreOrdersService);
  private readonly productsService = inject(ProductsService);
  private readonly toastService = inject(ToastService);

  readonly isOpen = model<boolean>(false);
  readonly order = input.required<Order>();
  readonly saved = output<Order>();

  readonly draft = signal<OrderItemDraftLine[]>([]);
  readonly saving = signal(false);
  readonly searchTerm = signal('');
  readonly searching = signal(false);
  readonly searchResults = signal<Product[]>([]);
  readonly expandedProductId = signal<number | null>(null);
  readonly reason = signal('');
  readonly cancellationTypes = signal<Record<number, ItemCancellationType>>({});
  readonly conflictMessage = signal<string | null>(null);
  private readonly previewResult = signal<{
    key: string;
    preview: ItemChangesPreview | null;
    error: string | null;
  } | null>(null);

  private readonly search$ = new Subject<string>();
  private readonly refreshPreview$ = new Subject<void>();
  private newKeySeq = 0;

  /** Líneas anuladas: solo lectura, no bloquean el guardado. */
  readonly cancelledLines = computed(() =>
    (this.order().order_items ?? []).filter((i) => !!i.cancelled_at),
  );
  readonly activeDraft = computed(() => this.draft().filter((l) => !l.removed));
  readonly isEmpty = computed(() => this.activeDraft().length === 0);

  /** Llave `add:<i>` de cada línea nueva, por su key local. */
  private readonly addKeys = computed(() => {
    const map = new Map<string, string>();
    this.draft()
      .filter((l) => !l.existing)
      .forEach((l, i) => map.set(l.key, `add:${i}`));
    return map;
  });

  /** Change-set: solo diferencias. Las líneas no tocadas no viajan. */
  readonly changeSet = computed<ItemChangesDto>(() => {
    const lines = this.draft();
    const types = this.cancellationTypes();
    const update = lines
      .filter(
        (l) =>
          l.existing &&
          !l.removed &&
          !l.weighted &&
          !l.in_kitchen &&
          !l.delivered &&
          l.quantity !== l.original_quantity,
      )
      .map((l) => ({ order_item_id: l.existing!.id, quantity: l.quantity }));
    const remove = lines
      .filter((l) => l.existing && l.removed)
      .map((l) => {
        const type = types[l.existing!.id];
        return type
          ? { order_item_id: l.existing!.id, cancellation_type: type }
          : { order_item_id: l.existing!.id };
      });
    const add = lines
      .filter((l) => !l.existing)
      .map((l) => ({
        product_id: l.product_id as number,
        ...(l.product_variant_id != null ? { product_variant_id: l.product_variant_id } : {}),
        quantity: l.quantity,
      }));
    const dto: ItemChangesDto = {};
    if (add.length) dto.add = add;
    if (update.length) dto.update = update;
    if (remove.length) dto.remove = remove;
    return dto;
  });
  private readonly changeKey = computed(() => JSON.stringify(this.changeSet()));
  readonly hasChanges = computed(() => {
    const c = this.changeSet();
    return !!(c.add?.length || c.update?.length || c.remove?.length);
  });
  readonly hasRemovals = computed(() => !!this.changeSet().remove?.length);

  // ── Preview ─────────────────────────────────────────────────────────────
  readonly preview = computed(() => this.previewResult()?.preview ?? null);
  private readonly previewIsCurrent = computed(
    () => this.previewResult()?.key === this.changeKey(),
  );
  /** Hay cambios cuyo preview aún no llega (debounce o request en vuelo). */
  readonly previewPending = computed(
    () => this.hasChanges() && !this.previewIsCurrent(),
  );
  readonly previewError = computed(() =>
    this.previewIsCurrent() ? (this.previewResult()?.error ?? null) : null,
  );
  private readonly previewByKey = computed(() => {
    const map = new Map<string, ItemChangesPreviewLine>();
    for (const l of this.preview()?.lines ?? []) map.set(l.key, l);
    return map;
  });
  readonly totalsRows = computed<TotalsRow[]>(() => {
    const t = this.preview()?.totals;
    if (!t) return [];
    const defs: Array<[string, keyof ItemChangesTotals, boolean]> = [
      ['Subtotal', 'subtotal', false],
      ['Descuento', 'discount', false],
      ['Impuesto', 'tax', false],
      ['Propina', 'tip', false],
      ['Envío', 'shipping', false],
      ['Total', 'grand_total', true],
    ];
    return defs
      .map(([label, k, strong]) => {
        const before = Number(t.before?.[k]) || 0;
        const after = Number(t.after?.[k]) || 0;
        return { label, before, after, changed: round2(before) !== round2(after), strong };
      })
      .filter((r) => r.strong || r.label === 'Subtotal' || r.before !== 0 || r.after !== 0);
  });

  // ── Validaciones de guardado ────────────────────────────────────────────
  readonly reasonValid = computed(() => !this.hasRemovals() || this.reason().trim().length >= 3);
  /** Líneas quitadas que exigen elegir qué hacer con los insumos y no lo tienen. */
  readonly missingCancellationType = computed(() => {
    const types = this.cancellationTypes();
    return this.draft().some((l) => {
      if (!l.existing || !l.removed) return false;
      const pl = this.previewByKey().get(`existing:${l.existing.id}`);
      return !!pl?.requires_cancellation_type && !types[l.existing.id];
    });
  });
  readonly canSave = computed(
    () =>
      this.hasChanges() &&
      !this.isEmpty() &&
      !this.saving() &&
      !this.previewPending() &&
      !this.previewError() &&
      this.preview()?.can_apply === true &&
      this.reasonValid() &&
      !this.missingCancellationType(),
  );

  /** Resumen de una línea bajo el botón Guardar. */
  readonly summaryParts = computed(() => {
    const p = this.preview();
    if (!p || this.previewPending()) return null;
    const cancelled = p.lines.filter((l) => l.kitchen_effect === 'cancel_ticket_item').length;
    const fired = p.lines
      .filter((l) => l.kitchen_effect === 'fire')
      .reduce((sum, l) => sum + (l.quantity_after - (l.quantity_before ?? 0)), 0);
    const texts: string[] = [];
    if (cancelled > 0) texts.push(`Se ${cancelled === 1 ? 'cancelará 1 comanda' : `cancelarán ${cancelled} comandas`}`);
    if (fired > 0) texts.push(`${fired} ${fired === 1 ? 'plato irá' : 'platos irán'} a cocina`);
    return {
      texts,
      before: Number(p.totals?.before?.grand_total) || 0,
      after: Number(p.totals?.after?.grand_total) || 0,
    };
  });

  constructor() {
    effect(() => {
      if (this.isOpen()) {
        untracked(() => this.resetDraft());
      }
    });

    this.search$
      .pipe(
        debounceTime(SEARCH_DEBOUNCE_MS),
        distinctUntilChanged(),
        tap((term) => {
          if (!term) this.searchResults.set([]);
          this.searching.set(!!term);
        }),
        switchMap((term) =>
          term
            ? this.productsService
                .getProducts({
                  search: term,
                  limit: MAX_RESULTS,
                  state: ProductState.ACTIVE,
                  include_variants: true,
                })
                .pipe(catchError(() => of(null)))
            : of(null),
        ),
        takeUntilDestroyed(),
      )
      .subscribe((response) => {
        this.searching.set(false);
        if (response) this.searchResults.set(response.data ?? []);
      });

    // Preview dinámico: debounce ante cambios, switchMap cancela el request anterior.
    merge(
      toObservable(this.changeKey).pipe(debounceTime(PREVIEW_DEBOUNCE_MS)),
      this.refreshPreview$.pipe(map(() => untracked(() => this.changeKey()))),
    )
      .pipe(
        switchMap((key) => {
          if (!untracked(() => this.hasChanges())) {
            return of({ key, preview: null, error: null });
          }
          const dto = untracked(() => this.changeSet());
          return this.ordersService.previewItemChanges(untracked(() => this.order().id), dto).pipe(
            map((preview) => ({ key, preview, error: null as string | null })),
            catchError((err) =>
              of({ key, preview: null, error: extractApiErrorMessage(err) as string | null }),
            ),
          );
        }),
        takeUntilDestroyed(),
      )
      .subscribe((result) => {
        // Descarta resultados de una llave que ya no es la actual.
        if (result.key === untracked(() => this.changeKey())) this.previewResult.set(result);
      });
  }

  // ── Borrador ────────────────────────────────────────────────────────────

  private resetDraft(): void {
    const items = (this.order().order_items ?? []).filter((i) => !i.cancelled_at);
    this.draft.set(items.map((item) => this.fromExisting(item)));
    this.reason.set('');
    this.cancellationTypes.set({});
    this.conflictMessage.set(null);
    this.previewResult.set(null);
    this.searchTerm.set('');
    this.searchResults.set([]);
    this.expandedProductId.set(null);
    this.saving.set(false);
  }

  private fromExisting(item: OrderItem): OrderItemDraftLine {
    const raw = item as OrderItem & { weight?: number | string | null };
    // Las filas KDS vienen ordenadas desc: la vigente es la primera.
    const last = item.kitchen_ticket_items?.[0];
    const liveKds = !!last && last.status !== 'delivered' && last.status !== 'cancelled';
    const inKitchen = item.inventory_consumed_at_fire === true || liveKds;
    const quantity = Number(item.quantity) || 1;
    return {
      key: `e-${item.id}`,
      existing: item,
      product_id: item.product_id ?? null,
      product_variant_id: item.product_variant_id ?? null,
      product_name: item.product_name,
      variant_sku: item.variant_sku ?? null,
      variant_label: variantLabelOf(item.variant_attributes),
      display_price: Number(item.final_unit_price ?? item.unit_price) || 0,
      base_price: Number(item.unit_price) || 0,
      quantity,
      original_quantity: quantity,
      weighted: Number(raw.weight) > 0,
      removed: false,
      delivered: !!item.delivered_at,
      in_kitchen: inKitchen,
      kitchen_ticket_number: last?.kitchen_ticket?.daily_number ?? null,
      kitchen_status_label: last ? (KDS_STATUS_ES[last.status] ?? last.status) : 'enviado',
      from_locked: false,
    };
  }

  /** La línea no admite cambiar su cantidad en sitio (cocina o entregada). */
  isLocked(line: OrderItemDraftLine): boolean {
    return !!line.existing && (line.in_kitchen || line.delivered);
  }

  increment(line: OrderItemDraftLine): void {
    if (line.removed) return;
    if (this.isLocked(line)) {
      // No se toca la línea existente: se crea/incrementa una nueva del mismo producto.
      this.addToNewLine(line);
      return;
    }
    this.patchLine(line.key, line.quantity + 1);
  }

  decrement(line: OrderItemDraftLine): void {
    if (line.removed || this.isLocked(line)) return;
    if (line.quantity > 1) this.patchLine(line.key, line.quantity - 1);
  }

  remove(line: OrderItemDraftLine): void {
    if (!line.existing) {
      this.draft.update((lines) => lines.filter((l) => l.key !== line.key));
      return;
    }
    if (line.delivered) return;
    this.draft.update((lines) => lines.map((l) => (l.key === line.key ? { ...l, removed: true } : l)));
  }

  restore(line: OrderItemDraftLine): void {
    this.draft.update((lines) => lines.map((l) => (l.key === line.key ? { ...l, removed: false } : l)));
    if (line.existing) {
      this.cancellationTypes.update((t) => {
        const { [line.existing!.id]: _drop, ...rest } = t;
        return rest;
      });
    }
  }

  private addToNewLine(source: OrderItemDraftLine): void {
    const same = this.draft().find(
      (l) =>
        !l.existing &&
        l.product_id === source.product_id &&
        l.product_variant_id === source.product_variant_id,
    );
    if (same) {
      this.patchLine(same.key, same.quantity + 1);
      return;
    }
    const line: OrderItemDraftLine = {
      ...source,
      key: `n-${++this.newKeySeq}`,
      existing: null,
      quantity: 1,
      original_quantity: 0,
      weighted: false,
      removed: false,
      delivered: false,
      in_kitchen: false,
      kitchen_ticket_number: null,
      kitchen_status_label: '',
      from_locked: true,
    };
    this.draft.update((lines) => [...lines, line]);
  }

  private patchLine(key: string, quantity: number): void {
    this.draft.update((lines) => lines.map((l) => (l.key === key ? { ...l, quantity } : l)));
  }

  setCancellationType(line: OrderItemDraftLine, type: ItemCancellationType): void {
    if (!line.existing) return;
    const id = line.existing.id;
    this.cancellationTypes.update((t) => ({ ...t, [id]: type }));
  }

  // ── Búsqueda / agregar ──────────────────────────────────────────────────

  onSearchInput(term: string): void {
    this.searchTerm.set(term);
    this.expandedProductId.set(null);
    this.search$.next((term ?? '').trim());
  }

  hasVariants(product: Product): boolean {
    return (product.product_variants?.length ?? 0) > 0;
  }

  isSellable(product: Product): boolean {
    return product.is_sellable !== false;
  }

  onProductClick(product: Product): void {
    if (!this.isSellable(product)) return;
    if (this.hasVariants(product)) {
      this.expandedProductId.update((id) => (id === product.id ? null : product.id));
      return;
    }
    this.addProduct(product, null);
  }

  /** Precio base mostrado en el resultado (variante o producto). */
  priceOf(product: Product, variant?: ProductVariant | null): number {
    return resolveBaseUnitPrice(product, variant);
  }

  variantName(variant: ProductVariant): string {
    return variant.name || variantLabelOf(variant.attributes) || variant.sku;
  }

  addProduct(product: Product, variant: ProductVariant | null): void {
    if (!this.isSellable(product)) return;
    if (this.hasVariants(product) && !variant) return;

    const variantId = variant?.id ?? null;
    const same = this.draft().find(
      (l) => !l.existing && l.product_id === product.id && l.product_variant_id === variantId,
    );
    if (same) {
      this.patchLine(same.key, same.quantity + 1);
      return;
    }
    const price = resolveBaseUnitPrice(product, variant);
    const line: OrderItemDraftLine = {
      key: `n-${++this.newKeySeq}`,
      existing: null,
      product_id: product.id,
      product_variant_id: variantId,
      product_name: product.name,
      variant_sku: variant?.sku ?? null,
      variant_label: variant ? this.variantName(variant) : '',
      display_price: !variant && Number(product.final_price) > 0 ? Number(product.final_price) : price,
      base_price: price,
      quantity: 1,
      original_quantity: 0,
      weighted: false,
      removed: false,
      delivered: false,
      in_kitchen: false,
      kitchen_ticket_number: null,
      kitchen_status_label: '',
      from_locked: false,
    };
    this.draft.update((lines) => [...lines, line]);
  }

  // ── Preview por línea (para el template) ────────────────────────────────

  previewFor(line: OrderItemDraftLine): ItemChangesPreviewLine | null {
    const key = line.existing ? `existing:${line.existing.id}` : this.addKeys().get(line.key);
    return (key && this.previewByKey().get(key)) || null;
  }

  kitchenChip(pl: ItemChangesPreviewLine): ChipView | null {
    if (pl.kitchen_effect === 'fire') return { icon: 'chef-hat', text: 'Irá a cocina al guardar' };
    if (pl.kitchen_effect === 'cancel_ticket_item') {
      return {
        icon: 'ban',
        text: pl.kitchen_ticket_number
          ? `Se cancelará la comanda #${pl.kitchen_ticket_number}`
          : 'Se cancelará su comanda',
      };
    }
    return null;
  }

  stockChip(pl: ItemChangesPreviewLine): ChipView | null {
    switch (pl.stock_effect) {
      case 'reserve':
        return { icon: 'package', text: 'Se reservará stock' };
      case 'release':
        return { icon: 'package', text: 'Se liberará la reserva de stock' };
      case 'ingredients_reused':
        return { icon: 'package', text: 'Los insumos se reutilizan' };
      case 'ingredients_wasted':
        return { icon: 'package', text: 'Los insumos se desechan' };
      case 'ingredients_consumed':
        return { icon: 'package', text: 'Se descontarán los insumos' };
      default:
        return null;
    }
  }

  // ── Acciones ────────────────────────────────────────────────────────────

  save(): void {
    if (!this.canSave()) return;
    const order = this.order();
    const preview = this.preview()!;
    const dto: ItemChangesDto = {
      ...this.changeSet(),
      expected_version: preview.version,
      ...(this.hasRemovals() ? { reason: this.reason().trim() } : {}),
    };
    this.saving.set(true);
    this.conflictMessage.set(null);
    this.ordersService.applyItemChanges(order.id, dto).subscribe({
      next: (result) => {
        this.saving.set(false);
        if (!result?.order) {
          this.toastService.error('No se pudo confirmar el guardado de los cambios');
          return;
        }
        this.toastService.success('Productos de la orden actualizados');
        this.saved.emit(result.order);
        this.isOpen.set(false);
      },
      error: (err) => {
        this.saving.set(false);
        const code = (err as { errorCode?: string | null })?.errorCode ?? parseApiError(err).errorCode;
        if (code === VERSION_CONFLICT_CODE) {
          this.conflictMessage.set(VERSION_CONFLICT_MESSAGE);
          this.toastService.error(VERSION_CONFLICT_MESSAGE);
          this.previewResult.set(null);
          this.refreshPreview$.next();
          return;
        }
        this.toastService.error(extractApiErrorMessage(err));
      },
    });
  }

  close(): void {
    if (this.saving()) return;
    this.isOpen.set(false);
  }
}
