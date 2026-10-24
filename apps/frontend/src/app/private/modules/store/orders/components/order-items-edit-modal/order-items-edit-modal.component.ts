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
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { Subject, of } from 'rxjs';
import { catchError, debounceTime, distinctUntilChanged, switchMap, tap } from 'rxjs/operators';

import {
  ButtonComponent,
  IconComponent,
  ModalComponent,
  ToastService,
} from '../../../../../../shared/components';
import { CurrencyPipe } from '../../../../../../shared/pipes/currency';
import { extractApiErrorMessage } from '../../../../../../core/utils/api-error-handler';
import { Order, OrderItem } from '../../interfaces/order.interface';
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
  /** Precio base de una línea nueva (el que viaja como `unit_price`). */
  base_price: number;
  quantity: number;
  /** Producto por peso: la cantidad no se edita, solo se quita. */
  weighted: boolean;
}

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
 * QUI-650 — edición de ítems de la orden en el mismo detalle (sin ir al POS).
 * Reemplazo total vía `PUT /store/orders/:id/items`; el servidor recalcula
 * impuestos por línea y solo acepta órdenes draft/created.
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

  private readonly search$ = new Subject<string>();
  private newKeySeq = 0;
  private originalSignature = '';

  readonly estimatedTotal = computed(() =>
    round2(this.draft().reduce((sum, l) => sum + l.display_price * l.quantity, 0)),
  );
  readonly isEmpty = computed(() => this.draft().length === 0);
  readonly hasChanges = computed(() => this.signatureOf(this.draft()) !== this.originalSignature);
  /** El PUT reemplaza TODAS las líneas, incluidas las anuladas: guardar borraría su registro. */
  readonly hasCancelledLines = computed(() =>
    (this.order().order_items ?? []).some((i) => !!i.cancelled_at),
  );
  readonly canSave = computed(
    () => !this.isEmpty() && this.hasChanges() && !this.saving() && !this.hasCancelledLines(),
  );

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
  }

  // ── Borrador ────────────────────────────────────────────────────────────

  private resetDraft(): void {
    const items = (this.order().order_items ?? []).filter((i) => !i.cancelled_at);
    this.draft.set(items.map((item) => this.fromExisting(item)));
    this.originalSignature = this.signatureOf(this.draft());
    this.searchTerm.set('');
    this.searchResults.set([]);
    this.expandedProductId.set(null);
    this.saving.set(false);
  }

  private fromExisting(item: OrderItem): OrderItemDraftLine {
    const raw = item as OrderItem & { weight?: number | string | null };
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
      quantity: Number(item.quantity) || 1,
      weighted: Number(raw.weight) > 0,
    };
  }

  private signatureOf(lines: OrderItemDraftLine[]): string {
    return lines.map((l) => `${l.key}:${l.quantity}`).join('|');
  }

  increment(line: OrderItemDraftLine): void {
    this.patchLine(line.key, line.quantity + 1);
  }

  decrement(line: OrderItemDraftLine): void {
    if (line.quantity > 1) this.patchLine(line.key, line.quantity - 1);
  }

  remove(line: OrderItemDraftLine): void {
    this.draft.update((lines) => lines.filter((l) => l.key !== line.key));
  }

  private patchLine(key: string, quantity: number): void {
    this.draft.update((lines) => lines.map((l) => (l.key === key ? { ...l, quantity } : l)));
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
      // Estimado con impuesto (coherente con las líneas existentes). La variante
      // no publica precio final: cae al base.
      display_price: !variant && Number(product.final_price) > 0 ? Number(product.final_price) : price,
      base_price: price,
      quantity: 1,
      weighted: false,
    };
    this.draft.update((lines) => [...lines, line]);
  }

  // ── Payload ─────────────────────────────────────────────────────────────

  buildPayload(): { items: Record<string, unknown>[]; discount_amount: number } {
    const items = this.draft().map((line) =>
      line.existing ? this.existingPayload(line) : this.newPayload(line),
    );
    return { items, discount_amount: Number(this.order().discount_amount ?? 0) };
  }

  private existingPayload(line: OrderItemDraftLine): Record<string, unknown> {
    const raw = line.existing as OrderItem & {
      description?: string | null;
      weight?: number | string | null;
      weight_unit?: string | null;
    };
    const unitPrice = round2(Number(raw.unit_price));
    const weight = Number(raw.weight);
    const units = weight > 0 ? weight : line.quantity;
    const attrs = raw.variant_attributes as unknown;
    const payload: Record<string, unknown> = {
      item_type: raw.product_id ? 'product' : 'custom',
      product_id: raw.product_id,
      product_variant_id: raw.product_variant_id,
      product_name: raw.product_name,
      variant_sku: raw.variant_sku,
      variant_attributes:
        attrs != null && typeof attrs === 'object' ? JSON.stringify(attrs) : attrs,
      description: raw.description,
      notes: raw.notes,
      quantity: line.quantity,
      unit_price: unitPrice,
      final_unit_price:
        raw.final_unit_price != null ? round2(Number(raw.final_unit_price)) : undefined,
      weight: weight > 0 ? weight : undefined,
      weight_unit: weight > 0 ? raw.weight_unit : undefined,
      applied_price_tier_id: raw.applied_price_tier_id,
      total_price: round2(unitPrice * units),
    };
    return this.compact(payload);
  }

  private newPayload(line: OrderItemDraftLine): Record<string, unknown> {
    const unitPrice = round2(line.base_price);
    return this.compact({
      item_type: 'product',
      product_id: line.product_id,
      product_variant_id: line.product_variant_id,
      product_name: line.product_name,
      variant_sku: line.variant_sku,
      quantity: line.quantity,
      unit_price: unitPrice,
      total_price: round2(unitPrice * line.quantity),
    });
  }

  private compact(obj: Record<string, unknown>): Record<string, unknown> {
    return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== null && v !== undefined));
  }

  // ── Acciones ────────────────────────────────────────────────────────────

  save(): void {
    if (!this.canSave()) return;
    const order = this.order();
    this.saving.set(true);
    this.ordersService.updateOrderItems(String(order.id), this.buildPayload()).subscribe({
      next: (updated) => {
        this.saving.set(false);
        this.toastService.success('Productos de la orden actualizados');
        this.saved.emit(updated);
        this.isOpen.set(false);
      },
      error: (err) => {
        this.saving.set(false);
        this.toastService.error(extractApiErrorMessage(err));
      },
    });
  }

  close(): void {
    if (this.saving()) return;
    this.isOpen.set(false);
  }
}
