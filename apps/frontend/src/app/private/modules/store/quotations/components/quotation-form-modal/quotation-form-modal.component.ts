import { Component, computed, inject, input, output, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { FormArray, FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { Subject, debounceTime, distinctUntilChanged, switchMap, of, catchError, map } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { environment } from '../../../../../../../environments/environment';
import { Quotation, CreateQuotationDto } from '../../interfaces/quotation.interface';
import { PosProductService, Product } from '../../../pos/services/pos-product.service';
import { CurrencyPipe } from '../../../../../../shared/pipes/currency/currency.pipe';
import {
  ModalComponent,
  ButtonComponent,
  InputComponent,
  TextareaComponent,
  IconComponent,
} from '../../../../../../shared/components';
import {
  PriceTier,
  ProductPriceTierOverride,
  PriceTierCacheService,
  PriceTierSelectorComponent,
} from '../../../price-tiers';
import { PriceResolverService } from '../../../../../../shared/services/pricing';
import { AuthFacade } from '../../../../../../core/store/auth/auth.facade';

@Component({
  selector: 'app-quotation-form-modal',
  standalone: true,
  imports: [
    DecimalPipe,
    ReactiveFormsModule,
    ModalComponent,
    ButtonComponent,
    InputComponent,
    TextareaComponent,
    IconComponent,
    CurrencyPipe,
    PriceTierSelectorComponent,
  ],
  template: `
    <app-modal
      [isOpen]="true"
      [title]="modalTitle()"
      size="lg"
      (cancel)="onClose()"
    >
      <div class="p-4">
        <form [formGroup]="form" class="space-y-4">

          <!-- Customer Search -->
          <div class="space-y-1">
            <label class="text-sm font-medium text-text-primary">Cliente (opcional)</label>

            @if (selectedCustomer()) {
              <div class="flex items-center justify-between rounded-md px-3 py-2 text-sm"
                   style="background: var(--color-background); border: 1px solid var(--color-border);">
                <span>{{ selectedCustomer()!.first_name }} {{ selectedCustomer()!.last_name }}</span>
                <button
                  type="button"
                  aria-label="Quitar cliente"
                  class="flex items-center justify-center rounded-md transition-colors"
                  style="min-width: 44px; min-height: 44px; color: var(--color-text-secondary);"
                  (click)="removeCustomer()"
                >
                  <app-icon name="x" [size]="16"></app-icon>
                </button>
              </div>
            } @else {
              <div class="relative">
                <input
                  type="text"
                  class="w-full rounded-md border px-3 py-2 text-sm"
                  style="border-color: var(--color-border); background: var(--color-surface); color: var(--color-text-primary); font-size: 16px;"
                  placeholder="Buscar cliente..."
                  [value]="customerSearchTerm()"
                  (input)="onCustomerSearchInput($event)"
                />
                @if (customerResults().length > 0) {
                  <div
                    role="listbox"
                    class="absolute left-0 right-0 top-full z-10 max-h-[200px] overflow-y-auto rounded-b-md border border-t-0 shadow-sm"
                    style="background: var(--color-surface); border-color: var(--color-border);"
                  >
                    @for (customer of customerResults(); track customer.id) {
                      <button
                        type="button"
                        role="option"
                        class="w-full cursor-pointer px-3 py-2 text-left text-sm transition-colors hover:opacity-80"
                        style="color: var(--color-text-primary);"
                        (click)="selectCustomer(customer)"
                      >
                        {{ customer.first_name }} {{ customer.last_name }}
                        @if (customer.email) {
                          <span class="ml-1" style="color: var(--color-text-secondary);">- {{ customer.email }}</span>
                        }
                      </button>
                    }
                  </div>
                }
              </div>
            }
          </div>

          <!-- Valid Until -->
          <app-input
            label="Válida hasta"
            type="date"
            formControlName="valid_until"
            [control]="form.get('valid_until')"
          ></app-input>

          <!-- Product Search -->
          <div class="space-y-1">
            <label class="text-sm font-medium text-text-primary">Agregar producto</label>
            <div class="relative">
              <input
                type="text"
                class="w-full rounded-md border px-3 py-2 text-sm"
                style="border-color: var(--color-border); background: var(--color-surface); color: var(--color-text-primary); font-size: 16px;"
                placeholder="Buscar producto..."
                [value]="productSearchTerm()"
                (input)="onProductSearchInput($event)"
              />
              @if (productResults().length > 0) {
                <div
                  role="listbox"
                  class="absolute left-0 right-0 top-full z-10 max-h-[200px] overflow-y-auto rounded-b-md border border-t-0 shadow-sm"
                  style="background: var(--color-surface); border-color: var(--color-border);"
                >
                  @for (product of productResults(); track product.id) {
                    <button
                      type="button"
                      role="option"
                      class="w-full cursor-pointer px-3 py-2 text-left text-sm transition-colors hover:opacity-80"
                      style="color: var(--color-text-primary);"
                      (click)="addProduct(product)"
                    >
                      <div class="flex items-center gap-2">
                        @if (product.image_url) {
                          <img [src]="product.image_url" class="w-8 h-8 rounded object-cover flex-shrink-0" />
                        }
                        <div class="min-w-0 flex-1">
                          <span class="truncate block">{{ product.name }}</span>
                          <span class="text-xs" style="color: var(--color-text-secondary);">
                            {{ product.price | currency }}
                            @if (product.has_variants) {
                              · {{ product.product_variants.length }} variantes
                            }
                          </span>
                        </div>
                      </div>
                    </button>
                  }
                </div>
              }
            </div>
          </div>

          <!-- Variant Selection -->
          @if (pendingVariantProduct()) {
            <div class="rounded-md border p-3 space-y-2" style="border-color: var(--color-border); background: var(--color-background);">
              <div class="flex items-center justify-between">
                <span class="text-sm font-medium" style="color: var(--color-text-primary);">
                  Seleccionar variante de {{ pendingVariantProduct()!.name }}
                </span>
                <button type="button" aria-label="Cancelar selección"
                  class="flex items-center justify-center rounded-md transition-colors"
                  style="min-width: 44px; min-height: 44px; color: var(--color-text-secondary);"
                  (click)="cancelVariantSelection()">
                  <app-icon name="x" [size]="16"></app-icon>
                </button>
              </div>
              <div class="space-y-1 max-h-[200px] overflow-y-auto">
                @for (variant of pendingVariantProduct()!.product_variants; track variant.id) {
                  @if (variant.is_active) {
                    <button type="button"
                      class="w-full cursor-pointer px-3 py-2 text-left text-sm rounded transition-colors hover:opacity-80"
                      style="color: var(--color-text-primary); border: 1px solid var(--color-border);"
                      (click)="selectVariant(variant)">
                      <div class="flex items-center justify-between">
                        <div>
                          <span class="font-medium">
                            {{ getVariantLabel(variant) }}
                          </span>
                          @if (variant.sku) {
                            <span class="text-xs ml-1" style="color: var(--color-text-secondary);">SKU: {{ variant.sku }}</span>
                          }
                        </div>
                        <span class="font-mono text-sm">
                          {{ (variant.price_override ?? pendingVariantProduct()!.price) | currency }}
                        </span>
                      </div>
                    </button>
                  }
                }
              </div>
            </div>
          }

          <!-- Items List -->
          @if (itemsArray.length > 0) {
            <div class="space-y-2">
              <label class="text-sm font-medium text-text-primary">Productos ({{ itemsArray.length }})</label>

              <div formArrayName="items" class="space-y-1">
                @for (itemGroup of itemsArray.controls; track $index; let i = $index) {
                  <div
                    [formGroupName]="i"
                    class="flex items-center gap-2 rounded-md border p-2"
                    style="border-color: var(--color-border);"
                  >
                    <div class="flex min-w-0 flex-1 flex-col gap-1">
                      <span class="truncate text-sm font-medium" style="color: var(--color-text-primary);">
                        {{ itemGroup.get('product_name')?.value }}
                      </span>
                      @if (itemGroup.get('variant_sku')?.value) {
                        <span class="text-xs" style="color: var(--color-text-secondary);">
                          {{ itemGroup.get('variant_sku')?.value }}
                        </span>
                      }
                      @if (itemGroup.get('tax_rate')?.value > 0) {
                        <span class="text-xs" style="color: var(--color-text-secondary);">
                          IVA: {{ (itemGroup.get('tax_rate')?.value * 100) | number:'1.0-0' }}%
                        </span>
                      }
                      @if (canShowTierSelector(asFormGroup(itemGroup))) {
                        <div class="mt-0.5">
                          <app-price-tier-selector
                            [tiers]="visibleTiersForItem(asFormGroup(itemGroup))"
                            [selectedTierId]="getItemTierId(asFormGroup(itemGroup))"
                            [unitsPerPackage]="getItemUnitsPerPackage(asFormGroup(itemGroup))"
                            (selectedTierIdChange)="onTierChange(i, $event)"
                          ></app-price-tier-selector>
                        </div>
                      } @else if (itemGroup.get('applied_price_tier_name')?.value) {
                        <span
                          class="inline-flex items-center px-1 py-0.5 rounded text-[10px] font-semibold bg-amber-100 text-amber-800 w-fit"
                        >
                          {{ itemGroup.get('applied_price_tier_name')?.value }}
                        </span>
                      }
                    </div>

                    <div class="flex items-center gap-2">
                      <input
                        type="number"
                        formControlName="quantity"
                        min="1"
                        class="w-[60px] rounded border px-2 py-1 text-center text-sm"
                        style="border-color: var(--color-border); background: var(--color-surface); color: var(--color-text-primary); font-size: 16px;"
                        (change)="recalculateItem(i)"
                      />

                      <span class="whitespace-nowrap text-xs" style="color: var(--color-text-secondary);">
                        {{ itemGroup.get('unit_price')?.value | currency }}
                      </span>

                      <span class="whitespace-nowrap font-mono text-sm font-semibold" style="color: var(--color-text-primary);">
                        {{ itemGroup.get('total_price')?.value | currency }}
                      </span>

                      <button
                        type="button"
                        aria-label="Eliminar item"
                        class="flex items-center justify-center rounded-md transition-colors"
                        style="min-width: 44px; min-height: 44px; color: var(--color-destructive);"
                        (click)="removeItem(i)"
                      >
                        <app-icon name="trash-2" [size]="16"></app-icon>
                      </button>
                    </div>
                  </div>
                }
              </div>

              <div class="mt-2 border-t-2 pt-3 space-y-1"
                   style="border-color: var(--color-border); color: var(--color-text-primary);">
                <div class="flex justify-between text-sm">
                  <span style="color: var(--color-text-secondary);">Subtotal</span>
                  <span class="font-mono">{{ subtotalAmount() | currency }}</span>
                </div>
                @if (taxAmount() > 0) {
                  <div class="flex justify-between text-sm">
                    <span style="color: var(--color-text-secondary);">Impuestos</span>
                    <span class="font-mono">{{ taxAmount() | currency }}</span>
                  </div>
                }
                <div class="flex justify-between text-base font-bold">
                  <span>Total</span>
                  <span class="font-mono">{{ grandTotal() | currency }}</span>
                </div>
              </div>
            </div>
          }

          <!-- Notes -->
          <app-textarea
            label="Notas"
            formControlName="notes"
            [control]="form.get('notes')"
            [rows]="2"
            placeholder="Notas visibles para el cliente..."
          ></app-textarea>

          <app-textarea
            label="Notas internas"
            formControlName="internal_notes"
            [control]="form.get('internal_notes')"
            [rows]="2"
            placeholder="Notas internas del equipo..."
          ></app-textarea>

          <app-textarea
            label="Términos y condiciones"
            formControlName="terms_and_conditions"
            [control]="form.get('terms_and_conditions')"
            [rows]="2"
            placeholder="Condiciones de la cotización..."
          ></app-textarea>
        </form>
      </div>

      <!-- Footer -->
      <div slot="footer">
        <div class="flex items-center justify-end gap-3 rounded-b-xl border-t p-3"
             style="background: var(--color-background); border-color: var(--color-border);">
          <app-button variant="outline" (clicked)="onClose()">
            Cancelar
          </app-button>
          <app-button
            variant="primary"
            (clicked)="onSave()"
            [disabled]="itemsArray.length === 0"
            [loading]="isSaving()"
          >
            {{ quotation() ? 'Actualizar' : 'Crear' }} Cotización
          </app-button>
        </div>
      </div>
    </app-modal>
  `,
})
export class QuotationFormModalComponent {
  /** Input: existing quotation for edit mode, null for create mode */
  readonly quotation = input<Quotation | null>(null);

  /** Output: emits the DTO when the user clicks save */
  readonly save = output<CreateQuotationDto>();

  /** Output: emits when the user wants to close the modal */
  readonly close = output<void>();

  private readonly fb = inject(FormBuilder);
  private readonly http = inject(HttpClient);
  private readonly posProductService = inject(PosProductService);
  private readonly priceTierCache = inject(PriceTierCacheService);
  private readonly priceResolver = inject(PriceResolverService);
  private readonly authFacade = inject(AuthFacade);
  private readonly apiUrl = environment.apiUrl;

  /** Active tiers loaded once when the modal opens (if user has permission). */
  readonly availableTiers = signal<PriceTier[]>([]);
  /** Per-product overrides cache (product_id → rows). */
  readonly productOverrides = signal<Record<number, ProductPriceTierOverride[]>>({});
  /** Snapshot of the product per item, used by the resolver when recomputing. */
  private readonly itemProductCache = new Map<number, Product>();

  readonly canApplyPricingTier = computed(() =>
    this.authFacade.userPermissions().includes('store:products:apply_pricing_tier') ||
    this.authFacade.userRoles().includes('super_admin') ||
    this.authFacade.userRoles().includes('SUPER_ADMIN'),
  );

  /** Reactive form */
  readonly form: FormGroup = this.fb.group({
    valid_until: [''],
    notes: [''],
    internal_notes: [''],
    terms_and_conditions: [''],
    items: this.fb.array([]),
  });

  /** Signals for search state */
  readonly customerSearchTerm = signal('');
  readonly customerResults = signal<any[]>([]);
  readonly selectedCustomer = signal<any>(null);

  readonly productSearchTerm = signal('');
  readonly productResults = signal<any[]>([]);

  /** Variant selection */
  readonly pendingVariantProduct = signal<any>(null);
  readonly selectedVariantId = signal<number | null>(null);

  readonly isSaving = signal(false);

  /** Summary signals — updated manually when items change */
  readonly subtotalAmount = signal(0);
  readonly taxAmount = signal(0);
  readonly grandTotal = signal(0);

  readonly modalTitle = computed(() =>
    this.quotation() ? 'Editar Cotización' : 'Nueva Cotización'
  );

  /** RxJS subjects for debounced search */
  private readonly customerSearch$ = new Subject<string>(); // LEGÍTIMO — debounceTime+switchMap customer search
  private readonly productSearch$ = new Subject<string>(); // LEGÍTIMO — debounceTime+switchMap product search

  get itemsArray(): FormArray {
    return this.form.get('items') as FormArray;
  }

  constructor() {
    // Load active tiers once. Permission gate keeps the request out for users
    // who would never see the selector anyway.
    if (this.canApplyPricingTier()) {
      this.priceTierCache
        .getActiveTiers()
        .pipe(takeUntilDestroyed())
        .subscribe({
          next: (tiers) => this.availableTiers.set(tiers || []),
          error: () => this.availableTiers.set([]),
        });
    }

    // Customer search with debounce
    this.customerSearch$
      .pipe(
        debounceTime(300),
        distinctUntilChanged(),
        switchMap((term) => {
          if (term.length < 2) return of([]);
          return this.http
            .get<any>(`${this.apiUrl}/store/customers?search=${term}&limit=5`)
            .pipe(
              catchError(() => of({ data: [] })),
            );
        }),
        takeUntilDestroyed(),
      )
      .subscribe((res) => {
        const data = res?.data?.data || res?.data || res || [];
        this.customerResults.set(Array.isArray(data) ? data : []);
      });

    // Product search with debounce using PosProductService
    this.productSearch$
      .pipe(
        debounceTime(300),
        distinctUntilChanged(),
        switchMap((term) => {
          if (term.length < 2) return of([] as any[]);
          return this.posProductService.searchProducts({ query: term }, 1, 10).pipe(
            map((result: any) => result.products as any[]),
            catchError(() => of([] as any[])),
          );
        }),
        takeUntilDestroyed(),
      )
      .subscribe((products) => {
        this.productResults.set(products);
      });

    // Populate form when editing an existing quotation
    const q = this.quotation();
    if (q) {
      this.selectedCustomer.set(q.customer || null);
      this.form.patchValue({
        valid_until: q.valid_until ? q.valid_until.split('T')[0] : '',
        notes: q.notes || '',
        internal_notes: q.internal_notes || '',
        terms_and_conditions: q.terms_and_conditions || '',
      });

      q.quotation_items.forEach((item) => {
        const anyItem = item as any;
        this.itemsArray.push(this.createItemGroup({
          product_id: item.product_id || undefined,
          product_variant_id: item.product_variant_id || undefined,
          product_name: item.product_name,
          variant_sku: item.variant_sku || undefined,
          quantity: item.quantity,
          unit_price: Number(item.unit_price),
          discount_amount: Number(item.discount_amount),
          tax_rate: item.tax_rate ? Number(item.tax_rate) : 0,
          tax_amount_item: item.tax_amount_item ? Number(item.tax_amount_item) : 0,
          total_price: Number(item.total_price),
          applied_price_tier_id: anyItem.applied_price_tier_id ?? null,
          applied_price_tier_name: anyItem.applied_price_tier_name_snapshot ?? null,
          has_multiple_price_tiers: anyItem.product?.has_multiple_price_tiers === true,
          enabled_price_tier_ids: anyItem.product?.enabled_price_tier_ids ?? [],
          units_per_package: anyItem.product?.units_per_package ?? null,
          base_price: Number(anyItem.product?.base_price ?? item.unit_price),
        }));
      });
      this.recalculateGrandTotal();
    }
  }

  // ── Customer Search ──

  onCustomerSearchInput(event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    this.customerSearchTerm.set(value);
    this.customerSearch$.next(value);
  }

  selectCustomer(customer: any): void {
    this.selectedCustomer.set(customer);
    this.customerSearchTerm.set('');
    this.customerResults.set([]);
  }

  removeCustomer(): void {
    this.selectedCustomer.set(null);
  }

  // ── Product Search ──

  onProductSearchInput(event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    this.productSearchTerm.set(value);
    this.productSearch$.next(value);
  }

  addProduct(product: any): void {
    if (product.has_variants && product.product_variants?.length > 0) {
      this.pendingVariantProduct.set(product);
      this.selectedVariantId.set(null);
      this.productSearchTerm.set('');
      this.productResults.set([]);
      return;
    }
    this.addProductWithVariant(product, null);
  }

  addProductWithVariant(product: any, variant: any): void {
    const basePrice = variant?.price_override ?? product.price;
    const taxRate = this.calculateRateSum(product);
    const taxAmountItem = basePrice * taxRate;
    const totalPrice = basePrice;

    const productId = Number(product.id);
    if (Number.isFinite(productId)) {
      this.itemProductCache.set(productId, product);
      // Pre-fetch overrides only if the product actually supports multi-tarifa.
      if (product.has_multiple_price_tiers === true && this.canApplyPricingTier()) {
        this.ensureProductOverridesLoaded(productId);
      }
    }

    this.itemsArray.push(this.createItemGroup({
      product_id: productId,
      product_variant_id: variant?.id,
      product_name: product.name,
      variant_sku: variant?.sku || product.sku,
      quantity: 1,
      unit_price: basePrice,
      tax_rate: taxRate,
      tax_amount_item: taxAmountItem,
      total_price: totalPrice,
      has_multiple_price_tiers: product.has_multiple_price_tiers === true,
      enabled_price_tier_ids: product.enabled_price_tier_ids ?? [],
      units_per_package: product.units_per_package ?? null,
      base_price: Number(product.price ?? basePrice),
    }));

    this.pendingVariantProduct.set(null);
    this.selectedVariantId.set(null);
    this.productSearchTerm.set('');
    this.productResults.set([]);
    this.recalculateGrandTotal();
  }

  selectVariant(variant: any): void {
    const product = this.pendingVariantProduct();
    if (!product) return;
    this.addProductWithVariant(product, variant);
  }

  cancelVariantSelection(): void {
    this.pendingVariantProduct.set(null);
    this.selectedVariantId.set(null);
  }

  getVariantLabel(variant: any): string {
    return variant.attributes?.map((a: any) => a.attribute_value).join(' / ') || variant.sku || 'Variante';
  }

  // ── Items Management ──

  removeItem(index: number): void {
    this.itemsArray.removeAt(index);
    this.recalculateGrandTotal();
  }

  recalculateItem(index: number): void {
    const group = this.itemsArray.at(index) as FormGroup;
    const qty = Number(group.get('quantity')?.value || 0);
    const price = Number(group.get('unit_price')?.value || 0);
    const discount = Number(group.get('discount_amount')?.value || 0);
    const taxRate = Number(group.get('tax_rate')?.value || 0);
    const taxAmountItem = price * qty * taxRate;
    const totalPrice = price * qty - discount;
    group.patchValue({
      total_price: totalPrice,
      tax_amount_item: taxAmountItem,
    });
    this.recalculateGrandTotal();
  }

  private recalculateGrandTotal(): void {
    let subtotal = 0;
    let tax = 0;
    for (let i = 0; i < this.itemsArray.length; i++) {
      subtotal += Number(this.itemsArray.at(i).get('total_price')?.value || 0);
      tax += Number(this.itemsArray.at(i).get('tax_amount_item')?.value || 0);
    }
    this.subtotalAmount.set(subtotal);
    this.taxAmount.set(tax);
    this.grandTotal.set(subtotal + tax);
  }

  private calculateRateSum(product: any): number {
    return (
      product.tax_assignments?.reduce((rateSum: number, assignment: any) => {
        const assignmentRate =
          assignment.tax_categories?.tax_rates?.reduce(
            (sum: number, tr: any) => sum + parseFloat(tr.rate || '0'),
            0,
          ) || 0;
        return rateSum + assignmentRate;
      }, 0) || 0
    );
  }

  // ── Save ──

  onSave(): void {
    if (this.itemsArray.length === 0) return;

    this.isSaving.set(true);

    const formValue = this.form.value;
    const dto: CreateQuotationDto = {
      customer_id: this.selectedCustomer()?.id,
      valid_until: formValue.valid_until || undefined,
      notes: formValue.notes || undefined,
      internal_notes: formValue.internal_notes || undefined,
      terms_and_conditions: formValue.terms_and_conditions || undefined,
      items: formValue.items.map((item: any) => ({
        product_id: item.product_id || undefined,
        product_variant_id: item.product_variant_id || undefined,
        product_name: item.product_name,
        variant_sku: item.variant_sku || undefined,
        quantity: item.quantity,
        unit_price: item.unit_price,
        discount_amount: item.discount_amount || 0,
        tax_rate: item.tax_rate || 0,
        tax_amount_item: item.tax_amount_item || 0,
        total_price: item.total_price,
        // Multi-tarifa: send tier id only when set (backend validates permission).
        applied_price_tier_id:
          item.applied_price_tier_id != null
            ? Number(item.applied_price_tier_id)
            : undefined,
      })),
    };

    this.save.emit(dto);
    // Parent handles the API call; reset saving state after emit.
    // If parent needs async feedback, it can control the modal visibility.
    this.isSaving.set(false);
  }

  onClose(): void {
    this.close.emit();
  }

  // ── Private Helpers ──

  private createItemGroup(item: {
    product_id?: number;
    product_variant_id?: number;
    product_name: string;
    variant_sku?: string;
    quantity: number;
    unit_price: number;
    discount_amount?: number;
    tax_rate?: number;
    tax_amount_item?: number;
    total_price: number;
    applied_price_tier_id?: number | null;
    applied_price_tier_name?: string | null;
    has_multiple_price_tiers?: boolean;
    enabled_price_tier_ids?: number[];
    units_per_package?: number | null;
    base_price?: number;
  }): FormGroup {
    return this.fb.group({
      product_id: [item.product_id],
      product_variant_id: [item.product_variant_id],
      product_name: [item.product_name, Validators.required],
      variant_sku: [item.variant_sku],
      quantity: [item.quantity, [Validators.required, Validators.min(1)]],
      unit_price: [item.unit_price, [Validators.required, Validators.min(0)]],
      discount_amount: [item.discount_amount || 0],
      tax_rate: [item.tax_rate || 0],
      tax_amount_item: [item.tax_amount_item || 0],
      total_price: [item.total_price],
      // Multi-tarifa (Phase 5)
      applied_price_tier_id: [item.applied_price_tier_id ?? null],
      applied_price_tier_name: [item.applied_price_tier_name ?? null],
      has_multiple_price_tiers: [item.has_multiple_price_tiers ?? false],
      enabled_price_tier_ids: [item.enabled_price_tier_ids ?? []],
      units_per_package: [item.units_per_package ?? null],
      base_price: [item.base_price ?? item.unit_price],
    });
  }

  // ── Multi-tarifa (Phase 5) ──

  /** Template helper: narrow `AbstractControl` to `FormGroup`. */
  asFormGroup(control: any): FormGroup {
    return control as FormGroup;
  }

  /** Whether the row should expose a tier selector. */
  canShowTierSelector(itemGroup: FormGroup): boolean {
    return (
      !!itemGroup.get('has_multiple_price_tiers')?.value &&
      this.canApplyPricingTier() &&
      this.visibleTiersForItem(itemGroup).length > 0
    );
  }

  visibleTiersForItem(itemGroup: FormGroup): PriceTier[] {
    const enabledIds = itemGroup.get('enabled_price_tier_ids')?.value ?? [];
    if (!Array.isArray(enabledIds) || enabledIds.length === 0) return [];
    const enabled = new Set(enabledIds.map(Number));
    return this.availableTiers().filter((tier) => enabled.has(tier.id));
  }

  getItemTierId(itemGroup: FormGroup): number | null {
    const v = itemGroup.get('applied_price_tier_id')?.value;
    return v == null ? null : Number(v);
  }

  getItemUnitsPerPackage(itemGroup: FormGroup): number | null {
    const v = itemGroup.get('units_per_package')?.value;
    return v == null ? null : Number(v);
  }

  /**
   * Apply (or clear) a tier on a quotation item: re-resolves unit_price via
   * PriceResolverService and persists the choice in the form group so it is
   * sent to the backend on save.
   */
  onTierChange(index: number, tierId: number | null): void {
    if (!this.canApplyPricingTier()) return;
    const group = this.itemsArray.at(index) as FormGroup;
    if (!group) return;

    const tier = tierId == null
      ? null
      : this.visibleTiersForItem(group).find((t) => t.id === tierId) || null;
    if (tierId != null && !tier) return;

    const productId = Number(group.get('product_id')?.value);
    const product = Number.isFinite(productId)
      ? this.itemProductCache.get(productId)
      : undefined;
    const basePrice = Number(group.get('base_price')?.value || 0);
    const taxRate = Number(group.get('tax_rate')?.value || 0);

    const overridesAll = Number.isFinite(productId)
      ? this.productOverrides()[productId] ?? []
      : [];
    const overrides = (tier
      ? overridesAll.filter((o) => o.price_tier_id === tier.id)
      : []
    ).map((o) => ({
      variant_id: o.variant_id ?? null,
      override_price: Number(o.override_price),
    }));

    const resolution = this.priceResolver.resolveWithTier(
      {
        id: String(productId),
        base_price: basePrice,
        is_on_sale: product?.is_on_sale ?? false,
        sale_price: product?.sale_price ?? null,
        track_inventory: product?.track_inventory ?? true,
        has_multiple_price_tiers: !!group.get('has_multiple_price_tiers')?.value,
        units_per_package: group.get('units_per_package')?.value ?? null,
      },
      undefined,
      tier
        ? {
            id: tier.id,
            name: tier.name,
            discount_percentage: tier.discount_percentage ?? 0,
            is_package_unit: !!tier.is_package_unit,
          }
        : null,
      overrides,
      taxRate,
    );

    const unitPrice = Number(resolution.unitPrice.toFixed(2));
    group.patchValue({
      unit_price: unitPrice,
      applied_price_tier_id: resolution.appliedPriceTierId ?? null,
      applied_price_tier_name: resolution.appliedPriceTierName ?? null,
    });
    this.recalculateItem(index);
  }

  /** Pre-fetch overrides for the product so the selector resolves instantly. */
  private ensureProductOverridesLoaded(productId: number): void {
    if (!Number.isFinite(productId) || productId <= 0) return;
    if (this.productOverrides()[productId]) return;
    this.priceTierCache
      .getProductOverrides(productId)
      .pipe(takeUntilDestroyed())
      .subscribe({
        next: (overrides) =>
          this.productOverrides.update((current) => ({
            ...current,
            [productId]: overrides || [],
          })),
        error: () =>
          this.productOverrides.update((current) => ({
            ...current,
            [productId]: [],
          })),
      });
  }
}
