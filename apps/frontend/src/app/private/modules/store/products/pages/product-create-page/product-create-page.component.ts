import {
  afterNextRender,
  Component,
  computed,
  effect,
  signal,
  inject,
  DestroyRef,
} from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { DatePipe, DecimalPipe, KeyValuePipe } from '@angular/common';
import { toSignal, takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { map, switchMap } from 'rxjs/operators';
import { RouterModule, ActivatedRoute, Router, Params } from '@angular/router';
import {
  FormBuilder,
  FormGroup,
  ReactiveFormsModule,
  FormsModule, // Added FormsModule
  Validators,
  FormControl,
} from '@angular/forms';
import {
  ButtonComponent,
  InputComponent,
  InputButtonsComponent,
  ToastService,
  IconComponent,
  SelectorComponent,
  SelectorOption,
  MultiSelectorComponent,
  MultiSelectorOption,
  TextareaComponent,
  ModalComponent,
  DialogService,
  SettingToggleComponent,
  StickyHeaderComponent,
  StickyHeaderActionButton,
  BadgeComponent,
  TooltipComponent,
} from '../../../../../../shared/components';
import {
  CurrencyPipe,
  CurrencyFormatService,
} from '../../../../../../shared/pipes/currency';
import { AuthFacade } from '../../../../../../core/store/auth/auth.facade';
import { FiscalGateService } from '../../../../../../core/services/fiscal-gate.service';
import {
  CreateProductDto,
  CreateProductImageDto,
  ProductCategory,
  Brand,
  Product,
  ProductState,
  TaxCategory,
} from '../../interfaces';
import { ProductsService } from '../../services/products.service';
import { CategoriesService } from '../../services/categories.service';
import { BrandsService } from '../../services/brands.service';
import { TaxesService } from '../../services/taxes.service';
import { ReservationsService } from '../../../reservations/services/reservations.service';
import { ServiceProvider } from '../../../reservations/interfaces/reservation.interface';
import { CategoryQuickCreateComponent } from '../../components/category-quick-create.component';
import { BrandQuickCreateComponent } from '../../components/brand-quick-create.component';
import { TaxQuickCreateComponent } from '../../components/tax-quick-create.component';
import { ProductImageSourceModalComponent } from '../../components/product-image-source-modal.component';
import { ProductImageAiEnhanceModalComponent } from '../../components/product-image-ai-enhance-modal.component';
import { AdjustmentCreateModalComponent } from '../../../inventory/operations/components/adjustment-create-modal.component';
import { InventoryService } from '../../../inventory/services/inventory.service';
import {
  BatchCreateAdjustmentsRequest,
  PreselectedProduct,
} from '../../../inventory/interfaces';
import { extractApiErrorMessage } from '../../../../../../core/utils/api-error-handler';
import { ProductUtils } from '../../utils/product.utils';
import { PromotionsService } from '../../../marketing/promotions/services/promotions.service';
import { PosBarcodeService } from '../../../pos/services/pos-barcode.service';
import { environment } from '../../../../../../../environments/environment';
import { saleLessThanBaseValidator, uomDimensionMatchValidator } from '../../utils/product-validators';
import { UomService, UnitOfMeasure, UomApiResponse } from '../../../inventory/services';
import { PriceTiersService } from '../../../price-tiers/services/price-tiers.service';
import { PriceTierCacheService } from '../../../price-tiers/services/price-tier-cache.service';
import {
  PriceTier,
  ProductPriceTierOverride,
} from '../../../price-tiers/interfaces';
import { resolvePackSize } from '../../../../../../shared/services/pricing/packaging.util';
import { forkJoin, of } from 'rxjs';
import { catchError } from 'rxjs/operators';
// QUI-431 — Serial-number summary + full management modal.
import {
  SerialNumbersService,
  SerialSummary,
} from '../../../serial-numbers/services/serial-numbers.service';
import { ProductSerialsManagerModalComponent } from '../../../serial-numbers/components/product-serials-manager-modal/product-serials-manager-modal.component';

interface VariantAttribute {
  name: string;
  values: string[];
}

interface GeneratedVariant {
  id?: number;
  sku: string;
  barcode?: string;
  name: string;
  price: number;
  cost_price: number;
  profit_margin: number;
  is_on_sale: boolean;
  sale_price: number;
  stock: number;
  attributes: Record<string, string>;
  image_url?: string;
  image_file?: File;
  image_id?: number;
  track_inventory_override?: boolean | null;
}

export type { GeneratedVariant };

/**
 * One row in the per-product Price Tier overrides table.
 * Combines the tier definition with the optional override price persisted in
 * `product_price_tier_overrides`. `dirty` tracks whether the user has
 * mutated the value relative to what came from the API.
 *
 * MVP DECISION: overrides apply at the PRODUCT level only. Variants inherit
 * the product's tier overrides. TODO Phase 5/6: extend to per-variant
 * overrides if customer demand validates it.
 */
interface PriceTierOverrideRow {
  tier: PriceTier;
  enabled: boolean;
  initial_enabled: boolean;
  // null/undefined => no override stored; the tier's discount_percentage applies.
  override_price: number | null;
  // Snapshot of the persisted value to detect dirty edits on save.
  initial_override_price: number | null;
  // Per-product override of units-per-package (packaging cascade). null => inherit tier default.
  override_units_per_package: number | null;
  // Snapshot of the persisted units-per-package to detect dirty edits on save.
  initial_override_units_per_package: number | null;
}

@Component({
  selector: 'app-product-create-page',
  standalone: true,
  imports: [
    RouterModule,
    ReactiveFormsModule,
    FormsModule,
    ButtonComponent,
    InputComponent,
    InputButtonsComponent,
    IconComponent,
    SelectorComponent,
    MultiSelectorComponent,
    TextareaComponent,
    ModalComponent,
    SettingToggleComponent,
    CategoryQuickCreateComponent,
    BrandQuickCreateComponent,
    TaxQuickCreateComponent,
    ProductImageSourceModalComponent,
    ProductImageAiEnhanceModalComponent,
    AdjustmentCreateModalComponent,
    StickyHeaderComponent,
    CurrencyPipe,
    BadgeComponent,
    TooltipComponent,
    DatePipe,
    DecimalPipe,
    KeyValuePipe,
    ProductSerialsManagerModalComponent,
  ],
  templateUrl: './product-create-page.component.html',
  styles: [
    `
      /* ── AI Generate Button (subscription card style) ── */
      .ai-generate-btn {
        display: inline-flex;
        align-items: center;
        padding: 2px 6px;
        border-radius: 5px;
        border: 1px solid rgba(var(--color-primary-rgb), 0.4);
        font-size: 8px;
        background: linear-gradient(
          135deg,
          rgba(var(--color-primary-rgb), 0.5) 0%,
          rgba(var(--color-secondary-rgb, var(--color-primary-rgb)), 0.65) 25%,
          rgba(var(--color-primary-rgb), 0.4) 50%,
          rgba(var(--color-secondary-rgb, var(--color-primary-rgb)), 0.7) 75%,
          rgba(var(--color-primary-rgb), 0.55) 100%
        );
        background-size: 200% 200%;
        animation: ai-shimmer 3s ease-in-out infinite;
        color: white;
        cursor: pointer;
        transition: all 0.3s ease;
        box-shadow:
          inset 0 1px 0 rgba(255, 255, 255, 0.1),
          0 2px 8px rgba(var(--color-primary-rgb), 0.3);
        text-shadow: 0 1px 2px rgba(0, 0, 0, 0.2);
      }

      .ai-generate-btn:hover,
      .ai-description-wrapper:hover .ai-generate-btn {
        background: linear-gradient(
          135deg,
          var(--color-primary) 0%,
          color-mix(in srgb, var(--color-primary), white 20%) 25%,
          var(--color-primary) 50%,
          color-mix(in srgb, var(--color-primary), black 15%) 75%,
          var(--color-primary) 100%
        );
        background-size: 200% 200%;
        animation: ai-shimmer 2s ease-in-out infinite;
        box-shadow:
          inset 0 1px 0 rgba(255, 255, 255, 0.2),
          0 4px 16px rgba(var(--color-primary-rgb), 0.5),
          0 0 28px rgba(var(--color-primary-rgb), 0.5);
        transform: translateY(-1px);
      }

      .ai-generate-btn:disabled {
        cursor: not-allowed;
        transform: none;
        animation: ai-shimmer 1.5s ease-in-out infinite;
      }

      .ai-image-action-btn {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        padding: 8px 10px;
        border-radius: 9999px;
        border: 1px solid rgba(var(--color-primary-rgb), 0.35);
        font-size: 11px;
        font-weight: 700;
        line-height: 1;
        color: #fff;
        background: linear-gradient(
          135deg,
          rgba(var(--color-primary-rgb), 0.9) 0%,
          rgba(var(--color-secondary-rgb, var(--color-primary-rgb)), 0.95) 100%
        );
        box-shadow: 0 8px 20px rgba(var(--color-primary-rgb), 0.28);
        transition:
          opacity 0.2s ease,
          transform 0.2s ease,
          box-shadow 0.2s ease;
      }

      .ai-image-action-btn:hover {
        transform: scale(1.08);
        box-shadow: 0 10px 24px rgba(var(--color-primary-rgb), 0.38);
      }

      /* ── Hover propagation: button hover → label + textarea ── */
      .ai-description-wrapper .ai-label {
        transition: all 0.4s ease;
      }

      .ai-description-wrapper .ai-textarea-wrapper {
        transition: all 0.4s ease;
        border-radius: 12px;
        padding: 2px;
        background: transparent;
      }

      .ai-description-wrapper:has(.ai-generate-btn:hover:not(:disabled))
        .ai-label {
        background: linear-gradient(
          90deg,
          rgba(var(--color-primary-rgb), 1) 0%,
          rgba(var(--color-secondary-rgb, var(--color-primary-rgb)), 1) 50%,
          rgba(var(--color-primary-rgb), 1) 100%
        );
        background-size: 200% 100%;
        animation: ai-shimmer 2s ease-in-out infinite;
        -webkit-background-clip: text;
        background-clip: text;
        -webkit-text-fill-color: transparent;
        font-weight: 600;
      }

      .ai-description-wrapper:has(.ai-generate-btn:hover:not(:disabled))
        .ai-textarea-wrapper {
        position: relative;
        border-radius: 12px;
        padding: 2px;
        background: linear-gradient(
          135deg,
          rgba(var(--color-primary-rgb), 0.4) 0%,
          rgba(var(--color-secondary-rgb, var(--color-primary-rgb)), 0.6) 25%,
          rgba(var(--color-primary-rgb), 0.3) 50%,
          rgba(var(--color-secondary-rgb, var(--color-primary-rgb)), 0.6) 75%,
          rgba(var(--color-primary-rgb), 0.4) 100%
        );
        background-size: 300% 300%;
        animation: ai-outline-flow 2s ease-in-out infinite;
      }

      .ai-description-wrapper:has(.ai-generate-btn:hover:not(:disabled))
        .ai-textarea-wrapper
        ::ng-deep
        textarea {
        border: none !important;
        border-radius: 10px;
      }

      /* ── Tooltip ── */
      .ai-tooltip {
        position: absolute;
        bottom: calc(100% + 8px);
        right: 0;
        padding: 6px 12px;
        border-radius: 8px;
        background: linear-gradient(
          135deg,
          rgba(var(--color-primary-rgb), 0.85) 0%,
          rgba(var(--color-primary-rgb), 0.95) 50%,
          rgba(var(--color-primary-rgb), 0.85) 100%
        );
        background-size: 200% 200%;
        animation: ai-shimmer 3s ease-in-out infinite;
        color: white;
        font-size: 11px;
        white-space: nowrap;
        opacity: 0;
        pointer-events: none;
        transition:
          opacity 0.2s ease,
          transform 0.2s ease;
        transform: translateY(4px);
        border: 1px solid rgba(255, 255, 255, 0.2);
        box-shadow:
          0 4px 12px rgba(0, 0, 0, 0.25),
          inset 0 1px 1px rgba(255, 255, 255, 0.15);
      }

      .ai-generate-btn:hover .ai-tooltip {
        opacity: 1;
        transform: translateY(0);
      }

      /* ── Generating State: animated outline on textarea ── */
      .ai-generating .ai-textarea-wrapper,
      .ai-description-wrapper:hover .ai-textarea-wrapper {
        position: relative;
        border-radius: 12px;
        padding: 2px;
        background: linear-gradient(
          135deg,
          rgba(var(--color-primary-rgb), 0.6) 0%,
          rgba(var(--color-secondary-rgb, var(--color-primary-rgb)), 0.8) 25%,
          rgba(var(--color-primary-rgb), 0.4) 50%,
          rgba(var(--color-secondary-rgb, var(--color-primary-rgb)), 0.9) 75%,
          rgba(var(--color-primary-rgb), 0.5) 100%
        );
        background-size: 300% 300%;
        animation: ai-outline-flow 2s ease-in-out infinite;
      }

      .ai-generating .ai-textarea-wrapper ::ng-deep textarea,
      .ai-description-wrapper:hover .ai-textarea-wrapper ::ng-deep textarea {
        border: none !important;
        border-radius: 10px;
      }

      .ai-generating .ai-label,
      .ai-description-wrapper:hover .ai-label {
        background: linear-gradient(
          90deg,
          rgba(var(--color-primary-rgb), 1) 0%,
          rgba(var(--color-secondary-rgb, var(--color-primary-rgb)), 1) 50%,
          rgba(var(--color-primary-rgb), 1) 100%
        );
        background-size: 200% 100%;
        animation: ai-shimmer 2s ease-in-out infinite;
        -webkit-background-clip: text;
        background-clip: text;
        -webkit-text-fill-color: transparent;
        font-weight: 600;
      }

      @keyframes ai-shimmer {
        0% {
          background-position: 0% 50%;
        }
        50% {
          background-position: 100% 50%;
        }
        100% {
          background-position: 0% 50%;
        }
      }

      @keyframes ai-outline-flow {
        0% {
          background-position: 0% 50%;
        }
        50% {
          background-position: 100% 50%;
        }
        100% {
          background-position: 0% 50%;
        }
      }

      /* ── Inline tooltip help icon (styled tooltip, not native [title]) ── */
      .help-icon-inline {
        position: relative;
        display: inline-flex;
        align-items: center;
        cursor: help;
        transition: color 0.2s ease;
      }

      .help-icon-inline[data-tooltip]:hover::after {
        content: attr(data-tooltip);
        position: absolute;
        bottom: 100%;
        left: 50%;
        transform: translateX(-50%);
        padding: 0.375rem 0.5rem;
        background: var(--color-text-primary);
        color: var(--color-surface);
        font-size: var(--fs-xs);
        border-radius: var(--radius-sm);
        white-space: normal;
        box-shadow: var(--shadow-md);
        z-index: 50;
        margin-bottom: 0.375rem;
        pointer-events: none;
        max-width: 280px;
        width: max-content;
        text-align: center;
        line-height: 1.4;
      }

      .help-icon-inline[data-tooltip]:hover::before {
        content: '';
        position: absolute;
        bottom: 100%;
        left: 50%;
        transform: translateX(-50%);
        border: 4px solid transparent;
        border-top-color: var(--color-text-primary);
        margin-bottom: -0.125rem;
        z-index: 50;
        pointer-events: none;
      }
    `,
  ],
})
export class ProductCreatePageComponent {
  private fb = inject(FormBuilder);
  private productsService = inject(ProductsService);
  private categoriesService = inject(CategoriesService);
  private brandsService = inject(BrandsService);
  private taxesService = inject(TaxesService);
  private toastService = inject(ToastService);
  private inventoryService = inject(InventoryService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private dialogService = inject(DialogService);
  private currencyService = inject(CurrencyFormatService);
  private promotionsService = inject(PromotionsService);
  private reservationsService = inject(ReservationsService);
  private priceTiersService = inject(PriceTiersService);
  private priceTierCache = inject(PriceTierCacheService);
  private http = inject(HttpClient);
  private destroyRef = inject(DestroyRef);
  private barcodeService = inject(PosBarcodeService);
  private readonly authFacade = inject(AuthFacade);
  private readonly fiscalGate = inject(FiscalGateService);
  private readonly uomService = inject(UomService);
  private readonly serialNumbersService = inject(SerialNumbersService);

  /**
   * Industrias EFECTIVAS de la tienda, con la MISMA cascada de fuentes que
   * `MenuFilterService` (core/services/menu-filter.service.ts):
   *   1. store_settings.general.industries — fuente de verdad, se actualiza al
   *      guardar en Ajustes → General (live, no requiere re-login).
   *   2. user.store.industries — snapshot de login (puede no traer el campo si
   *      el whitelist de `cleanStore` aún no lo incluye).
   *   3. ['retail'] — default canónico (columna DB + settings default).
   * Antes leía solo (1)→userIndustries$ login y devolvía [] cuando el campo
   * faltaba, ocultando "Plato preparado" en tiendas restaurante.
   */
  private readonly storeSettings = toSignal(this.authFacade.storeSettings$, {
    initialValue: null as { general?: { industries?: string[] } } | null,
  });
  private readonly loginIndustries = toSignal(this.authFacade.userIndustries$, {
    initialValue: [] as string[],
  });
  private readonly storeIndustries = computed<string[]>(() => {
    const fromSettings = this.storeSettings()?.general?.industries;
    const fromLogin = this.loginIndustries();
    return (
      fromSettings ||
      (Array.isArray(fromLogin) ? fromLogin : null) ||
      ['retail']
    );
  });
  /**
   * `true` solo si la tienda tiene la industria `restaurant`. Gatea el tipo
   * "Plato preparado" y los toggles de la suite restaurante en el formulario.
   */
  readonly isRestaurant = computed(() =>
    this.storeIndustries().includes('restaurant'),
  );
  /**
   * `true` solo si la tienda tiene la industria `service`. Gatea el tipo
   * "Servicio" en el selector, igual que `isRestaurant` gatea "Plato preparado".
   */
  readonly isServiceIndustry = computed(() =>
    this.storeIndustries().includes('service'),
  );
  /**
   * Fase 0: capability resolver reused from the auth facade. Identical
   * semantics to `isRestaurant` for now, but expressed through the single
   * `industriesSupportIngredients` helper so the gating can be extended
   * beyond `restaurant` in one place. Used for the ingredient capacity.
   */
  readonly storeSupportsIngredients = this.authFacade.storeSupportsIngredients;

  // ===== UoM catalog (Fase UoM) =====
  private readonly uomCatalog = toSignal(this.uomService.getCatalog(), {
    initialValue: { success: true, data: [] } as UomApiResponse<
      UnitOfMeasure[]
    >,
  });
  /** All active UoM rows. Cached at service level via shareReplay. */
  readonly uomOptions = computed<UnitOfMeasure[]>(
    () => this.uomCatalog()?.data ?? [],
  );
  /**
   * UoM dropdown for the "stock unit" (minimum unit you consume in). Depends on
   * the chosen PURCHASE unit: only units in the SAME dimension and of
   * EQUAL-OR-SMALLER size (factor_to_base <= purchase's) are valid, so capacity
   * = purchase/stock is always >= 1. Flow: pick the presentation you buy (L),
   * then the form lists the minimum units you can stock in (ml, L). Reads
   * `uomTick` (bumped on purchase change) to react. Empty until purchase is set.
   */
  readonly stockUomOptions = computed<SelectorOption[]>(() => {
    this.uomTick();
    const purchaseId = Number(this.productForm?.get('purchase_uom_id')?.value ?? 0);
    const purchase = this.uomOptions().find((u) => u.id === purchaseId);
    if (!purchase) return [];
    const pf = Number(purchase.factor_to_base);
    return this.uomOptions()
      .filter(
        (u) =>
          u.dimension === purchase.dimension && Number(u.factor_to_base) <= pf,
      )
      .map((u) => ({ value: u.id, label: `${u.name} (${u.code})` }));
  });
  /**
   * UoM dropdown for the "purchase unit" (presentation you receive). Free
   * choice across all active units — it DRIVES the stock-unit options
   * (`stockUomOptions` filters by this selection). Old `is_base/!is_base` split
   * was wrong: `mg` (non-base) is smaller than base `g` → capacity 0, and
   * `unit` (base) was excluded so count ingredients had no option at all.
   */
  readonly purchaseUomOptions = computed<SelectorOption[]>(() =>
    this.uomOptions().map((u) => ({
      value: u.id,
      label: `${u.name} (${u.code})`,
    })),
  );
  /** Lookup dimension by UoM id (for the validator closure). */
  private uomDimensionById(id: number | null): string | null {
    if (!id) return null;
    return this.uomOptions().find((u) => u.id === id)?.dimension ?? null;
  }
  /** Convenience gate for the template: are we editing an ingredient? */
  readonly isIngredient = computed(() => {
    // Reactive-form values are not signals; depend on `formUpdateTrigger`
    // (bumped on every valueChanges) so toggling "Es insumo" re-opens the
    // UoM block. Without this dependency the computed froze at its first
    // value (false) and never reacted. See vendix-zoneless-signals.
    this.formUpdateTrigger();
    return !!this.productForm?.get('is_ingredient')?.value;
  });
  /**
   * Mirror of `isIngredient` for `is_sellable`. Defaults to true at form
   * load; during edit the value comes from the persisted product. Used to
   * drive the soft-exclusivity rule and the "pure ingredient" gate.
   */
  readonly isSellable = computed(() => {
    this.formUpdateTrigger();
    const v = this.productForm?.get('is_sellable')?.value;
    return v === undefined || v === null ? true : !!v;
  });
  /**
   * "Insumo puro": `is_ingredient` true AND `is_sellable` false. When this
   * holds we hide every retail-sale construct (base_price, sale_price,
   * multi-tier, e-commerce flag, featured, POS override, online link,
   * promotions) and force the persisted payload to neutral values so the
   * backend never receives contradictory state.
   *
   * Fase 1 of the insumos-vs-retail consolidation plan.
   */
  readonly isPureIngredient = computed(
    () => this.isIngredient() && !this.isSellable(),
  );


  /**
   * Bumped whenever a UoM dropdown changes so `unitCapacity` recomputes.
   * (Reactive form values are not signals; this gives the computed a signal
   * dependency for user-driven changes. On edit-load the catalog signal
   * resolving already triggers a recompute.)
   */
  readonly uomTick = signal(0);

  /**
   * Modelo B: derived "volume per unit" (capacity of one sealed container),
   * e.g. 1 L bought, ml stock → "1000 ml". Mirrors the backend
   * `derivePurchaseToStockFactor` (round(purchase.factor / stock.factor)) so
   * the product detail shows the same capacity the engine uses. Null unless
   * both UoMs are set and share a dimension.
   */
  readonly unitCapacity = computed<{
    value: number;
    unit: string;
    purchaseUnit: string;
  } | null>(() => {
    this.uomTick();
    const opts = this.uomOptions();
    const stockId = Number(this.productForm?.get('stock_uom_id')?.value ?? 0);
    const purchaseId = Number(this.productForm?.get('purchase_uom_id')?.value ?? 0);
    if (!stockId || !purchaseId) return null;
    const stock = opts.find((u) => u.id === stockId);
    const purchase = opts.find((u) => u.id === purchaseId);
    if (!stock || !purchase || stock.dimension !== purchase.dimension) return null;
    const sf = Number(stock.factor_to_base);
    const pf = Number(purchase.factor_to_base);
    if (!Number.isFinite(sf) || !Number.isFinite(pf) || sf <= 0 || pf <= 0) {
      return null;
    }
    return {
      value: Math.round(pf / sf),
      unit: stock.code,
      purchaseUnit: purchase.code,
    };
  });

  /** Re-run validator + recompute capacity when the stock dropdown changes. */
  onStockUomChange(): void {
    this.uomTick.update((t) => t + 1);
    this.productForm.updateValueAndValidity();
  }

  /**
   * Purchase drives the stock options, so when it changes, clear the stock unit
   * if it's no longer valid (different dimension or larger than the new
   * purchase unit). Prevents a stale invalid combo (e.g. stock=g + purchase=L).
   */
  onPurchaseUomChange(): void {
    this.uomTick.update((t) => t + 1);
    const stockCtrl = this.productForm.get('stock_uom_id');
    const stock = this.uomOptions().find(
      (u) => u.id === Number(stockCtrl?.value ?? 0),
    );
    const purchase = this.uomOptions().find(
      (u) => u.id === Number(this.productForm.get('purchase_uom_id')?.value ?? 0),
    );
    if (
      stock &&
      purchase &&
      (stock.dimension !== purchase.dimension ||
        Number(stock.factor_to_base) > Number(purchase.factor_to_base))
    ) {
      stockCtrl?.setValue(null);
    }
    this.productForm.updateValueAndValidity();
  }

  // Data Collection Templates (for consultation configuration)
  dataCollectionTemplates: {
    id: number;
    name: string;
    productIds: number[];
  }[] = [];

  get templateSelectorOptions(): SelectorOption[] {
    return this.dataCollectionTemplates.map((t) => ({
      value: t.id,
      label: t.name,
    }));
  }

  // Provider assignment (for services with requires_booking)
  assignedProviders = signal<ServiceProvider[]>([]);
  allProviders = signal<ServiceProvider[]>([]);
  loadingProviders = signal(false);

  readonly assignedProviderIds = computed<number[]>(() =>
    this.assignedProviders().map((p) => p.id),
  );

  readonly providerSelectorOptions = computed<MultiSelectorOption[]>(() =>
    this.allProviders().map((p) => {
      const fullName =
        `${p.employee?.first_name ?? ''} ${p.employee?.last_name ?? ''}`.trim();
      return {
        value: p.id,
        label: p.display_name || fullName || `Proveedor #${p.id}`,
        description: p.employee?.position || undefined,
      };
    }),
  );

  // Promotions
  promotionOptions = signal<MultiSelectorOption[]>([]);
  productPromotionIds = signal<number[]>([]);

  // Image loading state for feedback visual (signals — reactive bajo Zoneless)
  readonly isLoadingImages = signal(false);
  readonly loadingProgress = signal(0);

  // Reactividad: requires_booking como signal derivado del form para disparar effects
  readonly requiresBookingSig = signal(false);

  productForm: FormGroup = this.createForm();
  isSubmitting = signal(false);
  isGeneratingDescription = signal(false);
  aiDescriptionUsesLeft = signal(3);
  aiDescriptionLimitReached = computed(() => this.aiDescriptionUsesLeft() <= 0);
  isEditMode = signal(false);
  /**
   * En modo edición, false hasta que `loadProduct` patchea el form. El template
   * no renderiza el formulario hasta entonces para evitar el flash de secciones
   * dependientes del tipo (insumo): sin esto se ve un instante todo el UI de
   * producto y luego se oculta al llegar `is_ingredient=true`. Una sola vez:
   * no se resetea en recargas post-guardado (el form ya está montado).
   */
  readonly productLoaded = signal(false);
  productId: number | null = null;
  product: Product | null = null;
  readonly onlinePurchaseProduct = signal<Product | null>(null);
  readonly isGeneratingOnlinePurchaseLink = signal(false);
  readonly hasOnlinePurchaseLink = computed(() => {
    const product = this.onlinePurchaseProduct();
    return !!(product?.online_purchase_url && product?.online_purchase_qr_code);
  });
  readonly onlinePurchaseUrl = computed(
    () => this.onlinePurchaseProduct()?.online_purchase_url || '',
  );
  readonly onlinePurchaseQrCode = computed(
    () => this.onlinePurchaseProduct()?.online_purchase_qr_code || '',
  );
  readonly onlinePurchaseReady = computed(
    () => this.onlinePurchaseProduct()?.online_purchase_ready !== false,
  );
  readonly onlinePurchaseMessage = computed(
    () =>
      this.onlinePurchaseProduct()?.online_purchase_status_message ||
      'Genera el link y QR de compra online para este producto.',
  );

  imageUrls: string[] = [];
  imageIds: (number | null)[] = []; // Parallel array: DB image ID (null for new/unsaved images)
  activeImageIndex = 0;
  mainImageIndex = 0;
  readonly imageListVersion = signal(0);
  readonly imagesTouched = signal(false);
  isStockDetailsOpen = false;
  isReleasingReservations = false;
  categoryOptions: MultiSelectorOption[] = [];
  brandOptions: SelectorOption[] = [];
  // F4 — Gate "no responsable de IVA". Fuente cruda de categorías (para
  // getters de precio) + estado de bloqueo del comercio.
  private readonly taxCategoriesSig = signal<TaxCategory[]>([]);
  readonly isVatBlocked = this.authFacade.isVatBlocked;
  /**
   * Set de ids de categorías cuyo `tax_type === 'iva'`. Solo el IVA se bloquea;
   * INC/ICA/retenciones quedan permitidos.
   */
  private readonly ivaTaxCategoryIdSet = computed(
    () =>
      new Set(
        this.taxCategoriesSig()
          .filter((c) => (c.tax_type ?? '').toLowerCase() === 'iva')
          .map((c) => c.id),
      ),
  );
  /**
   * Opciones del multi-selector de impuestos. Cuando el comercio NO es
   * responsable de IVA, las opciones IVA se muestran con candado y
   * `disabled: true` (el multi-selector no las deja seleccionar).
   */
  readonly taxCategoryOptions = computed<MultiSelectorOption[]>(() => {
    const blocked = this.isVatBlocked();
    const ivaIds = this.ivaTaxCategoryIdSet();
    return this.taxCategoriesSig().map((cat) => {
      const rawRate = cat.rate ?? cat.tax_rates?.[0]?.rate ?? 0;
      const rate = parseFloat(String(rawRate));
      const finalRate = isNaN(rate) ? 0 : rate;
      const isIva = ivaIds.has(cat.id);
      const lock = blocked && isIva;
      return {
        value: cat.id,
        label: `${cat.name} (${(finalRate * 100).toFixed(0)}%)`,
        description: lock
          ? 'Requiere ser responsable de IVA ante la DIAN'
          : cat.description,
        disabled: lock,
        icon: lock ? 'lock' : undefined,
      };
    });
  });
  stateOptions: SelectorOption[] = [
    { value: ProductState.ACTIVE, label: 'Activo' },
    { value: ProductState.INACTIVE, label: 'Inactivo' },
    { value: ProductState.ARCHIVED, label: 'Archivado' },
  ];

  pricingTypeOptions: { value: string; label: string }[] = [
    { value: 'unit', label: 'Venta por unidad' },
    { value: 'weight', label: 'Venta por peso (kg)' },
  ];

  /**
   * Opciones del selector "Tipo de Producto". "Plato preparado"
   * (product_type='prepared') solo se ofrece a tiendas con industria
   * `restaurant`, o si el producto en edición ya es 'prepared' (para no
   * perder el valor al editarlo en una tienda mal configurada).
   */
  readonly productTypeOptions = computed<{ value: string; label: string }[]>(
    () => {
      this.formUpdateTrigger(); // reactividad ante cambios del formulario
      const current = this.productForm?.get('product_type')?.value;
      const base = [{ value: 'physical', label: 'Producto Físico' }];
      // "Servicio" solo con la industria `service` activa (o al editar un
      // servicio ya creado en una tienda mal configurada, para no perder el
      // valor). Mismo patrón que "Plato preparado" con la industria restaurant.
      if (this.isServiceIndustry() || current === 'service') {
        base.push({ value: 'service', label: 'Servicio' });
      }
      if (this.isRestaurant() || current === 'prepared') {
        base.push({ value: 'prepared', label: 'Plato preparado' });
      }
      return base;
    },
  );

  serviceModalityOptions: SelectorOption[] = [
    { value: 'in_person', label: 'Presencial' },
    { value: 'virtual', label: 'Virtual' },
    { value: 'hybrid', label: 'Híbrido' },
  ];

  servicePricingTypeOptions: SelectorOption[] = [
    { value: 'per_hour', label: 'Por hora' },
    { value: 'per_session', label: 'Por sesión' },
    { value: 'package', label: 'Paquete' },
    { value: 'subscription', label: 'Suscripción' },
  ];

  get isService(): boolean {
    return this.productForm.get('product_type')?.value === 'service';
  }

  get preparationTimeMinutesControl(): FormControl<number | null> {
    return this.productForm.get('preparation_time_minutes') as FormControl<
      number | null
    >;
  }

  get hasDuplicateSkus(): boolean {
    const skus = this.generatedVariants
      .map((v) => v.sku?.trim())
      .filter((s) => s && s.length > 0);
    return new Set(skus).size !== skus.length;
  }

  get hasVariantEdits(): boolean {
    return this.generatedVariants.length > 0;
  }

  onProductTypeChange(value: string): void {
    if (value === 'service') {
      this.productForm.patchValue({
        track_inventory: false,
        pricing_type: 'unit',
        weight: 0,
        dimensions: { length: 0, width: 0, height: 0 },
        stock_quantity: 0,
      });
    } else {
      this.productForm.patchValue({
        track_inventory: true,
        service_duration_minutes: null,
        service_modality: null,
        service_pricing_type: null,
        requires_booking: false,
        booking_mode: null,
        is_recurring: false,
        service_instructions: '',
        is_consultation: false,
        send_preconsultation: false,
        consultation_template_id: null,
        preconsultation_template_id: null,
      });
    }
  }

  private syncPricingTypeControlState(isService: boolean): void {
    const pricingTypeControl = this.productForm.get('pricing_type');
    if (!pricingTypeControl) return;

    if (isService) {
      if (pricingTypeControl.value !== 'unit') {
        pricingTypeControl.setValue('unit', { emitEvent: false });
      }
      if (pricingTypeControl.enabled) {
        pricingTypeControl.disable({ emitEvent: false });
      }
      return;
    }

    if (pricingTypeControl.disabled) {
      pricingTypeControl.enable({ emitEvent: false });
    }
  }

  // Variants State
  hasVariants = false;
  variantAttributes: VariantAttribute[] = [];
  generatedVariants: GeneratedVariant[] = [];
  removedVariantKeys = new Set<string>();

  // Routes a barcode scan to the currently-focused barcode input.
  // Default = product-level barcode (preserves simple-product scan behavior).
  protected readonly scanTarget = signal<
    { kind: 'product' } | { kind: 'variant'; index: number }
  >({ kind: 'product' });
  expandedVariantIndex = signal<number | null>(null);
  stockTransferMode: 'first' | 'distribute' | 'reset' | null = null;
  readonly originalBaseStock = signal(0);
  readonly originalHadVariants = signal(false);

  // ─── Multi-tarifa state (Phase 4) ───────────────────────────────────────
  /** Master rows for the "Precios por Tarifa" table. */
  readonly priceTierRows = signal<PriceTierOverrideRow[]>([]);
  readonly isLoadingPriceTiers = signal(false);
  readonly hasLoadedPriceTiers = signal(false);

  /** True while persisting overrides during onSubmit. */
  readonly isSyncingOverrides = signal(false);

  // New Attribute Input
  newAttributeName = '';
  newAttributeValue = '';
  currentAttributeValues: string[] = [];

  // Quick create modals state
  isCategoryCreateOpen = false;
  isBrandCreateOpen = false;
  isTaxCategoryCreateOpen = false;
  isImageSourceModalOpen = signal(false);
  readonly imageModalMode = signal<'add' | 'edit'>('add');
  readonly imageEditSourceUrl = signal<string | null>(null);
  readonly editingImageIndex = signal<number | null>(null);
  readonly isImageAiEnhanceModalOpen = signal(false);
  readonly aiEnhanceImageUrl = signal<string | null>(null);
  readonly aiEnhanceImageIndex = signal<number | null>(null);

  // Variant image modals state (paridad con producto base)
  readonly isVariantImageModalOpen = signal(false);
  readonly isVariantImageEditModalOpen = signal(false);
  readonly isVariantAiModalOpen = signal(false);
  readonly editingVariantIndex = signal<number | null>(null);
  readonly editingVariantImageUrl = computed<string | null>(() => {
    const idx = this.editingVariantIndex();
    if (idx === null) return null;
    return this.generatedVariants[idx]?.image_url ?? null;
  });
  readonly remainingImageSlots = computed(() => {
    this.imageListVersion();
    return Math.max(0, 5 - this.imageUrls.length);
  });
  isAdjustmentModalOpen = false;
  isAdjusting = false;
  adjustmentLocationOptions: SelectorOption[] = [];

  // Trigger for computed units to react to non-signal form state changes
  private formUpdateTrigger = signal(0);

  readonly productHeaderActions = computed<StickyHeaderActionButton[]>(() => {
    this.formUpdateTrigger(); // Dependency
    return [
      {
        id: 'cancel',
        label: 'Cancelar',
        icon: 'x',
        variant: 'outline',
      },
      {
        id: 'save',
        label: this.isEditMode() ? 'Guardar' : 'Crear',
        icon: this.isEditMode() ? 'save' : 'plus',
        variant: 'primary',
        loading: this.isSubmitting(),
        disabled: this.isSubmitting() || this.productForm.invalid,
      },
    ];
  });

  /**
   * Fase 1: soft-exclusivity between `is_ingredient` and `is_sellable`.
   *
   * Form-level rule: turning ON `is_ingredient` forces `is_sellable=false`,
   * and turning ON `is_sellable` forces `is_ingredient=false`. We use the
   * previous value snapshot so we only push the OPPOSITE flag, never both
   * (avoids ping-pong). `{ emitEvent: false }` prevents the patched control
   * from re-triggering `valueChanges` and re-entering this method.
   *
   * The DB does NOT carry a hard constraint (per the plan), so a dual-role
   * product (insumo + vendible) remains possible by editing the API directly
   * — this is a UX guardrail, not a data rule.
   */
  private applyIngredientSellableSoftExclusivity(value: any): void {
    const isIngredient = !!value?.is_ingredient;
    const isSellable = value?.is_sellable === undefined || value?.is_sellable === null
      ? true
      : !!value.is_sellable;
    const ingCtrl = this.productForm?.get('is_ingredient');
    const sellCtrl = this.productForm?.get('is_sellable');
    if (!ingCtrl || !sellCtrl) return;
    const prevIng = !!this.lastIngredientFlag;
    const prevSell = this.lastSellableFlag === undefined
      ? true
      : !!this.lastSellableFlag;
    this.lastIngredientFlag = isIngredient;
    this.lastSellableFlag = isSellable;
    // Only react to the field that actually flipped.
    if (isIngredient !== prevIng) {
      if (isIngredient && sellCtrl.value !== false) {
        sellCtrl.patchValue(false, { emitEvent: false });
        this.lastSellableFlag = false;
      }
      // Al activar "Es insumo": un insumo siempre es Producto Físico
      // (nunca servicio ni plato preparado) y nunca un combo/menú fijo.
      // Forzamos esos valores y ocultamos sus controles en el template.
      if (isIngredient) {
        this.productForm
          .get('product_type')
          ?.patchValue('physical', { emitEvent: false });
        this.productForm.get('is_combo')?.patchValue(false, { emitEvent: false });
      }
    }
    if (isSellable !== prevSell) {
      if (isSellable && ingCtrl.value !== false) {
        ingCtrl.patchValue(false, { emitEvent: false });
        this.lastIngredientFlag = false;
      }
    }
  }
  /** Last seen is_ingredient value (used to detect the just-flipped field). */
  private lastIngredientFlag: boolean | null = null;
  /** Last seen is_sellable value (undefined = not seen yet; treat as true). */
  private lastSellableFlag: boolean | undefined = undefined;

  /**
   * Fase 1: when the product is a "pure ingredient"
   * (`is_ingredient && !is_sellable`), we hide retail-sale constructs in the
   * template and force the persisted payload to neutral values:
   *  - base_price, sale_price/is_on_sale, allow_pos_price_override,
   *    has_multiple_price_tiers + enabled_price_tier_ids, available_for_ecommerce,
   *    is_featured, online_purchase_url.
   *
   * Implementation: we use Angular Reactive Form `disable()` + `reset()` on
   * the controls so they are excluded from `value` and skipped on submit.
   * We also drop the `Validators.required` on `base_price` while the
   * ingredient flag is on (a pure ingredient does not need a sale price).
   *
   * Idempotent: safe to call from a valueChanges subscription and from an
   * effect that watches `isPureIngredient()`.
   */
  private applyIngredientRetailControls(): void {
    const form = this.productForm;
    if (!form) return;
    // isPureIngredient depends on the form, so guard with a reactive form
    // check. formUpdateTrigger is read by isIngredient() / isSellable() so
    // we touch it for an explicit dependency on every form change.
    this.formUpdateTrigger();
    const pure = this.isPureIngredient();
    const controls: Array<[string, unknown]> = [
      ['base_price', 0],
      ['is_on_sale', false],
      ['allow_pos_price_override', false],
      ['has_multiple_price_tiers', false],
      ['available_for_ecommerce', false],
      ['is_featured', false],
    ];
    for (const [name, neutral] of controls) {
      const ctrl = form.get(name);
      if (!ctrl) continue;
      if (pure) {
        if (ctrl.enabled) ctrl.disable({ emitEvent: false });
        // Reset to neutral so persisted payload never carries sale data.
        ctrl.reset(neutral, { emitEvent: false });
      } else {
        if (ctrl.disabled) ctrl.enable({ emitEvent: false });
      }
    }
    // base_price required-ness: drop when pure ingredient; restore otherwise.
    const basePriceCtrl = form.get('base_price');
    if (basePriceCtrl) {
      const validators = (basePriceCtrl as any).validator
        ? [(basePriceCtrl as any).validator]
        : [];
      // We rebuild a minimal validator set: clear required when pure,
      // otherwise re-add the original required + min(0) pair via the
      // helper. Easier and safer: store the original validator on first
      // call, then swap.
      const w = basePriceCtrl as any;
      if (!w.__origBasePriceValidator) {
        w.__origBasePriceValidator = w.validator;
      }
      if (pure) {
        w.setValidators(null);
      } else if (w.__origBasePriceValidator) {
        w.setValidators(w.__origBasePriceValidator);
      }
      basePriceCtrl.updateValueAndValidity({ emitEvent: false });
    }
    // online_purchase_url + promotions list
    const onlineUrlCtrl = form.get('online_purchase_url');
    if (onlineUrlCtrl) {
      if (pure) {
        if (onlineUrlCtrl.enabled) onlineUrlCtrl.disable({ emitEvent: false });
        onlineUrlCtrl.reset(null, { emitEvent: false });
      } else if (onlineUrlCtrl.disabled) {
        onlineUrlCtrl.enable({ emitEvent: false });
      }
    }
    // Multi-tier ids: empty list when pure.
    const tierIdsCtrl = form.get('enabled_price_tier_ids');
    if (tierIdsCtrl) {
      if (pure) {
        if (tierIdsCtrl.enabled) tierIdsCtrl.disable({ emitEvent: false });
        tierIdsCtrl.reset([], { emitEvent: false });
      } else if (tierIdsCtrl.disabled) {
        tierIdsCtrl.enable({ emitEvent: false });
      }
    }
    // Promotions are stored on a sibling form/sub-form; we handle the
    // common one if present.
    const promoCtrl = form.get('promotions');
    if (promoCtrl) {
      if (pure) {
        if (promoCtrl.enabled) promoCtrl.disable({ emitEvent: false });
        promoCtrl.reset([], { emitEvent: false });
      } else if (promoCtrl.disabled) {
        promoCtrl.enable({ emitEvent: false });
      }
    }
    // sale_price is a nested control under sale_price group in some forms;
    // if it lives at root we reset it.
    const salePriceCtrl = form.get('sale_price');
    if (salePriceCtrl) {
      if (pure) {
        if (salePriceCtrl.enabled) salePriceCtrl.disable({ emitEvent: false });
        salePriceCtrl.reset(0, { emitEvent: false });
      } else if (salePriceCtrl.disabled) {
        salePriceCtrl.enable({ emitEvent: false });
      }
    }
  }

  constructor() {
    // Deep-link desde otros módulos: si llegan queryParams (ej. ?is_combo=true&product_type=prepared)
    // los aplicamos al form. Usamos toSignal(queryParamMap) para que sea reactivo.
    const queryParamsSignal = toSignal(this.route.queryParamMap, {
      initialValue: this.route.snapshot.queryParamMap,
    });
    effect(() => {
      const params = queryParamsSignal();
      const isCombo = params.get('is_combo') === 'true';
      const productType = params.get('product_type');
      if (isCombo || productType) {
        const patch: any = {};
        if (productType) patch.product_type = productType;
        if (isCombo) {
          patch.is_combo = true;
          patch.is_sellable = true;
          patch.is_ingredient = false;
          // un combo suele ser prepared
          if (!productType) patch.product_type = 'prepared';
        }
        this.productForm.patchValue(patch, { emitEvent: false });
      }
    });

    // Sincronizar trigger con cambios del formulario
    this.productForm.valueChanges
      .pipe(takeUntilDestroyed())
      .subscribe((value: any) => {
        this.formUpdateTrigger.update((v) => v + 1);
        // Espejar requires_booking en signal para effect reactivo
        const next = !!value?.requires_booking;
        if (next !== this.requiresBookingSig()) {
          this.requiresBookingSig.set(next);
        }
        // Fase 1: soft-exclusivity between is_ingredient and is_sellable.
        // We use the previous value (lastSnapshot) to detect the toggle that
        // the user just flipped, so we only push the counter-flag in one
        // direction (no infinite ping-pong). `{ emitEvent: false }` keeps
        // the patched control from re-triggering this same subscription.
        this.applyIngredientSellableSoftExclusivity(value);
        this.normalizeVariantTrackingForParent();
      });

    // Re-apply retail-controls neutralization whenever the "is pure
    // ingredient" state changes, including on edit-load. We watch the form
    // valueChanges (already wired above) and re-evaluate here so disabled
    // controls and required validators stay in sync with the latest flag.
    effect(() => {
      // touch the deps so this runs on every relevant change
      const _pure = this.isPureIngredient();
      const _store = this.storeSupportsIngredients();
      this.applyIngredientRetailControls();
    });
    this.productForm.statusChanges
      .pipe(takeUntilDestroyed())
      .subscribe(() => this.formUpdateTrigger.update((v) => v + 1));
    this.productForm
      .get('product_type')
      ?.valueChanges.pipe(takeUntilDestroyed())
      .subscribe((productType) => {
        this.syncPricingTypeControlState(productType === 'service');
      });
    this.syncPricingTypeControlState(this.isService);

    // F4 — Gate "no responsable de IVA": si el comercio no es responsable y el
    // usuario agrega una categoría IVA, revertimos el cambio (emitEvent:false
    // para no reentrar) y abrimos el modal de activación fiscal. INC/ICA/
    // retenciones no se tocan; las lecturas nunca se bloquean.
    this.productForm
      .get('tax_category_ids')
      ?.valueChanges.pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((ids: number[] | null) => {
        if (!this.isVatBlocked()) return;
        const selected = Array.isArray(ids) ? ids : [];
        const ivaIds = this.ivaTaxCategoryIdSet();
        const hasIva = selected.some((id) => ivaIds.has(id));
        if (!hasIva) return;
        const filtered = selected.filter((id) => !ivaIds.has(id));
        this.productForm
          .get('tax_category_ids')
          ?.setValue(filtered, { emitEvent: false });
        this.fiscalGate.openVatResponsibleGate();
      });

    // Auto-cargar proveedores cuando se activa requires_booking (o al entrar en edit con el flag ya activo)
    effect(() => {
      const enabled = this.requiresBookingSig();
      const pid = this.productId;
      if (enabled && pid) {
        this.loadProviders(pid);
        this.loadAllProviders();
      } else if (!enabled) {
        this.assignedProviders.set([]);
      }
    });

    // Asegurar que la moneda esté cargada
    this.currencyService.loadCurrency();
    afterNextRender(() => {
      this.loadCategoriesAndBrands();
      this.loadDataCollectionTemplates();
    });

    // Verificar draft del modal de creación rápida
    const navState = history.state;
    if (navState?.draft) {
      this.applyDraftData(navState.draft);
    }

    // Check for ID in route to determine edit mode
    this.route.params.subscribe((params: Params) => {
      if (params['id']) {
        this.productId = +params['id'];
        this.isEditMode.set(true);
        this.loadProduct(this.productId);
        this.loadPromotionOptions();
        this.loadProductPromotions(this.productId);
      }
    });

    // Scan-to-fill: a barcode scan (gated by barcode_scanner.enabled) is routed
    // to whichever barcode input is currently focused (scanTarget). Default is the
    // product-level barcode, preserving simple-product behavior.
    this.barcodeService.scans$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((code) => {
        const target = this.scanTarget();
        if (target.kind === 'variant') {
          const variant = this.generatedVariants[target.index];
          if (variant) {
            variant.barcode = code;
            // Zoneless reactive refresh: reassign the array (same pattern used by
            // the variant image-update handlers) so the focused input re-renders.
            this.generatedVariants = [...this.generatedVariants];
            return;
          }
        }
        this.productForm.get('barcode')?.setValue(code);
      });
  }

  private applyDraftData(draft: any): void {
    this.productForm.patchValue({
      name: draft.name || '',
      description: draft.description || '',
      base_price: draft.base_price || 0,
      stock_quantity: draft.stock_quantity || 0,
      track_inventory: draft.track_inventory ?? true,
      allow_pos_price_override: draft.allow_pos_price_override ?? false,
      sku: draft.sku || '',
      barcode: draft.barcode || '',
      category_ids: draft.category_ids || [],
      brand_ids: draft.brand_id ? [draft.brand_id] : [],
      tax_category_ids: draft.tax_category_ids || [],
      state: draft.state || ProductState.ACTIVE,
    });
  }

  loadPromotionOptions(): void {
    this.promotionsService.getPromotions({ limit: 200 }).subscribe((res) => {
      this.promotionOptions.set(
        res.data.map((p: any) => ({
          value: p.id,
          label: p.name,
          description: `${p.type === 'percentage' ? p.value + '%' : '$' + p.value} — ${p.state}`,
        })),
      );
    });
  }

  loadProductPromotions(productId: number): void {
    this.productsService.getProductPromotions(productId).subscribe((promos) => {
      this.productPromotionIds.set(promos.map((p: any) => p.id));
    });
  }

  onPromotionsChange(ids: (string | number)[]): void {
    if (!this.productId) return;
    const numericIds = ids.map((id) => Number(id));
    this.productsService
      .updateProductPromotions(this.productId, numericIds)
      .subscribe({
        next: (promos) => {
          this.productPromotionIds.set(promos.map((p: any) => p.id));
          this.toastService.success('Promociones actualizadas');
        },
        error: () => {
          this.toastService.error('Error al actualizar promociones');
        },
      });
  }

  generateOnlinePurchaseLink(): void {
    if (!this.productId || this.isGeneratingOnlinePurchaseLink()) return;

    this.isGeneratingOnlinePurchaseLink.set(true);
    this.productsService.generateOnlinePurchaseLink(this.productId).subscribe({
      next: (result) => {
        const currentProduct = this.onlinePurchaseProduct();
        const updatedProduct = {
          ...(currentProduct || this.product || ({} as Product)),
          online_purchase_url: result.online_purchase_url || null,
          online_purchase_qr_code:
            result.online_purchase_qr_code || result.qr_data_url || null,
          online_purchase_domain_id: result.online_purchase_domain_id || null,
          online_purchase_domain_hostname: result.domain_hostname || null,
          online_purchase_generated_at:
            result.online_purchase_generated_at || null,
          online_purchase_ready: result.online_purchase_ready,
          online_purchase_status_reason: result.online_purchase_status_reason,
          online_purchase_status_message: result.online_purchase_status_message,
        } as Product;

        this.product = updatedProduct;
        this.onlinePurchaseProduct.set(updatedProduct);
        this.toastService.success('Link y QR de compra online generados');
        this.isGeneratingOnlinePurchaseLink.set(false);
      },
      error: (err: any) => {
        const message =
          typeof err === 'string' ? err : extractApiErrorMessage(err);
        this.toastService.error(
          message || 'No se pudo generar el QR de compra online',
        );
        this.isGeneratingOnlinePurchaseLink.set(false);
      },
    });
  }

  copyOnlinePurchaseLink(): void {
    const url = this.onlinePurchaseUrl();
    if (!url) return;

    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      navigator.clipboard
        .writeText(url)
        .then(() => this.toastService.success('Link copiado'))
        .catch(() => this.copyOnlinePurchaseLinkFallback(url));
      return;
    }

    this.copyOnlinePurchaseLinkFallback(url);
  }

  copyName(): void {
    const name = this.productForm.get('name')?.value?.trim();
    if (!name) return;

    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      navigator.clipboard
        .writeText(name)
        .then(() => this.toastService.success('Nombre copiado'))
        .catch(() => {});
    }
  }

  openOnlinePurchaseLink(): void {
    const url = this.onlinePurchaseUrl();
    if (!url || typeof window === 'undefined') return;
    window.open(url, '_blank', 'noopener,noreferrer');
  }

  downloadOnlinePurchaseQr(): void {
    const qrCode = this.onlinePurchaseQrCode();
    if (!qrCode || typeof document === 'undefined') return;

    const link = document.createElement('a');
    const slug = this.onlinePurchaseProduct()?.slug || 'producto';
    link.href = qrCode;
    link.download = `${slug}-qr-compra-online.png`;
    link.click();
  }

  private copyOnlinePurchaseLinkFallback(url: string): void {
    if (typeof document === 'undefined') {
      this.toastService.error('No se pudo copiar el link');
      return;
    }

    const textarea = document.createElement('textarea');
    textarea.value = url;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();

    try {
      document.execCommand('copy');
      this.toastService.success('Link copiado');
    } catch {
      this.toastService.error('No se pudo copiar el link');
    } finally {
      document.body.removeChild(textarea);
    }
  }

  private loadDataCollectionTemplates(): void {
    this.http
      .get<any>(`${environment.apiUrl}/store/data-collection/templates`)
      .pipe(map((r: any) => r.data || []))
      .subscribe({
        next: (templates: any[]) => {
          this.dataCollectionTemplates = templates.map((t: any) => ({
            id: t.id,
            name: t.name,
            productIds: (t.products || []).map(
              (p: any) => p.product_id || p.product?.id,
            ),
          }));
        },
        error: () => {}, // Silently fail — not critical
      });
  }

  private createForm(): FormGroup {
    const form = this.fb.group(
      {
        name: [
          '',
          [
            Validators.required,
            Validators.minLength(1),
            Validators.maxLength(255),
          ],
        ],
        slug: ['', [Validators.maxLength(255)]],
        description: [''],
        cost_price: [0, [Validators.min(0)]],
        profit_margin: [0, [Validators.min(0)]],
        base_price: [0, [Validators.required, Validators.min(0)]],
        is_on_sale: [false],
        sale_price: [0, [Validators.min(0)]],
        available_for_ecommerce: [true],
        is_featured: [false],
        allow_pos_price_override: [false],
        sku: ['', [Validators.maxLength(100)]],
        barcode: ['', [Validators.maxLength(64)]],
        stock_quantity: [0, [Validators.min(0)]],
        track_inventory: [true],
        requires_serial_numbers: [false],
        category_ids: [[] as number[]],
        brand_ids: [[]],
        tax_category_ids: [[] as number[]],
        weight: [0, [Validators.min(0)]],
        dimensions: this.fb.group({
          length: [0, [Validators.min(0)]],
          width: [0, [Validators.min(0)]],
          height: [0, [Validators.min(0)]],
        }),
        state: [ProductState.ACTIVE],
        pricing_type: ['unit' as const],
        product_type: ['physical' as const],
        service_duration_minutes: [null],
        service_modality: [null],
        service_pricing_type: [null],
        requires_booking: [false],
        booking_mode: [null],
        is_recurring: [false],
        service_instructions: [''],
        is_consultation: [false],
        send_preconsultation: [false],
        consultation_template_id: [null],
        preconsultation_template_id: [null],
        preparation_time_minutes: [null as number | null],
        // Multi-tarifa (Phase 4). Empaque ahora vive en cada tarifa.
        has_multiple_price_tiers: [false],
        // ===== Restaurant Suite toggles (Fase B) =====
        is_sellable: [true],
        is_ingredient: [false],
        is_combo: [false],
        is_batch_produced: [false],
        // ===== UoM FKs (Fase UoM) =====
        // The legacy string fields `stock_unit` / `purchase_unit` /
        // `purchase_to_stock_factor` remain untouched for backfill. The
        // FKs below are the source of truth once a UoM is picked.
        stock_uom_id: [null as number | null],
        purchase_uom_id: [null as number | null],
      },
      {
        validators: [
          saleLessThanBaseValidator(),
          uomDimensionMatchValidator((id: number | null) => this.uomDimensionById(id)),
        ],
      },
    );

    this.setupPriceCalculations(form);
    return form;
  }

  private setupPriceCalculations(form: FormGroup): void {
    const costCtrl = form.get('cost_price');
    const marginCtrl = form.get('profit_margin');
    const basePriceCtrl = form.get('base_price');

    // Anchoring model (QUI-425):
    //  - cost_price is an ANCHOR  → editing cost re-derives profit_margin
    //    so base_price stays put.
    //  - base_price is an ANCHOR → editing base_price re-derives profit_margin.
    //  - profit_margin is the LEVER → editing margin re-derives base_price
    //    (intentional: user is asking "what would this sell for at X%?").
    costCtrl?.valueChanges.subscribe(() => this.recalculateMarginFromCost(form));
    marginCtrl?.valueChanges.subscribe(() => this.recalculateBasePriceFromMargin(form));
    basePriceCtrl?.valueChanges.subscribe(() => this.recalculateMarginFromBasePrice(form));
  }

  private isCalculating = false;

  private recalculateBasePriceFromMargin(form: FormGroup): void {
    if (this.isCalculating) return;

    const cost = Number(form.get('cost_price')?.value || 0);
    const margin = Number(form.get('profit_margin')?.value || 0);

    this.isCalculating = true;
    const basePrice = cost * (1 + margin / 100);
    form
      .get('base_price')
      ?.setValue(Number(basePrice.toFixed(2)), { emitEvent: false });
    this.isCalculating = false;
  }

  private recalculateMarginFromCost(form: FormGroup): void {
    if (this.isCalculating) return;

    const cost = Number(form.get('cost_price')?.value || 0);
    const basePrice = Number(form.get('base_price')?.value || 0);

    if (cost > 0) {
      this.isCalculating = true;
      const margin = ((basePrice - cost) / cost) * 100;
      form
        .get('profit_margin')
        ?.setValue(Number(margin.toFixed(2)), { emitEvent: false });
      this.isCalculating = false;
    }
  }

  private recalculateMarginFromBasePrice(form: FormGroup): void {
    if (this.isCalculating) return;

    const cost = Number(form.get('cost_price')?.value || 0);
    const basePrice = Number(form.get('base_price')?.value || 0);

    if (cost > 0) {
      this.isCalculating = true;
      const margin = ((basePrice - cost) / cost) * 100;
      form
        .get('profit_margin')
        ?.setValue(Number(margin.toFixed(2)), { emitEvent: false });
      this.isCalculating = false;
    }
  }

  get priceWithTax(): number {
    const basePrice = Number(this.productForm.get('base_price')?.value || 0);
    const selectedTaxIds =
      this.productForm.get('tax_category_ids')?.value || [];
    // F4 — si el comercio no es responsable de IVA, el IVA nunca compone el
    // precio calculado (aunque quedara un id residual en el control).
    const ivaIds = this.ivaTaxCategoryIdSet();
    const blocked = this.isVatBlocked();

    let totalTaxRate = 0;
    selectedTaxIds.forEach((id: number) => {
      if (blocked && ivaIds.has(id)) return;
      const taxCat = this.allTaxCategories.find((tc) => tc.id === id);
      if (taxCat) {
        // Extraer la tasa del primer tax_rate si no existe en el nivel superior
        const rawRate = taxCat.rate ?? taxCat.tax_rates?.[0]?.rate ?? 0;
        const rate = parseFloat(String(rawRate));
        totalTaxRate += isNaN(rate) ? 0 : rate;
      }
    });

    return basePrice * (1 + totalTaxRate);
  }

  get taxBreakdown(): { name: string; rate: number; amount: number }[] {
    const basePrice = Number(this.productForm.get('base_price')?.value || 0);
    const selectedTaxIds =
      this.productForm.get('tax_category_ids')?.value || [];
    // F4 — excluir IVA del desglose cuando el comercio no es responsable.
    const ivaIds = this.ivaTaxCategoryIdSet();
    const blocked = this.isVatBlocked();

    return selectedTaxIds
      .map((id: number) => {
        if (blocked && ivaIds.has(id)) return null;
        const taxCat = this.allTaxCategories.find((tc) => tc.id === id);
        if (!taxCat) return null;
        const rawRate = taxCat.rate ?? taxCat.tax_rates?.[0]?.rate ?? 0;
        const rate = parseFloat(String(rawRate));
        if (isNaN(rate) || rate === 0) return null;
        return { name: taxCat.name, rate, amount: basePrice * rate };
      })
      .filter(
        (
          entry: { name: string; rate: number; amount: number } | null,
        ): entry is { name: string; rate: number; amount: number } =>
          entry !== null,
      );
  }

  private allTaxCategories: TaxCategory[] = [];

  private loadProduct(id: number): void {
    this.productsService.getProductById(id).subscribe({
      next: (product: Product) => {
        this.product = product;
        this.onlinePurchaseProduct.set(product);
        this.patchForm(product);
        // Form ya poblado → render con `is_ingredient` resuelto (sin flash).
        this.productLoaded.set(true);
        // Auto-load tier rows if the product already has multi-tarifa enabled.
        if (product.has_multiple_price_tiers) {
          this.loadPriceTiersForProduct(id, product.enabled_price_tier_ids);
        }
        // QUI-431 — resumen de seriales (solo productos serializados; el getter
        // isSerialized lee el form ya parcheado arriba).
        this.loadSerialSummary();
      },
      error: (error: any) => {
        console.error('Error loading product:', error);
        this.toastService.error('Error al cargar el producto');
        this.router.navigate(['/admin/products']);
      },
    });
  }

  private patchForm(product: Product): void {
    // Extract category IDs from categories (API returns categories directly)
    const categoryIds = (product.categories || [])
      .map((c: ProductCategory) => c.id)
      .filter((id) => id !== undefined);

    // Extract tax category IDs
    const taxCategoryIds = (product.product_tax_assignments || [])
      .map((ta: any) => ta.tax_category_id)
      .filter((id) => id !== undefined);

    this.productForm.patchValue({
      name: product.name,
      slug: product.slug,
      description: product.description,
      cost_price: product.cost_price || 0,
      profit_margin: product.profit_margin || 0,
      base_price: product.base_price,
      is_on_sale: product.is_on_sale || false,
      sale_price: product.sale_price || 0,
      available_for_ecommerce: product.available_for_ecommerce !== false,
      is_featured: !!product.is_featured,
      allow_pos_price_override: product.allow_pos_price_override === true,
      sku: product.sku,
      barcode: product.barcode,
      stock_quantity: product.stock_quantity,
      track_inventory: product.track_inventory !== false,
      requires_serial_numbers: product.requires_serial_numbers ?? false,
      category_ids: categoryIds,
      brand_ids: product.brand?.id
        ? [product.brand.id]
        : product.brand_id
          ? [product.brand_id]
          : [],
      tax_category_ids: taxCategoryIds,
      state: product.state,
      pricing_type:
        (product.pricing_type as any)?.value || product.pricing_type || 'unit',
      product_type: product.product_type || 'physical',
      service_duration_minutes: product.service_duration_minutes || null,
      service_modality: product.service_modality || null,
      service_pricing_type: product.service_pricing_type || null,
      requires_booking: product.requires_booking || false,
      booking_mode: product.booking_mode || null,
      is_recurring: product.is_recurring || false,
      service_instructions: product.service_instructions || '',
      is_consultation: product.is_consultation || false,
      send_preconsultation: product.send_preconsultation || false,
      consultation_template_id: product.consultation_template_id || null,
      preconsultation_template_id:
        (product as any).preconsultation_template_id || null,
      preparation_time_minutes: product.preparation_time_minutes || null,
      // Multi-tarifa (Phase 4). Empaque ahora vive en cada tarifa.
      has_multiple_price_tiers: !!product.has_multiple_price_tiers,
      // Restaurant Suite toggles (Fase B)
      is_sellable: product.is_sellable !== false,
      is_ingredient: !!product.is_ingredient,
      is_combo: !!product.is_combo,
      is_batch_produced: !!product.is_batch_produced,
      // UoM FKs (Fase UoM)
      stock_uom_id: (product as any).stock_uom_id ?? null,
      purchase_uom_id: (product as any).purchase_uom_id ?? null,
      weight: product.weight || 0,
      dimensions: {
        length: product.dimensions?.length || 0,
        width: product.dimensions?.width || 0,
        height: product.dimensions?.height || 0,
      },
    });

    // Providers se auto-cargan vía effect() que observa requiresBookingSig
    // (el patchValue dispara valueChanges → espejea requires_booking en el signal)

    // Load images
    if (product.product_images && product.product_images.length > 0) {
      this.imageUrls = product.product_images.map((img: any) => img.image_url);
      this.imageIds = product.product_images.map((img: any) => img.id ?? null);
    } else {
      this.imageUrls = [];
      this.imageIds = [];
    }
    this.activeImageIndex = 0;
    this.mainImageIndex = Math.max(
      0,
      product.product_images?.findIndex((img: any) => !!img.is_main) ?? 0,
    );
    this.imagesTouched.set(false);
    this.refreshImageList();

    // Capture original baseline for strict variant/stock transition guards
    this.originalBaseStock.set(Number(product.stock_quantity ?? 0));
    this.originalHadVariants.set(
      !!(product.product_variants && product.product_variants.length > 0),
    );

    // Load variants if present
    if (product.product_variants && product.product_variants.length > 0) {
      this.hasVariants = true;
      this.generatedVariants = product.product_variants.map((v: any) => ({
        id: v.id,
        sku: v.sku,
        barcode: v.barcode ?? '',
        name: v.name || `${product.name} - ${v.sku}`,
        price:
          v.price_override !== undefined && v.price_override !== null
            ? Number(v.price_override)
            : Number(product.base_price),
        cost_price: Number(v.cost_price || product.cost_price || 0),
        profit_margin: Number(v.profit_margin || product.profit_margin || 0),
        is_on_sale: !!v.is_on_sale,
        sale_price: Number(v.sale_price || 0),
        stock: v.stock_quantity,
        attributes: v.attributes || {},
        image_url: v.product_images?.image_url || undefined,
        image_id: v.product_images?.id ?? v.image_id ?? undefined,
        track_inventory_override:
          v.track_inventory_override === undefined
            ? undefined
            : v.track_inventory_override,
      }));

      // Reconstruct variantAttributes from loaded variants
      const attributeMap = new Map<string, Set<string>>();
      for (const v of this.generatedVariants) {
        if (v.attributes) {
          for (const [key, value] of Object.entries(v.attributes)) {
            if (!attributeMap.has(key)) attributeMap.set(key, new Set());
            attributeMap.get(key)!.add(String(value));
          }
        }
      }
      this.variantAttributes = Array.from(attributeMap.entries()).map(
        ([name, values]) => ({ name, values: Array.from(values) }),
      );

      this.removedVariantKeys.clear();
      this.normalizeVariantTrackingForParent();
    }
  }

  private loadCategoriesAndBrands(): void {
    this.loadCategories();
    this.loadBrands();
    this.loadTaxCategories();
  }

  private loadCategories(): void {
    this.categoriesService.getAllCategories().subscribe({
      next: (categories: ProductCategory[]) => {
        this.categoryOptions = categories.map((cat: ProductCategory) => ({
          value: cat.id,
          label: cat.name,
          description: cat.description ?? undefined,
        }));
      },
      error: (error: any) => {
        console.error('Error loading categories:', error);
        const message = extractApiErrorMessage(error);
        this.toastService.error(message, 'Error al cargar categorías');
      },
    });
  }

  /**
   * F4 — Filtro defensivo: elimina ids de categorías IVA del payload cuando el
   * comercio no es responsable de IVA. El backend igualmente rechaza con
   * `FISCAL_VAT_NOT_RESPONSIBLE_001`; esto evita el viaje de ida/vuelta.
   */
  private sanitizeTaxCategoryIds(ids: number[]): number[] {
    if (!this.isVatBlocked()) return ids;
    const ivaIds = this.ivaTaxCategoryIdSet();
    return ids.filter((id) => !ivaIds.has(id));
  }

  private loadTaxCategories(): void {
    this.taxesService.getTaxCategories().subscribe({
      next: (taxCategories: TaxCategory[]) => {
        this.allTaxCategories = taxCategories;
        // F4 — alimenta el signal; `taxCategoryOptions` es un computed que
        // deriva las opciones (con candado en IVA si el comercio no es
        // responsable). Ver declaración de `taxCategoryOptions`.
        this.taxCategoriesSig.set(taxCategories);
      },
      error: (error: any) => {
        console.error('Error loading tax categories:', error);
        const message = extractApiErrorMessage(error);
        this.toastService.error(
          message,
          'Error al cargar categorías de impuestos',
        );
      },
    });
  }

  private loadBrands(): void {
    this.brandsService.getAllBrands().subscribe({
      next: (brands: Brand[]) => {
        this.brandOptions = brands.map((brand: Brand) => ({
          value: brand.id,
          label: brand.name,
          description: brand.description ?? undefined,
        }));

        // Re-set the brand value to force selector sync after options load
        const brandControl = this.productForm.get('brand_ids');
        if (brandControl?.value) {
          const currentValue = brandControl.value;
          brandControl.setValue(currentValue);
        }
      },
      error: (error: any) => {
        console.error('Error loading brands:', error);
        const message = extractApiErrorMessage(error);
        this.toastService.error(message, 'Error al cargar marcas');
      },
    });
  }

  get totalVariantStock(): number {
    return this.generatedVariants.reduce(
      (sum, v) => sum + (Number(v.stock) || 0),
      0,
    );
  }

  toggleVariants(isChecked: boolean): void {
    if (isChecked) {
      const currentSku = this.productForm.get('sku')?.value;
      if (!currentSku || currentSku.trim() === '') {
        this.dialogService
          .confirm({
            title: 'SKU requerido',
            message:
              'Para activar variantes necesitas configurar un SKU para el producto. Las variantes generan sus SKUs a partir del SKU del producto.',
            confirmText: 'Entendido',
            cancelText: 'Cancelar',
            confirmVariant: 'primary',
          })
          .then(() => {});
        return;
      }

      const currentStock = this.productForm.get('stock_quantity')?.value || 0;
      if (this.isEditMode() && currentStock > 0) {
        this.showStockTransferDialog(currentStock);
        return;
      }

      this.stockTransferMode = null;
      this.applyVariantToggle(true);
    } else {
      if (this.isEditMode() && this.generatedVariants.length > 0) {
        const totalVariantStock = this.totalVariantStock;
        this.dialogService
          .confirm({
            title: 'Desactivar variantes',
            message: `Al desactivar variantes, el stock de todas las variantes (${totalVariantStock} unidades) se transferirá al stock base del producto. Las variantes serán eliminadas.`,
            confirmText: 'Desactivar variantes',
            cancelText: 'Cancelar',
            confirmVariant: 'danger',
          })
          .then((confirmed: boolean) => {
            if (confirmed) {
              this.applyVariantToggle(false);
            }
          });
        return;
      }
      this.applyVariantToggle(false);
    }
  }

  private showStockTransferDialog(currentStock: number): void {
    this.dialogService
      .confirm({
        title: 'Transferir stock a variantes',
        message: `El producto tiene ${currentStock} unidades en stock. ¿Cómo deseas manejar el stock al activar variantes?`,
        confirmText: 'Asignar todo a la primera variante',
        cancelText: 'Cancelar',
        confirmVariant: 'primary',
      })
      .then(async (result: boolean) => {
        if (!result) {
          const distribute = await this.dialogService.confirm({
            title: 'Distribuir stock',
            message: `¿Deseas distribuir las ${currentStock} unidades equitativamente entre todas las variantes?`,
            confirmText: 'Distribuir equitativamente',
            cancelText: 'Cancelar',
            confirmVariant: 'primary',
          });
          if (distribute) {
            this.stockTransferMode = 'distribute';
            this.applyVariantToggle(true);
          }
          return;
        }
        this.stockTransferMode = 'first';
        this.applyVariantToggle(true);
      });
  }

  private applyVariantToggle(isChecked: boolean): void {
    this.hasVariants = isChecked;

    const priceControl = this.productForm.get('base_price');
    const stockControl = this.productForm.get('stock_quantity');

    if (this.hasVariants) {
      priceControl?.clearValidators();
      stockControl?.clearValidators();
      if (this.variantAttributes.length === 0) {
        this.variantAttributes.push({ name: '', values: [] });
      }
    } else {
      priceControl?.setValidators([Validators.required, Validators.min(0)]);
      stockControl?.setValidators([Validators.min(0)]);
    }
    priceControl?.updateValueAndValidity();
    stockControl?.updateValueAndValidity();
  }

  // Variant Attribute Management
  addQuickAttribute(name: string): void {
    // Don't add if an attribute with the same name already exists
    if (
      this.variantAttributes.some(
        (a) => a.name.toLowerCase() === name.toLowerCase(),
      )
    ) {
      this.toastService.warning(`El atributo "${name}" ya existe`);
      return;
    }
    this.variantAttributes.push({ name, values: [] });
  }

  addAttribute(): void {
    this.variantAttributes.push({ name: '', values: [] });
  }

  removeAttribute(index: number): void {
    this.variantAttributes.splice(index, 1);
    // Auto-reconcile when attributes change
    this.reconcileVariants();
  }

  addAttributeValue(attrIndex: number, event: Event): void {
    const attr = this.variantAttributes[attrIndex];
    const input = event.target;
    if (!(input instanceof HTMLInputElement)) return;

    const value = input.value.trim();
    if (!attr || !value) return;

    input.value = '';

    if (!attr.values.includes(value)) {
      attr.values.push(value);
      // Auto-generate only after the attribute has a name. This keeps
      // existing variants intact while the user is still configuring a row.
      if (!attr.name.trim()) return;
      this.reconcileVariants();
    }
  }

  removeAttributeValue(attrIndex: number, valueIndex: number): void {
    this.variantAttributes[attrIndex].values.splice(valueIndex, 1);
    // Auto-reconcile when values change
    this.reconcileVariants();
  }

  generateVariants(showToast = false): void {
    // Auto-generation: just reconcile variants from current attributes
    this.reconcileVariants();
  }

  /**
   * Non-destructive variant reconciliation.
   * Matches existing variants by sorted attribute key, preserving custom edits.
   */
  private reconcileVariants(): void {
    const validAttributes = this.variantAttributes.filter(
      (attr) => attr.name && attr.values.length > 0,
    );

    if (validAttributes.length === 0) {
      this.generatedVariants = [];
      return;
    }

    const combinations = this.cartesian(validAttributes.map((a) => a.values));
    const basePrice = this.productForm.get('base_price')?.value || 0;
    const baseCost = this.productForm.get('cost_price')?.value || 0;
    const baseMargin = this.productForm.get('profit_margin')?.value || 0;
    const baseSku = this.productForm.get('sku')?.value || '';

    // Build a lookup of existing variants by stable key
    const existingMap = new Map<string, GeneratedVariant>();
    for (const v of this.generatedVariants) {
      const key = ProductUtils.getVariantKey(v.attributes);
      existingMap.set(key, v);
    }

    const newVariants: GeneratedVariant[] = [];

    for (const combo of combinations) {
      const attributes: Record<string, string> = {};
      let nameSuffix = '';
      let skuSuffix = '';

      validAttributes.forEach((attr, index) => {
        const value = combo[index];
        attributes[attr.name] = value;
        nameSuffix += ` ${value}`;
        skuSuffix += `-${value.toUpperCase().substring(0, 3)}`;
      });

      const key = ProductUtils.getVariantKey(attributes);

      // Skip manually removed variants
      if (this.removedVariantKeys.has(key)) continue;

      // Reuse existing variant if attributes match
      const existing = existingMap.get(key);
      if (existing) {
        newVariants.push(existing);
        continue;
      }

      // New stock-tracked product variants manage their own stock. Variants for
      // products sold on demand inherit the parent availability instead.
      newVariants.push({
        name: `${this.productForm.get('name')?.value || 'Product'}${nameSuffix}`,
        sku: baseSku ? `${baseSku}${skuSuffix}` : '',
        price: basePrice,
        cost_price: baseCost,
        profit_margin: baseMargin,
        is_on_sale: false,
        sale_price: 0,
        stock: 0,
        attributes,
        track_inventory_override:
          this.getDefaultVariantTrackInventoryOverride(),
      });
    }

    this.generatedVariants = newVariants;
  }

  private getDefaultVariantTrackInventoryOverride(): boolean | undefined {
    return this.productForm.get('track_inventory')?.value === true
      ? true
      : undefined;
  }

  private normalizeVariantTrackingForParent(): void {
    if (this.productForm.get('track_inventory')?.value === true) return;

    let changed = false;
    this.generatedVariants = this.generatedVariants.map((variant) => {
      if (variant.track_inventory_override !== true) return variant;

      changed = true;
      return {
        ...variant,
        track_inventory_override: undefined,
      };
    });

    if (changed) {
      this.formUpdateTrigger.update((value) => value + 1);
    }
  }

  confirmAttributeName(attrIndex: number, event: Event): void {
    event.preventDefault();
    this.onAttributeNameBlur(attrIndex);
  }

  onAttributeNameBlur(attrIndex: number): void {
    const attr = this.variantAttributes[attrIndex];
    if (!attr || !attr.name.trim()) return;

    attr.name = attr.name.trim();

    // Only reconcile if there are values to generate variants with
    if (attr.values.length > 0) {
      this.reconcileVariants();
    }
  }

  private cartesian(args: any[][]): any[] {
    const r: any[] = [];
    const max = args.length - 1;
    function helper(arr: any[], i: number) {
      for (let j = 0, l = args[i].length; j < l; j++) {
        const a = arr.slice(0); // clone arr
        a.push(args[i][j]);
        if (i == max) r.push(a);
        else helper(a, i + 1);
      }
    }
    if (args.length > 0) helper([], 0);
    return r;
  }

  // --- Variant Pricing (anchored: cost & price drive margin; margin drives price) ---
  private variantIsCalculating = false;

  // Anchoring model (QUI-425): cost is an ANCHOR → editing cost re-derives
  // profit_margin so price stays put.
  onVariantCostChange(variant: GeneratedVariant): void {
    if (this.variantIsCalculating) return;
    const cost = Number(variant.cost_price || 0);
    const price = Number(variant.price || 0);
    if (cost > 0) {
      this.variantIsCalculating = true;
      variant.profit_margin = Number(
        (((price - cost) / cost) * 100).toFixed(2),
      );
      this.variantIsCalculating = false;
    }
  }

  // LEVER: editing margin explicitly → recalculate price.
  onVariantMarginChange(variant: GeneratedVariant): void {
    if (this.variantIsCalculating) return;
    this.variantIsCalculating = true;
    const cost = Number(variant.cost_price || 0);
    const margin = Number(variant.profit_margin || 0);
    variant.price = Number((cost * (1 + margin / 100)).toFixed(2));
    this.variantIsCalculating = false;
  }

  // ANCHOR: editing price explicitly → re-derive margin.
  onVariantPriceChange(variant: GeneratedVariant): void {
    if (this.variantIsCalculating) return;
    const cost = Number(variant.cost_price || 0);
    const price = Number(variant.price || 0);
    if (cost > 0) {
      this.variantIsCalculating = true;
      variant.profit_margin = Number(
        (((price - cost) / cost) * 100).toFixed(2),
      );
      this.variantIsCalculating = false;
    }
  }

  getVariantPriceWithTax(variant: GeneratedVariant): number {
    const activePrice =
      variant.is_on_sale && variant.sale_price
        ? Number(variant.sale_price)
        : Number(variant.price || 0);

    const selectedTaxIds =
      this.productForm.get('tax_category_ids')?.value || [];
    let totalTaxRate = 0;
    selectedTaxIds.forEach((id: number) => {
      const taxCat = this.allTaxCategories.find((tc) => tc.id === id);
      if (taxCat) {
        const rawRate = taxCat.rate ?? taxCat.tax_rates?.[0]?.rate ?? 0;
        const rate = parseFloat(String(rawRate));
        totalTaxRate += isNaN(rate) ? 0 : rate;
      }
    });

    return activePrice * (1 + totalTaxRate);
  }

  // --- Variant Image Handling (modal: archivo, URL, cámara, recorte, IA) ---
  openVariantImageModal(idx: number): void {
    this.editingVariantIndex.set(idx);
    this.isVariantImageModalOpen.set(true);
  }

  openVariantImageEditor(idx: number): void {
    const variant = this.generatedVariants[idx];
    if (!variant?.image_url) {
      this.toastService.warning('La variante no tiene imagen para ajustar');
      return;
    }
    this.editingVariantIndex.set(idx);
    this.isVariantImageEditModalOpen.set(true);
  }

  openVariantImageAi(idx: number): void {
    const variant = this.generatedVariants[idx];
    if (!variant?.image_url) {
      this.toastService.warning('La variante no tiene imagen para mejorar');
      return;
    }
    this.editingVariantIndex.set(idx);
    this.isVariantAiModalOpen.set(true);
  }

  onVariantImagesAdded(images: string[]): void {
    const idx = this.editingVariantIndex();
    if (idx === null || !images?.length) {
      this.isVariantImageModalOpen.set(false);
      return;
    }
    const variant = this.generatedVariants[idx];
    if (!variant) {
      this.isVariantImageModalOpen.set(false);
      return;
    }
    variant.image_url = images[0];
    variant.image_file = undefined;
    variant.image_id = undefined;
    this.generatedVariants = [...this.generatedVariants];
    // ⚠️ NO llamar markImagesTouched() aquí.
    // Las imágenes de variantes son independientes de las imágenes principales
    // del producto. Si marcamos imagesTouched, el backend borra TODAS las
    // imágenes de variantes y del producto en su bloque de re-upload.
    this.isVariantImageModalOpen.set(false);
  }

  onVariantImageEdited(image: string): void {
    const idx = this.editingVariantIndex();
    if (idx === null) {
      this.isVariantImageEditModalOpen.set(false);
      return;
    }
    const variant = this.generatedVariants[idx];
    if (!variant) {
      this.isVariantImageEditModalOpen.set(false);
      return;
    }
    variant.image_url = image;
    variant.image_file = undefined;
    variant.image_id = undefined;
    this.generatedVariants = [...this.generatedVariants];
    // ⚠️ NO llamar markImagesTouched() aquí (ver onVariantImagesAdded).
    this.isVariantImageEditModalOpen.set(false);
    this.toastService.success('Imagen ajustada correctamente');
  }

  onVariantAiReplace(newImageUrl: string): void {
    const idx = this.editingVariantIndex();
    if (idx === null) {
      this.isVariantAiModalOpen.set(false);
      return;
    }
    const variant = this.generatedVariants[idx];
    if (!variant) {
      this.isVariantAiModalOpen.set(false);
      return;
    }
    variant.image_url = newImageUrl;
    variant.image_file = undefined;
    variant.image_id = undefined;
    this.generatedVariants = [...this.generatedVariants];
    // ⚠️ NO llamar markImagesTouched() aquí (ver onVariantImagesAdded).
    this.isVariantAiModalOpen.set(false);
    this.toastService.success('Imagen reemplazada por la versión IA');
  }

  // Una variante solo permite 1 foto, por lo que "conservar ambas" se trata como reemplazo.
  onVariantAiKeep(newImageUrl: string): void {
    this.onVariantAiReplace(newImageUrl);
  }

  trackByIndex(index: number): number {
    return index;
  }

  get previewVariantCount(): number {
    const validAttributes = this.variantAttributes.filter(
      (attr) => attr.name && attr.values.length > 0,
    );
    if (validAttributes.length === 0) return 0;
    return validAttributes.reduce(
      (total, attr) => total * attr.values.length,
      1,
    );
  }

  applyBasePriceToAll(): void {
    const basePrice = Number(this.productForm.get('base_price')?.value || 0);
    const baseCost = Number(this.productForm.get('cost_price')?.value || 0);
    const baseMargin = Number(
      this.productForm.get('profit_margin')?.value || 0,
    );
    this.generatedVariants.forEach((v) => {
      v.price = basePrice;
      v.cost_price = baseCost;
      v.profit_margin = baseMargin;
    });
    this.toastService.success(
      `Precio base aplicado a ${this.generatedVariants.length} variantes`,
    );
  }

  applyBaseCostToAll(): void {
    const baseCost = Number(this.productForm.get('cost_price')?.value || 0);
    const baseMargin = Number(
      this.productForm.get('profit_margin')?.value || 0,
    );
    this.generatedVariants.forEach((v) => {
      v.cost_price = baseCost;
      v.profit_margin = baseMargin;
      v.price = Number((baseCost * (1 + baseMargin / 100)).toFixed(2));
    });
    this.toastService.success(
      `Costo base aplicado a ${this.generatedVariants.length} variantes`,
    );
  }

  toggleVariantExpand(idx: number): void {
    this.expandedVariantIndex.update((current) =>
      current === idx ? null : idx,
    );
  }

  async removeVariant(idx: number): Promise<void> {
    const confirmed = await this.dialogService.confirm({
      title: 'Eliminar Variante',
      message: `¿Estás seguro de eliminar la variante "${this.generatedVariants[idx]?.name}"?`,
      confirmText: 'Eliminar',
      cancelText: 'Cancelar',
      confirmVariant: 'danger',
    });
    if (!confirmed) return;

    const variant = this.generatedVariants[idx];

    // If the variant exists in DB, delete it via API first
    if (variant.id) {
      try {
        await this.productsService.deleteProductVariant(variant.id).toPromise();
        this.toastService.success('Variante eliminada correctamente');
      } catch (err: any) {
        console.error('Error deleting variant:', err);
        this.toastService.error('Error al eliminar la variante');
        return; // Don't remove from UI if backend failed
      }
    }

    // Track removed key so generateVariants() won't recreate it on blur
    if (variant.attributes && Object.keys(variant.attributes).length > 0) {
      this.removedVariantKeys.add(
        ProductUtils.getVariantKey(variant.attributes),
      );
    }
    this.generatedVariants.splice(idx, 1);

    // Rebuild variantAttributes from remaining variants so the UI
    // removes attribute values that no longer have any variant.
    this.rebuildAttributesFromVariants();
  }

  private rebuildAttributesFromVariants(): void {
    if (this.generatedVariants.length === 0) {
      this.variantAttributes = [];
      return;
    }

    const attributeMap = new Map<string, Set<string>>();
    for (const v of this.generatedVariants) {
      if (v.attributes) {
        for (const [key, value] of Object.entries(v.attributes)) {
          if (!attributeMap.has(key)) attributeMap.set(key, new Set());
          attributeMap.get(key)!.add(String(value));
        }
      }
    }
    this.variantAttributes = Array.from(attributeMap.entries()).map(
      ([name, values]) => ({ name, values: Array.from(values) }),
    );
  }

  async removeVariantImage(idx: number): Promise<void> {
    const variant = this.generatedVariants[idx];

    // If the image exists in DB, delete it via API (also removes from S3)
    if (variant.image_id) {
      try {
        await this.productsService
          .deleteProductImage(variant.image_id)
          .toPromise();
      } catch (err: any) {
        console.error('Error deleting variant image:', err);
        this.toastService.error('Error al eliminar la imagen de variante');
        return;
      }
    }

    this.generatedVariants[idx].image_url = undefined;
    this.generatedVariants[idx].image_file = undefined;
    this.generatedVariants[idx].image_id = undefined;
  }

  // ... (Copy basic handlers from Modal: ImageUrl, FileSelect, etc.) ...
  onCategoryCreated(category: ProductCategory): void {
    this.loadCategories();
    // Add to current selection
    const currentIds = this.productForm.get('category_ids')?.value || [];
    if (category && category.id) {
      this.productForm.patchValue({
        category_ids: [...currentIds, category.id],
      });
    }
    this.isCategoryCreateOpen = false;
  }

  onBrandCreated(brand: Brand): void {
    this.loadBrands();
    if (brand && brand.id) {
      this.productForm.patchValue({ brand_ids: [brand.id] });
    }
    this.isBrandCreateOpen = false;
  }

  onTaxCategoryCreated(taxCategory: TaxCategory): void {
    this.loadTaxCategories();
    // Add to current selection
    const currentIds = this.productForm.get('tax_category_ids')?.value || [];
    if (taxCategory && taxCategory.id) {
      this.productForm.patchValue({
        tax_category_ids: [...currentIds, taxCategory.id],
      });
    }
    // Keep modal open for creating another
  }

  /** Stock total en inventario (disponible + reservado) */
  get totalStockOnHand(): number {
    return (this.product?.stock_levels || []).reduce(
      (sum, sl: any) =>
        sum + (sl.quantity_available || 0) + (sl.quantity_reserved || 0),
      0,
    );
  }

  /** Stock disponible para venta */
  get totalStockAvailable(): number {
    return (this.product?.stock_levels || []).reduce(
      (sum, sl: any) => sum + (sl.quantity_available || 0),
      0,
    );
  }

  /** Stock reservado en órdenes pendientes */
  get totalStockReserved(): number {
    return (this.product?.stock_levels || []).reduce(
      (sum, sl: any) => sum + (sl.quantity_reserved || 0),
      0,
    );
  }

  /** Ubicaciones con stock activo (al menos 1 unidad) */
  get activeLocationCount(): number {
    return (this.product?.stock_levels || []).filter(
      (sl: any) =>
        (sl.quantity_available || 0) + (sl.quantity_reserved || 0) > 0,
    ).length;
  }

  /** Total de ubicaciones asignadas */
  get warehouseCount(): number {
    return (this.product?.stock_levels || []).length;
  }

  // ===== Modelo B: vista por unidades selladas en el panel de inventario =====
  /** True si el producto es insumo con capacidad por unidad (factor > 0). */
  get isIngredientStock(): boolean {
    const factor = Number((this.product as any)?.purchase_to_stock_factor);
    return !!(this.product as any)?.is_ingredient && factor > 0;
  }
  /** Capacidad (volumen) por unidad sellada, ej. 1000 ml. */
  private get stockCapacity(): number {
    return Number((this.product as any)?.purchase_to_stock_factor) || 1;
  }
  /**
   * Etiqueta de la unidad mínima de stock (ml, g, ...). Se resuelve desde el
   * catálogo UoM (`uomOptions()`) por `stock_uom_id` del producto — mismo
   * patrón que `unitCapacity`. Lee la señal `uomOptions()` así que reacciona
   * cuando el catálogo resuelve. Fallback al legacy `stock_unit` (casi siempre
   * vacío) solo si el catálogo no resuelve el id. Alimenta los 3 bloques del
   * "Desglose del insumo" (volumen abierto / capacidad / volumen total); los
   * envases sellados se etiquetan aparte en "und".
   */
  get stockUnitLabel(): string {
    const stockId = Number((this.product as any)?.stock_uom_id ?? 0);
    if (stockId) {
      const code = this.uomOptions().find((u) => u.id === stockId)?.code;
      if (code) return code;
    }
    return ((this.product as any)?.stock_unit as string) || '';
  }
  /**
   * "En inventario" mostrado: unidades selladas (floor(total/capacidad)) para
   * insumos; el total crudo para retail. `totalStockOnHand` permanece en la
   * unidad mínima para reservas/ajustes.
   */
  get displayStockOnHand(): number {
    return this.isIngredientStock
      ? Math.floor(this.totalStockOnHand / this.stockCapacity)
      : this.totalStockOnHand;
  }
  /** "Disponible" mostrado: unidades selladas para insumos; raw para retail. */
  get displayStockAvailable(): number {
    return this.isIngredientStock
      ? Math.floor(this.totalStockAvailable / this.stockCapacity)
      : this.totalStockAvailable;
  }

  /**
   * Volumen restante en el envase actualmente abierto, en unidad mínima
   * (ej. 680 ml de un envase de 1000 ml). Espeja el backend
   * `deriveUoMSplit` → `qty % capacidad`. 0 para retail o sin envase abierto.
   */
  get stockOpenRemaining(): number {
    return this.isIngredientStock
      ? this.totalStockOnHand % this.stockCapacity
      : 0;
  }

  /** Capacidad (volumen) por envase sellado, ej. 1000 ml. Público para display. */
  get stockUnitCapacity(): number {
    return this.isIngredientStock ? this.stockCapacity : 0;
  }

  /** Unidades selladas en una bodega concreta (modal de detalle por ubicación). */
  slSealedUnits(sl: any): number {
    const qty = Number(sl?.quantity_on_hand ?? 0);
    return this.isIngredientStock ? Math.floor(qty / this.stockCapacity) : qty;
  }

  /** Volumen abierto en una bodega concreta (modal de detalle por ubicación). */
  slOpenRemaining(sl: any): number {
    return this.isIngredientStock
      ? Number(sl?.quantity_on_hand ?? 0) % this.stockCapacity
      : 0;
  }

  isStockLevelLowStock(stockLevel: any): boolean {
    return (
      Number(stockLevel?.quantity_available ?? 0) <=
      this.getStockLevelLowStockThreshold(stockLevel)
    );
  }

  getStockLevelLowStockThreshold(stockLevel: any): number {
    const stockLevelThreshold = Number(stockLevel?.reorder_point);
    if (Number.isFinite(stockLevelThreshold) && stockLevelThreshold > 0) {
      return stockLevelThreshold;
    }

    const productThreshold = [
      this.product?.reorder_point,
      this.product?.min_stock_level,
    ]
      .map((value) => Number(value))
      .find((value) => Number.isFinite(value) && value > 0);

    if (productThreshold !== undefined) {
      return productThreshold;
    }

    const configuredThreshold = Number(this.product?.low_stock_threshold);
    return Number.isFinite(configuredThreshold) && configuredThreshold >= 0
      ? configuredThreshold
      : 10;
  }

  isExpired(date: Date | string): boolean {
    if (!date) return false;
    const expiryDate = new Date(date);
    const today = new Date();
    return expiryDate < today;
  }

  async releaseReservations(): Promise<void> {
    if (!this.product?.id || this.totalStockReserved === 0) return;

    const confirmed = await this.dialogService.confirm({
      title: 'Liberar Reservas',
      message: `Se liberarán ${this.totalStockReserved} unidades reservadas de este producto. Las reservas activas serán canceladas y el stock quedará disponible nuevamente.`,
      confirmText: 'Liberar Reservas',
      cancelText: 'Cancelar',
      confirmVariant: 'danger',
    });

    if (!confirmed) return;

    this.isReleasingReservations = true;
    this.inventoryService
      .releaseReservationsByProduct(this.product.id)
      .subscribe({
        next: (response) => {
          const data = response.data;
          this.toastService.success(
            `${data.released_count} reserva(s) liberadas (${data.total_quantity} unidades)`,
          );
          this.loadProduct(this.productId!);
          this.isReleasingReservations = false;
        },
        error: (error) => {
          this.toastService.error('Error al liberar reservas: ' + error);
          this.isReleasingReservations = false;
        },
      });
  }

  private refreshImageList(): void {
    this.imageListVersion.update((version) => version + 1);
  }

  private markImagesTouched(): void {
    this.imagesTouched.set(true);
    this.refreshImageList();
  }

  triggerFileUpload(): void {
    this.openImageSourceModal();
  }

  openImageSourceModal(): void {
    if (this.imageUrls.length >= 5) {
      this.toastService.warning('Límite de 5 imágenes alcanzado');
      return;
    }
    this.imageModalMode.set('add');
    this.imageEditSourceUrl.set(null);
    this.editingImageIndex.set(null);
    this.isImageSourceModalOpen.set(true);
  }

  openImageEditor(index = this.activeImageIndex): void {
    const sourceUrl = this.imageUrls[index];
    if (!sourceUrl) {
      this.toastService.warning('Selecciona una imagen para editar');
      return;
    }

    this.imageModalMode.set('edit');
    this.imageEditSourceUrl.set(sourceUrl);
    this.editingImageIndex.set(index);
    this.isImageSourceModalOpen.set(true);
  }

  openImageAiEnhancer(index = this.activeImageIndex): void {
    const sourceUrl = this.imageUrls[index];
    if (!sourceUrl) {
      this.toastService.warning('Selecciona una imagen para mejorar con IA');
      return;
    }

    this.aiEnhanceImageUrl.set(sourceUrl);
    this.aiEnhanceImageIndex.set(index);
    this.isImageAiEnhanceModalOpen.set(true);
  }

  onImagesFromModal(urls: string[]): void {
    if (!urls?.length) return;
    const remaining = Math.max(0, 5 - this.imageUrls.length);
    const toAdd = urls.slice(0, remaining);
    for (const dataUrl of toAdd) {
      this.imageUrls.push(dataUrl);
      this.imageIds.push(null);
    }
    if (this.imageUrls.length === toAdd.length) {
      this.activeImageIndex = 0;
    }
    if (toAdd.length > 0) {
      this.markImagesTouched();
    }
    if (toAdd.length > 0) {
      this.toastService.success(`${toAdd.length} imagen(es) agregada(s)`);
    }
    if (urls.length > toAdd.length) {
      this.toastService.warning(
        `Se omitieron ${urls.length - toAdd.length} imagen(es) por el límite de 5`,
      );
    }
  }

  onImageEdited(dataUrl: string): void {
    const index = this.editingImageIndex();
    if (index === null || !this.imageUrls[index]) return;

    this.imageUrls[index] = dataUrl;
    this.imageIds[index] = null;
    this.activeImageIndex = index;
    this.markImagesTouched();
    this.toastService.success('Imagen ajustada correctamente');
  }

  onAiImageReplace(dataUrl: string): void {
    const index = this.aiEnhanceImageIndex();
    if (index === null || !this.imageUrls[index]) return;

    this.imageUrls[index] = dataUrl;
    this.imageIds[index] = null;
    this.activeImageIndex = index;
    this.markImagesTouched();
    this.toastService.success('Imagen reemplazada por la versión IA');
  }

  onAiImageKeepBoth(dataUrl: string): void {
    if (this.imageUrls.length >= 5) {
      this.toastService.warning('Límite de 5 imágenes alcanzado');
      return;
    }

    this.imageUrls.push(dataUrl);
    this.imageIds.push(null);
    this.activeImageIndex = this.imageUrls.length - 1;
    this.markImagesTouched();
    this.toastService.success('Versión IA agregada como nueva imagen');
  }

  async onFileSelect(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const files = input.files;
    if (!files) return;

    const filesArray = Array.from(files);
    const remainingSlots = 5 - this.imageUrls.length;

    if (remainingSlots <= 0) {
      this.toastService.warning('Límite de 5 imágenes alcanzado');
      input.value = '';
      return;
    }

    const filesToProcess = filesArray
      .slice(0, remainingSlots)
      .filter((file) => file.type.startsWith('image/'));

    if (filesToProcess.length === 0) {
      this.toastService.warning(
        'Por favor selecciona archivos de imagen válidos',
      );
      input.value = '';
      return;
    }

    this.isLoadingImages.set(true);
    this.loadingProgress.set(0);

    let successCount = 0;
    try {
      for (let i = 0; i < filesToProcess.length; i++) {
        const file = filesToProcess[i];
        try {
          const dataUrl = await this.readFileAsDataURL(file);
          this.imageUrls.push(dataUrl);
          this.imageIds.push(null);
          this.markImagesTouched();
          successCount++;
        } catch (err) {
          this.toastService.error(`Error al cargar la imagen: ${file.name}`);
        }
        this.loadingProgress.set(
          Math.round(((i + 1) / filesToProcess.length) * 100),
        );
      }
      if (this.imageUrls.length === 1) {
        this.activeImageIndex = 0;
      }
      if (successCount > 0) {
        this.toastService.success(
          `${successCount} imagen(es) cargada(s) correctamente`,
        );
      }
    } finally {
      this.isLoadingImages.set(false);
      this.loadingProgress.set(0);
      input.value = '';
    }
  }

  private readFileAsDataURL(file: File, timeoutMs = 30_000): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      const timer = setTimeout(() => {
        reader.abort();
        reject(new Error(`Timeout leyendo ${file.name}`));
      }, timeoutMs);

      reader.onload = (e) => {
        clearTimeout(timer);
        const result = e.target?.result;
        if (typeof result === 'string') {
          resolve(result);
        } else {
          reject(new Error(`Resultado inválido leyendo ${file.name}`));
        }
      };
      reader.onerror = () => {
        clearTimeout(timer);
        reject(reader.error ?? new Error(`Error leyendo ${file.name}`));
      };
      reader.onabort = () => {
        clearTimeout(timer);
        reject(new Error(`Lectura abortada: ${file.name}`));
      };
      reader.readAsDataURL(file);
    });
  }

  removeImage(index: number): void {
    this.imageUrls.splice(index, 1);
    this.imageIds.splice(index, 1);
    this.markImagesTouched();

    if (this.imageUrls.length === 0) {
      this.mainImageIndex = 0;
      this.activeImageIndex = 0;
      return;
    }

    if (index < this.mainImageIndex) {
      this.mainImageIndex--;
    } else if (index === this.mainImageIndex) {
      this.mainImageIndex = Math.min(index, this.imageUrls.length - 1);
    }

    if (index < this.activeImageIndex) {
      this.activeImageIndex--;
    } else if (index === this.activeImageIndex) {
      this.activeImageIndex = Math.min(index, this.imageUrls.length - 1);
    }

    this.mainImageIndex = Math.max(
      0,
      Math.min(this.mainImageIndex, this.imageUrls.length - 1),
    );
    this.activeImageIndex = Math.max(
      0,
      Math.min(this.activeImageIndex, this.imageUrls.length - 1),
    );
  }

  setActiveImage(index: number): void {
    this.activeImageIndex = index;
  }

  setMainImage(index: number): void {
    this.mainImageIndex = index;
    this.activeImageIndex = index;
    this.markImagesTouched();
  }

  nextImage(): void {
    if (this.imageUrls.length === 0) return;
    this.activeImageIndex = (this.activeImageIndex + 1) % this.imageUrls.length;
  }

  prevImage(): void {
    if (this.imageUrls.length === 0) return;
    this.activeImageIndex =
      (this.activeImageIndex - 1 + this.imageUrls.length) %
      this.imageUrls.length;
  }

  onImageError(event: Event): void {
    const img = event.target as HTMLImageElement;
    img.src =
      'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjQiIGhlaWdodD0iMjQiIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPHJlY3Qgd2lkdGg9IjI0IiBoZWlnaHQ9IjI0IiBmaWxsPSIjRjRNEY2Ii8+CjxwYXRoIGQ9Ik0xMiA2VjEwTDEwIDhMMTIgNlpNMTIgNlYxMEwxNCA4TDEyIDZaIiBmaWxsPSIjOUNBM0FGIi8+Cjwvc3ZnPgo=';
  }

  private isValidUrl(string: string): boolean {
    try {
      new URL(string);
      return true;
    } catch (_) {
      return false;
    }
  }

  onCancel(): void {
    const returnPage = this.route.snapshot.queryParams['fromPage'] || 1;
    this.router.navigate(['/admin/products'], {
      queryParams: { page: returnPage },
    });
  }

  onHeaderAction(actionId: string): void {
    if (actionId === 'cancel') this.onCancel();
    else if (actionId === 'save') this.onSubmit();
  }

  preventNativeFormSubmit(event: SubmitEvent): void {
    event.preventDefault();
  }

  preventImplicitEnterSubmit(event: Event): void {
    const target = event.target;
    if (!(target instanceof HTMLInputElement)) return;

    const submitSafeTypes = new Set([
      'button',
      'checkbox',
      'file',
      'radio',
      'reset',
      'submit',
    ]);
    if (submitSafeTypes.has(target.type)) return;

    event.preventDefault();
  }

  onSubmit(): void {
    if (this.productForm.invalid || this.isSubmitting()) {
      this.productForm.markAllAsTouched();
      const saleErr = this.productForm.errors?.['saleLessThanBase'];
      if (saleErr) {
        this.toastService.error(
          'El precio de oferta debe ser menor al precio base.',
          'Precio de oferta inválido',
        );
      } else {
        this.toastService.error(
          'Por favor, completa todos los campos requeridos correctamente',
          'Formulario inválido',
        );
      }
      return;
    }

    // Variant-specific validations
    if (this.hasVariants) {
      // Must have at least one variant
      if (this.generatedVariants.length === 0) {
        this.toastService.error(
          'Debes crear al menos una variante. Agrega atributos con valores para generar variantes automáticamente.',
          'Variantes requeridas',
        );
        return;
      }

      // Check for duplicate SKUs
      if (this.hasDuplicateSkus) {
        this.toastService.error(
          'Hay SKUs duplicados entre las variantes. Cada variante debe tener un SKU único.',
          'SKUs duplicados',
        );
        return;
      }

      // Check for empty SKUs in variants
      const emptySkuVariants = this.generatedVariants.filter(
        (v) => !v.sku || v.sku.trim() === '',
      );
      if (emptySkuVariants.length > 0) {
        this.toastService.error(
          `${emptySkuVariants.length} variante(s) no tienen SKU configurado. Cada variante necesita un SKU único.`,
          'SKU requerido',
        );
        return;
      }

      // Strict guard: edit mode, transitioning simple→variants, base stock > 0.
      // Force a non-reset mode AND ensure variant totals match the base stock
      // (no stock can be "lost" in the transition).
      const baseline = this.originalBaseStock();
      const isTransitioning =
        this.isEditMode() && !this.originalHadVariants() && baseline > 0;
      if (isTransitioning) {
        if (!this.stockTransferMode || this.stockTransferMode === 'reset') {
          this.toastService.error(
            "Debes redistribuir el stock base. Elige 'Asignar a una variante' o 'Distribuir'.",
            'Redistribución requerida',
          );
          this.showStockTransferDialog(baseline);
          return;
        }
        if (this.totalVariantStock !== baseline) {
          this.toastService.error(
            `La suma de stock de las variantes (${this.totalVariantStock}) debe igualar el stock base original (${baseline}).`,
            'Totales desalineados',
          );
          return;
        }
      }

      // Track-inventory products with variants must declare at least one unit of stock
      // across the variants (otherwise the product becomes unsellable silently).
      const trackInventoryEnabled =
        !!this.productForm.get('track_inventory')?.value;
      if (trackInventoryEnabled) {
        const allVariantsTrackInventory = this.generatedVariants.every((v) => {
          if (v.track_inventory_override === false) return false;
          return true;
        });
        if (allVariantsTrackInventory && this.totalVariantStock <= 0) {
          this.toastService.error(
            'Todas las variantes que manejan stock tienen 0 unidades. Asigna al menos 1 unidad antes de guardar.',
            'Stock de variantes requerido',
          );
          return;
        }
      }

      const invalidSaleVariant = this.generatedVariants.find((v) => {
        if (!v.is_on_sale) return false;
        const salePrice = Number(v.sale_price || 0);
        const regularPrice = Number(v.price || 0);
        return salePrice <= 0 || salePrice >= regularPrice;
      });
      if (invalidSaleVariant) {
        this.toastService.error(
          `La oferta de la variante ${invalidSaleVariant.sku} debe ser mayor a 0 y menor que su precio regular.`,
          'Precio de oferta inválido',
        );
        return;
      }
    }

    // Fase 1: defense-in-depth — if the user is submitting a pure-ingredient
    // product, neutralize retail fields right here so the payload cannot leak
    // sale data even if a UI race left a value behind. Idempotent.
    this.applyIngredientRetailControls();
    this.isSubmitting.set(true);
    const formValue = this.productForm.getRawValue();

    // Prepare Images
    const images: CreateProductImageDto[] = this.imageUrls.map(
      (url, index) => ({
        image_url: url,
        is_main: index === this.mainImageIndex,
      }),
    );
    const shouldSendImages = this.isEditMode()
      ? this.imagesTouched()
      : images.length > 0;

    const isServiceType = formValue.product_type === 'service';

    // Fase 1: pure-ingredient short-circuit. If the product is a pure
    // ingredient (is_ingredient && !is_sellable) we DO NOT trust the form
    // value for retail-sale constructs; we force them to neutral values
    // and let the backend ignore them. This keeps the persisted DTO
    // coherent regardless of UI state.
    const isPureIngredient = !!formValue.is_ingredient && !formValue.is_sellable;
    const neutral = (v: any, fallback: any) => (isPureIngredient ? fallback : v);

    // Basic DTO
    const productData: CreateProductDto = {
      name: formValue.name,
      slug: formValue.slug || undefined,
      description: formValue.description || undefined,
      cost_price: Number(formValue.cost_price),
      profit_margin: Number(formValue.profit_margin),
      base_price: Number(neutral(formValue.base_price, 0)),
      is_on_sale: !!neutral(formValue.is_on_sale, false),
      sale_price: Number(neutral(formValue.sale_price, 0)),
      available_for_ecommerce: !!neutral(formValue.available_for_ecommerce, false),
      is_featured: !!neutral(formValue.is_featured, false),
      allow_pos_price_override: !!neutral(formValue.allow_pos_price_override, false),
      sku: formValue.sku || undefined,
      barcode: formValue.barcode || undefined,
      track_inventory: isServiceType ? false : !!formValue.track_inventory,
      requires_serial_numbers: !!formValue.requires_serial_numbers,
      stock_quantity: isServiceType
        ? undefined
        : formValue.track_inventory
          ? Number(formValue.stock_quantity)
          : undefined,
      category_ids: formValue.category_ids || [],
      // F4 — filtro defensivo de ids IVA cuando el comercio no es responsable.
      tax_category_ids: this.sanitizeTaxCategoryIds(
        formValue.tax_category_ids || [],
      ),
      brand_id: formValue.brand_ids?.[0]
        ? Number(formValue.brand_ids[0])
        : null,
      state: formValue.state || ProductState.ACTIVE,
      pricing_type:
        typeof formValue.pricing_type === 'object'
          ? formValue.pricing_type.value
          : formValue.pricing_type || 'unit',
      // Un insumo es SIEMPRE producto físico (nunca servicio ni plato).
      // Se fuerza aquí además del gating del form, por robustez ante datos
      // contradictorios o carreras de UI.
      product_type: formValue.is_ingredient
        ? 'physical'
        : formValue.product_type || 'physical',
      preparation_time_minutes: formValue.preparation_time_minutes
        ? Number(formValue.preparation_time_minutes)
        : undefined,
      // Service-specific fields
      ...(isServiceType && {
        service_duration_minutes: formValue.service_duration_minutes
          ? Number(formValue.service_duration_minutes)
          : undefined,
        service_modality: formValue.service_modality || undefined,
        service_pricing_type: formValue.service_pricing_type || undefined,
        requires_booking: !!formValue.requires_booking,
        booking_mode: formValue.booking_mode || undefined,
        is_recurring: !!formValue.is_recurring,
        service_instructions: formValue.service_instructions || undefined,
        is_consultation: !!formValue.is_consultation,
        send_preconsultation: !!formValue.send_preconsultation,
        consultation_template_id: formValue.consultation_template_id || null,
        preconsultation_template_id:
          formValue.preconsultation_template_id || null,
      }),
      images: shouldSendImages ? images : undefined,
      weight: isServiceType
        ? undefined
        : formValue.weight > 0
          ? Number(formValue.weight)
          : undefined,
      dimensions: isServiceType
        ? undefined
        : formValue.dimensions &&
            (formValue.dimensions.length > 0 ||
              formValue.dimensions.width > 0 ||
              formValue.dimensions.height > 0)
          ? {
              length: Number(formValue.dimensions.length),
              width: Number(formValue.dimensions.width),
              height: Number(formValue.dimensions.height),
            }
          : undefined,
      // Multi-tarifa (Phase 4). Empaque ahora vive en cada tarifa.
      // Fase 1: pure-ingredient short-circuits multi-tier (a pure ingredient
      // does not sell through retail price tiers).
      has_multiple_price_tiers: isPureIngredient
        ? false
        : !!formValue.has_multiple_price_tiers,
      enabled_price_tier_ids: isPureIngredient
        ? []
        : !!formValue.has_multiple_price_tiers
          ? this.hasLoadedPriceTiers()
            ? this.enabledPriceTierIdsFromRows()
            : (this.product?.enabled_price_tier_ids ?? [])
          : [],
      // Restaurant Suite toggles (Fase B)
      is_sellable: formValue.is_sellable !== false,
      is_ingredient: !!formValue.is_ingredient,
      // Un insumo no puede ser combo / menú fijo: se neutraliza por robustez.
      is_combo: formValue.is_ingredient ? false : !!formValue.is_combo,
      is_batch_produced: !!formValue.is_batch_produced,
      // UoM FKs (Fase UoM) — only sent when the product is an ingredient.
      // Sending `null` for non-ingredients keeps the column clean and the
      // product list filters untouched.
      stock_uom_id: formValue.is_ingredient
        ? formValue.stock_uom_id ?? null
        : null,
      purchase_uom_id: formValue.is_ingredient
        ? formValue.purchase_uom_id ?? null
        : null,
    };

    // Add Variants - ALWAYS send the array so the backend can handle the toggle
    // When hasVariants is false, send empty array to delete all existing variants
    if (this.hasVariants) {
      productData.variants = this.generatedVariants.map((v) => {
        const isNewImage = !!v.image_url && v.image_url.startsWith('data:');
        const hasImage = !!v.image_url;
        const variantImagePayload: {
          image_id: number | null | undefined;
          variant_image_url: string | null | undefined;
        } = isNewImage
          ? {
              image_id: v.image_id ?? null,
              variant_image_url: v.image_url,
            }
          : !hasImage
            ? {
                image_id: null,
                variant_image_url: null,
              }
            : {
                image_id: v.image_id,
                variant_image_url: undefined,
              };

        return {
          id: v.id,
          sku: v.sku,
          barcode: v.barcode?.trim() ? v.barcode.trim() : undefined,
          name: v.name,
          // Only send price_override when intentionally non-zero; 0 is ambiguous (backend rejects)
          price_override: Number(v.price) > 0 ? Number(v.price) : null,
          cost_price: Number(v.cost_price),
          profit_margin: Number(v.profit_margin),
          is_on_sale: !!v.is_on_sale,
          sale_price: Number(v.sale_price),
          stock_quantity: formValue.track_inventory
            ? Number(v.stock)
            : undefined,
          attributes: v.attributes,
          ...variantImagePayload,
          // null = heredar track_inventory del producto; true/false = override explícito
          track_inventory_override:
            v.track_inventory_override === undefined
              ? null
              : v.track_inventory_override,
        };
      });

      // Set base stock_quantity to the sum of variant stocks for immediate UI consistency
      // Backend syncProductStock() handles the real sync
      if (formValue.track_inventory) {
        productData.stock_quantity = this.totalVariantStock;
      }
    } else {
      // Send empty array to tell backend to delete all existing variants
      productData.variants = [];
    }

    if (this.isEditMode() && this.stockTransferMode) {
      productData.stock_transfer_mode = this.stockTransferMode;
    }

    // Reverse transfer: disabling variants on a product that previously had variants.
    // Backend auto-sums all variant stock into base stock; flag is required as an
    // explicit confirmation (any non-reset value works).
    if (this.isEditMode() && !this.hasVariants && this.originalHadVariants()) {
      productData.variant_removal_stock_mode = 'distribute';
    }

    const request$ =
      this.isEditMode() && this.productId
        ? this.productsService.updateProduct(this.productId, productData)
        : this.productsService.createProduct(productData);

    request$.subscribe({
      next: (savedProduct: Product) => {
        // Sync per-product tier overrides only when multi-tier is enabled and
        // the user actually loaded/edited rows. Errors here are non-fatal —
        // we surface them as a toast but the product save itself succeeded.
        const shouldSyncOverrides =
          !!formValue.has_multiple_price_tiers &&
          this.hasLoadedPriceTiers() &&
          !!savedProduct?.id;

        const finish = () => {
          this.toastService.success(
            this.isEditMode()
              ? 'Producto actualizado correctamente'
              : 'Producto creado correctamente',
          );
          const returnPage = this.route.snapshot.queryParams['fromPage'] || 1;
          this.router.navigate(['/admin/products'], {
            queryParams: { page: returnPage },
          });
        };

        if (!shouldSyncOverrides) {
          finish();
          return;
        }

        this.syncTierOverridesForProduct(savedProduct.id)
          .then(() => finish())
          .catch((err) => {
            console.error('Error syncing tier overrides:', err);
            const message = extractApiErrorMessage(err);
            this.toastService.error(
              message || 'No se pudieron guardar todos los precios por tarifa',
              'Tarifas no sincronizadas',
            );
            // Product saved OK — still navigate so the user is not blocked.
            finish();
          });
      },
      error: (err: any) => {
        console.error('Error saving product:', err);
        const message = extractApiErrorMessage(err);
        this.toastService.error(
          message,
          this.isEditMode()
            ? 'Error al actualizar el producto'
            : 'Error al crear el producto',
        );
        this.isSubmitting.set(false);
      },
    });
  }

  generateAIDescription(): void {
    if (this.aiDescriptionLimitReached()) {
      this.toastService.warning(
        'Límite de generaciones alcanzado (3 por producto)',
      );
      return;
    }

    const name = this.productForm.get('name')?.value;
    if (!name?.trim()) {
      this.toastService.warning('Ingresa el nombre del producto primero');
      return;
    }

    this.isGeneratingDescription.set(true);

    const brandId = this.productForm.get('brand_ids')?.value?.[0];
    const brand = brandId
      ? this.brandOptions.find((b) => b.value === brandId)?.label
      : undefined;

    const categoryIds: number[] =
      this.productForm.get('category_ids')?.value || [];
    const category =
      categoryIds.length > 0
        ? this.categoryOptions
            .filter((c) => categoryIds.includes(c.value as number))
            .map((c) => c.label)
            .join(', ')
        : undefined;

    const payload: Record<string, any> = {
      name: name.trim(),
      base_price: this.productForm.get('base_price')?.value || undefined,
      sku: this.productForm.get('sku')?.value || undefined,
      brand,
      category,
    };

    // Remove undefined values
    Object.keys(payload).forEach((key) => {
      if (payload[key] === undefined || payload[key] === '')
        delete payload[key];
    });

    this.productsService.generateDescription(payload).subscribe({
      next: (data: any) => {
        this.productForm.get('description')?.setValue(data.description);
        this.aiDescriptionUsesLeft.update((n) => n - 1);
        const left = this.aiDescriptionUsesLeft();
        this.toastService.success(
          left > 0
            ? `Descripción generada con IA (${left} uso${left !== 1 ? 's' : ''} restante${left !== 1 ? 's' : ''})`
            : 'Descripción generada con IA (último uso)',
        );
        this.isGeneratingDescription.set(false);
      },
      error: (err: any) => {
        console.error('AI generation error:', err);
        const message = extractApiErrorMessage(err);
        this.toastService.error(message, 'Error al generar descripción');
        this.isGeneratingDescription.set(false);
      },
    });
  }

  getErrorMessage(fieldName: string): string {
    const field = this.productForm.get(fieldName);
    if (!field || !field.errors || !field.touched) return '';
    if (field.errors['required']) return 'Campo obligatorio';
    if (field.errors['min']) return `Valor mínimo: ${field.errors['min'].min}`;
    return 'Valor inválido';
  }

  // Memoizado por referencia de product: el modal lo recibe como input signal
  // y un objeto nuevo por lectura dispara sus effects en cada CD
  private _adjustmentPreselected: PreselectedProduct | null = null;
  private _adjustmentPreselectedSource: Product | null = null;

  get adjustmentPreselectedProduct(): PreselectedProduct | null {
    if (!this.product) return null;
    if (this._adjustmentPreselectedSource !== this.product) {
      this._adjustmentPreselectedSource = this.product;
      this._adjustmentPreselected = {
        id: this.product.id,
        name: this.product.name,
        sku: this.product.sku ?? null,
      };
    }
    return this._adjustmentPreselected;
  }

  // Adjustment Modal
  openAdjustmentModal(): void {
    this.isAdjustmentModalOpen = true;
    if (this.adjustmentLocationOptions.length === 0) {
      this.inventoryService.getLocations().subscribe({
        next: (response) => {
          const locations = response.data || [];
          this.adjustmentLocationOptions = locations.map((l: any) => ({
            value: l.id,
            label: l.name,
          }));
        },
        error: () => {},
      });
    }
  }

  openStockAdjustment(): void {
    this.openAdjustmentModal();
  }

  goToPurchase(): void {
    if (this.productId) {
      this.router.navigate(['/admin/inventory/pop'], {
        queryParams: { product_id: this.productId },
      });
    }
  }

  /**
   * CTA para insumos producidos en lote (`is_batch_produced`): el stock de
   * estos insumos no se compra, se PRODUCE vía Operaciones › Producción.
   * Navega al módulo de órdenes de producción (ruta absoluta, misma
   * convención que `goToPurchase`).
   */
  goToProduction(): void {
    this.router.navigate(['/admin/restaurant-ops/production']);
  }

  closeAdjustmentModal(): void {
    this.isAdjustmentModalOpen = false;
  }

  onAdjustmentSave(dto: BatchCreateAdjustmentsRequest): void {
    this.isAdjusting = true;
    this.inventoryService.batchCreateAdjustments(dto).subscribe({
      next: () => {
        this.toastService.success(
          'Ajustes de inventario creados como borrador',
        );
        this.isAdjusting = false;
        this.closeAdjustmentModal();
        if (this.productId) {
          this.loadProduct(this.productId);
        }
      },
      error: (err) => {
        console.error('Error creating adjustments', err);
        this.toastService.error('Error al realizar los ajustes');
        this.isAdjusting = false;
      },
    });
  }

  onAdjustmentSaveAndComplete(dto: BatchCreateAdjustmentsRequest): void {
    this.isAdjusting = true;
    this.inventoryService.batchCreateAndComplete(dto).subscribe({
      next: () => {
        this.toastService.success('Ajustes creados y aplicados correctamente');
        this.isAdjusting = false;
        this.closeAdjustmentModal();
        if (this.productId) {
          this.loadProduct(this.productId);
        }
      },
      error: (err) => {
        console.error('Error creating adjustments', err);
        this.toastService.error('Error al realizar los ajustes');
        this.isAdjusting = false;
      },
    });
  }

  // Product states
  readonly productStateOptions = ['active', 'inactive', 'archived'] as const;
  readonly productStateButtonOptions = [
    { value: 'active', label: 'Active' },
    { value: 'inactive', label: 'Inactive' },
    { value: 'archived', label: 'Archived' },
  ];

  // Confirmación de cambio de estado (solo en edición)
  onStateChange(newState: string): void {
    if (!this.isEditMode()) return; // En creación no requiere confirmación

    const previousState = this.productForm.get('state')?.value;
    if (previousState === newState) return;

    this.dialogService
      .confirm({
        title: 'Change Product Status',
        message: `Are you sure you want to change the product status to "${this.formatStatus(newState)}"? This action cannot be undone and may affect product visibility.`,
        confirmText: 'Change Status',
        cancelText: 'Cancel',
        confirmVariant: 'danger',
      })
      .then((confirmed: boolean) => {
        if (!confirmed) {
          // Revert: el formControl ya cambió vía CVA, restaurar al valor previo
          this.productForm
            .get('state')
            ?.setValue(previousState, { emitEvent: false });
        }
      });
  }

  /** @deprecated Use onStateChange instead */
  updateProductState(newState: string): void {
    this.productForm.get('state')?.setValue(newState);
  }

  // Helper methods (copiados de order-details)
  getStatusColor(status: string): string {
    const statusColors: { [key: string]: string } = {
      active: 'bg-green-100 text-green-800',
      inactive: 'bg-yellow-100 text-yellow-800',
      archived: 'bg-red-100 text-red-800',
    };
    return statusColors[status] || 'bg-gray-100 text-gray-800';
  }

  formatStatus(status: string | undefined): string {
    if (!status) return 'Unknown';
    return status.charAt(0).toUpperCase() + status.slice(1);
  }

  // ─── Provider Assignment (requires_booking services) ───

  loadProviders(productId: number): void {
    this.loadingProviders.set(true);
    this.reservationsService.getProvidersForService(productId).subscribe({
      next: (providers) => {
        this.assignedProviders.set(providers);
        this.loadingProviders.set(false);
      },
      error: () => {
        this.loadingProviders.set(false);
      },
    });
  }

  loadAllProviders(): void {
    this.reservationsService.getProviders().subscribe({
      next: (providers) => this.allProviders.set(providers),
      error: () => {},
    });
  }

  availableProvidersForProduct(): ServiceProvider[] {
    const assignedIds = new Set(this.assignedProviders().map((p) => p.id));
    return this.allProviders().filter((p) => !assignedIds.has(p.id));
  }

  onProvidersSelectionChange(ids: (string | number)[]): void {
    if (!this.productId) return;
    const nextIds = new Set(ids.map(Number));
    const currentIds = new Set(this.assignedProviderIds());
    const toAdd = [...nextIds].filter((id) => !currentIds.has(id));
    const toRemove = [...currentIds].filter((id) => !nextIds.has(id));
    toAdd.forEach((id) => this.addProviderToService(id));
    toRemove.forEach((id) => this.removeProviderFromService(id));
  }

  addProviderToService(providerIdStr: string | number): void {
    const providerId = Number(providerIdStr);
    if (!providerId || !this.productId) return;
    this.reservationsService
      .assignServiceToProvider(providerId, this.productId)
      .subscribe({
        next: () => {
          this.toastService.success('Proveedor asignado al servicio');
          this.loadProviders(this.productId!);
        },
        error: () => {
          this.toastService.error('Error al asignar proveedor');
        },
      });
  }

  removeProviderFromService(providerId: number): void {
    if (!this.productId) return;
    this.reservationsService
      .removeServiceFromProvider(providerId, this.productId)
      .subscribe({
        next: () => {
          this.toastService.success('Proveedor removido del servicio');
          this.loadProviders(this.productId!);
        },
        error: () => {
          this.toastService.error('Error al remover proveedor');
        },
      });
  }

  getProviderInitials(provider: ServiceProvider): string {
    if (provider.display_name) {
      return provider.display_name
        .split(' ')
        .map((w) => w[0])
        .join('')
        .toUpperCase()
        .substring(0, 2);
    }
    if (provider.employee) {
      return (
        (provider.employee.first_name?.[0] || '') +
        (provider.employee.last_name?.[0] || '')
      ).toUpperCase();
    }
    return '??';
  }

  goToScheduleConfig(): void {
    this.router.navigate(['/admin/reservations/schedules']);
  }

  // ─── Multi-tarifa (Phase 4) ────────────────────────────────────────────

  /** Convenience getter used by template to read the toggle. */
  get isMultiTierEnabled(): boolean {
    return !!this.productForm.get('has_multiple_price_tiers')?.value;
  }

  /**
   * Handler for the "Activar precios multi-tarifa" toggle. Lazy-loads the
   * tier catalog the first time it's enabled.
   */
  onMultiTierToggle(enabled: boolean): void {
    this.productForm
      .get('has_multiple_price_tiers')
      ?.setValue(enabled, { emitEvent: false });

    if (!enabled) return;
    if (this.hasLoadedPriceTiers()) return;

    if (this.productId) {
      this.loadPriceTiersForProduct(
        this.productId,
        this.product?.enabled_price_tier_ids,
      );
    } else {
      // Create mode: load tiers anyway so the user sees the catalog and the
      // help message. Overrides cannot be persisted until the product is saved.
      this.loadPriceTiersForCreateMode();
    }
  }

  /**
   * Loads active tiers + existing overrides for an existing product. Combines
   * them into rows so the UI can render in a single render pass.
   */
  private loadPriceTiersForProduct(
    productId: number,
    enabledPriceTierIds?: number[],
  ): void {
    this.isLoadingPriceTiers.set(true);
    forkJoin({
      tiers: this.priceTiersService
        .list({ is_active: true, limit: 200 })
        .pipe(catchError(() => of([] as PriceTier[]))),
      overrides: this.priceTiersService
        .getProductOverrides(productId)
        .pipe(catchError(() => of([] as ProductPriceTierOverride[]))),
    }).subscribe({
      next: ({ tiers, overrides }) => {
        // MVP: only base-product overrides (variant_id null/undefined) are
        // surfaced. Per-variant overrides are deferred (see PriceTierOverrideRow doc).
        const baseOverrides = overrides.filter(
          (o) => o.variant_id === null || o.variant_id === undefined,
        );
        const overrideByTierId = new Map<number, ProductPriceTierOverride>();
        for (const o of baseOverrides) {
          overrideByTierId.set(o.price_tier_id, o);
        }

        const enabledSet =
          enabledPriceTierIds === undefined
            ? new Set(tiers.map((tier) => tier.id))
            : new Set(enabledPriceTierIds.map(Number));

        const rows: PriceTierOverrideRow[] = tiers
          .slice()
          .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
          .map((tier) => {
            const override = overrideByTierId.get(tier.id);
            const existingPrice =
              override && override.override_price !== null
                ? Number(override.override_price)
                : null;
            const existingUnits =
              override &&
              override.override_units_per_package !== null &&
              override.override_units_per_package !== undefined
                ? Number(override.override_units_per_package)
                : null;
            const enabled = enabledSet.has(tier.id);
            return {
              tier,
              enabled,
              initial_enabled: enabled,
              override_price: existingPrice,
              initial_override_price: existingPrice,
              override_units_per_package: existingUnits,
              initial_override_units_per_package: existingUnits,
            };
          });

        this.priceTierRows.set(rows);
        this.hasLoadedPriceTiers.set(true);
        this.isLoadingPriceTiers.set(false);
      },
      error: (err) => {
        console.error('Error loading price tiers:', err);
        const message = extractApiErrorMessage(err);
        this.toastService.error(message, 'Error al cargar tarifas');
        this.isLoadingPriceTiers.set(false);
      },
    });
  }

  /**
   * Create-mode load: only fetches the tier catalog. Overrides cannot be
   * persisted because there's no product ID yet — the UI shows a warning
   * banner instructing the user to save first.
   */
  private loadPriceTiersForCreateMode(): void {
    this.isLoadingPriceTiers.set(true);
    this.priceTiersService.list({ is_active: true, limit: 200 }).subscribe({
      next: (tiers) => {
        const rows: PriceTierOverrideRow[] = tiers
          .slice()
          .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
          .map((tier) => ({
            tier,
            enabled: true,
            initial_enabled: true,
            override_price: null,
            initial_override_price: null,
            override_units_per_package: null,
            initial_override_units_per_package: null,
          }));
        this.priceTierRows.set(rows);
        this.hasLoadedPriceTiers.set(true);
        this.isLoadingPriceTiers.set(false);
      },
      error: (err) => {
        console.error('Error loading price tiers:', err);
        const message = extractApiErrorMessage(err);
        this.toastService.error(message, 'Error al cargar tarifas');
        this.isLoadingPriceTiers.set(false);
      },
    });
  }

  // ─── Multi-selector wiring (mimics Promociones) ─────────────────────────

  /** All loaded tiers presented as multi-selector options (search + chips). */
  readonly priceTierSelectorOptions = computed<MultiSelectorOption[]>(() =>
    this.priceTierRows().map((row) => ({
      value: row.tier.id,
      label: row.tier.name,
      description: this.tierOptionDescription(row.tier),
      icon: row.tier.is_package_unit ? 'package' : undefined,
    })),
  );

  /** Ids of the currently enabled tiers — bound to the multi-selector value. */
  readonly selectedPriceTierIds = computed<number[]>(() =>
    this.priceTierRows()
      .filter((row) => row.enabled)
      .map((row) => row.tier.id),
  );

  /**
   * Only the enabled tiers render configurable rows below the multi-selector.
   * Reads `formUpdateTrigger` so the per-row price/margin/fallback recompute
   * live when the user edits `base_price`/`cost_price` in the pricing section
   * (those are plain reactive-form values, not signals).
   */
  readonly selectedPriceTierRows = computed<PriceTierOverrideRow[]>(() => {
    this.formUpdateTrigger(); // re-render on form value/status changes
    return this.priceTierRows().filter((row) => row.enabled);
  });

  private tierOptionDescription(tier: PriceTier): string | undefined {
    const parts: string[] = [];
    if (tier.is_default) parts.push('Por defecto');
    if (tier.discount_percentage) parts.push(`${tier.discount_percentage}%`);
    const pack = resolvePackSize(tier.units_per_package, null);
    if (pack > 1) parts.push(`Empaque x${pack}`);
    return parts.length ? parts.join(' · ') : undefined;
  }

  /**
   * Multi-selector valueChange handler. Enables exactly the selected tiers and
   * disables the rest. Deselecting a tier marks its override for removal on save
   * (override fields are reset so the diff in syncTierOverridesForProduct issues
   * the DELETE).
   */
  onPriceTiersChange(ids: (string | number)[]): void {
    const enabledSet = new Set(ids.map((id) => Number(id)));
    const next = this.priceTierRows().map((row) => {
      const enabled = enabledSet.has(row.tier.id);
      if (enabled === row.enabled) return { ...row, enabled };
      // Deselected → drop any pending override so the row inherits the default
      // (the DELETE is issued from the diff when it had a persisted override).
      return enabled
        ? { ...row, enabled }
        : {
            ...row,
            enabled,
            override_price: null,
            override_units_per_package: null,
          };
    });
    this.priceTierRows.set(next);
  }

  // ─── Pack size + price/margin helpers ───────────────────────────────────

  /**
   * Effective pack size for a row: override_units_per_package ?? tier default.
   * A pack size > 1 means the override price is the WHOLE-PACKAGE price.
   */
  getRowPackSize(row: PriceTierOverrideRow): number {
    return resolvePackSize(
      row.tier.units_per_package,
      row.override_units_per_package,
    );
  }

  /** Whole-package acquisition cost = product cost_price * packSize. */
  getRowPackageCost(row: PriceTierOverrideRow): number {
    const cost = Number(this.productForm.get('cost_price')?.value || 0);
    return cost * this.getRowPackSize(row);
  }

  /** True when cost_price <= 0 so margin cannot be derived (disable margin UI). */
  get costPriceIsZero(): boolean {
    return Number(this.productForm.get('cost_price')?.value || 0) <= 0;
  }

  /**
   * Computed whole-package price suggested when no override is set:
   * base_price * (1 - tier%) * packSize. Returns null if base_price is 0.
   */
  getTierFallbackPrice(row: PriceTierOverrideRow): number | null {
    const basePrice = Number(this.productForm.get('base_price')?.value || 0);
    if (basePrice <= 0) return null;
    const discount = Number(row.tier.discount_percentage || 0);
    const unitPrice = discount ? basePrice * (1 - discount / 100) : basePrice;
    return Number((unitPrice * this.getRowPackSize(row)).toFixed(2));
  }

  /** Effective whole-package price used for margin display: override or fallback. */
  getRowEffectivePrice(row: PriceTierOverrideRow): number | null {
    if (row.override_price !== null && row.override_price !== undefined) {
      return row.override_price;
    }
    return this.getTierFallbackPrice(row);
  }

  /**
   * Margin % of a row against the whole-package cost. Returns null when the
   * cost is non-positive or there is no resolvable price.
   */
  getRowMargin(row: PriceTierOverrideRow): number | null {
    const packageCost = this.getRowPackageCost(row);
    if (packageCost <= 0) return null;
    const price = this.getRowEffectivePrice(row);
    if (price === null) return null;
    return Number((((price - packageCost) / packageCost) * 100).toFixed(2));
  }

  /** Update one row's override price (called from the price input). */
  updateTierOverridePrice(tierId: number, value: number | null): void {
    const next = this.priceTierRows().map((row) => {
      if (row.tier.id !== tierId) return row;
      return { ...row, override_price: this.normalizePrice(value) };
    });
    this.priceTierRows.set(next);
  }

  /**
   * BIDIRECTIONAL: editing the margin recomputes the WHOLE-PACKAGE override
   * price. price = packageCost * (1 + margin/100), where
   * packageCost = cost_price * packSize. No-op when cost is non-positive.
   */
  updateTierOverrideMargin(tierId: number, marginValue: number | null): void {
    const next = this.priceTierRows().map((row) => {
      if (row.tier.id !== tierId) return row;
      const packageCost = this.getRowPackageCost(row);
      if (packageCost <= 0) return row; // cost guard — cannot derive price
      if (marginValue === null || marginValue === undefined) {
        // Clearing margin clears the override → fall back to tier default.
        return { ...row, override_price: null };
      }
      const margin = Number(marginValue);
      if (!Number.isFinite(margin)) return row;
      const price = Number((packageCost * (1 + margin / 100)).toFixed(2));
      return { ...row, override_price: this.normalizePrice(price) };
    });
    this.priceTierRows.set(next);
  }

  /**
   * Override the units-per-package for THIS product on a given tier.
   * Empty/invalid (< 2) => inherit the tier default. Re-resolves pack size so a
   * downstream price/margin read reflects the new packaging immediately.
   */
  updateTierOverrideUnits(tierId: number, value: number | null): void {
    const next = this.priceTierRows().map((row) => {
      if (row.tier.id !== tierId) return row;
      let parsed: number | null = null;
      if (value !== null && value !== undefined) {
        const n = Number(value);
        parsed = Number.isFinite(n) && n >= 2 ? Math.floor(n) : null;
      }
      return { ...row, override_units_per_package: parsed };
    });
    this.priceTierRows.set(next);
  }

  private normalizePrice(value: number | null): number | null {
    if (value === null || value === undefined) return null;
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? n : null;
  }

  toggleTierAssignment(tierId: number, enabled: boolean): void {
    const next = this.priceTierRows().map((row) => {
      if (row.tier.id !== tierId) return row;
      // Disabling drops any pending override so the row inherits the default
      // (and the diff in syncTierOverridesForProduct issues the DELETE).
      return enabled
        ? { ...row, enabled }
        : {
            ...row,
            enabled,
            override_price: null,
            override_units_per_package: null,
          };
    });
    this.priceTierRows.set(next);
  }

  /** Clear an override row's price (user clicked "Limpiar"). */
  clearTierOverride(tierId: number): void {
    this.updateTierOverridePrice(tierId, null);
  }

  private enabledPriceTierIdsFromRows(): number[] {
    if (!this.hasLoadedPriceTiers()) return [];
    return this.priceTierRows()
      .filter((row) => row.enabled)
      .map((row) => row.tier.id);
  }

  /**
   * Compute the diff between current rows and their initial snapshot and
   * issue the corresponding PUT/DELETE calls. Resolves when all calls finish.
   * A row is persisted when its price OR units-per-package override changed,
   * and removed when both are cleared.
   */
  private syncTierOverridesForProduct(productId: number): Promise<void> {
    const rows = this.priceTierRows();
    if (rows.length === 0) return Promise.resolve();

    const operations: Promise<unknown>[] = [];

    for (const row of rows) {
      const priceChanged = row.initial_override_price !== row.override_price;
      const unitsChanged =
        row.initial_override_units_per_package !==
        row.override_units_per_package;
      if (!priceChanged && !unitsChanged) continue;

      const hasPrice =
        row.override_price !== null && row.override_price !== undefined;
      const hasUnits =
        row.override_units_per_package !== null &&
        row.override_units_per_package !== undefined;

      if (!hasPrice && !hasUnits) {
        // Nothing left to persist → delete the override (variant_id omitted).
        operations.push(
          this.priceTiersService
            .removeProductOverride(productId, row.tier.id)
            .toPromise()
            .catch((err) => {
              console.error(
                `Error removing override for tier ${row.tier.id}:`,
                err,
              );
              throw err;
            }),
        );
      } else {
        operations.push(
          this.priceTiersService
            .upsertProductOverride(productId, row.tier.id, {
              override_price: hasPrice ? Number(row.override_price) : undefined,
              override_units_per_package: hasUnits
                ? Number(row.override_units_per_package)
                : undefined,
            })
            .toPromise()
            .catch((err) => {
              console.error(
                `Error upserting override for tier ${row.tier.id}:`,
                err,
              );
              throw err;
            }),
        );
      }
    }

    if (operations.length === 0) return Promise.resolve();

    this.isSyncingOverrides.set(true);
    return Promise.all(operations)
      .then(() => {
        this.priceTierCache.invalidateProductOverrides(productId);
        // Update snapshots so subsequent edits diff correctly.
        const refreshed = this.priceTierRows().map((row) => ({
          ...row,
          initial_override_price: row.override_price,
          initial_override_units_per_package: row.override_units_per_package,
        }));
        this.priceTierRows.set(refreshed);
      })
      .finally(() => {
        this.isSyncingOverrides.set(false);
      });
  }

  // ─── Variant track_inventory_override helpers ──────────────────────────────
  readonly variantTrackInventoryOptions: SelectorOption[] = [
    { value: 'inherit', label: 'Heredar del producto' },
    { value: 'track', label: 'Manejar stock' },
    { value: 'availability_only', label: 'Solo disponibilidad (sin stock)' },
  ];

  /** Convert the tri-state override boolean | null into a selector string value. */
  getVariantTrackInventoryValue(variant: GeneratedVariant): string {
    if (variant.track_inventory_override === true) return 'track';
    if (variant.track_inventory_override === false) return 'availability_only';
    return 'inherit';
  }

  /** Handle selector change → map back to boolean | null and enforce parent rules. */
  updateVariantTrackInventoryOverride(
    variant: GeneratedVariant,
    value: string,
  ): void {
    const parentTrackInventory =
      this.productForm.get('track_inventory')?.value === true;

    let next: boolean | null | undefined;
    if (value === 'track') next = true;
    else if (value === 'availability_only') next = false;
    else next = undefined;

    // Guardrail: if parent does NOT track inventory, a variant cannot force 'track'.
    if (!parentTrackInventory && next === true) {
      this.toastService.error(
        'El producto no rastrea inventario. La variante no puede activar control de stock.',
        'Configuración incompatible',
      );
      return;
    }

    variant.track_inventory_override = next;
    // Trigger CD for the template — array mutation is not signal-backed here
    this.generatedVariants = [...this.generatedVariants];
  }

  // ─── QUI-431: Números de serie — resumen + gestor en modal LG ───────────
  //
  // La página solo muestra un RESUMEN compacto (contadores del pool) y un botón
  // que abre el modal completo de gestión (app-product-serials-manager-modal).
  // Solo aplica a productos serializados (requires_serial_numbers = true) y el
  // resumen solo se carga en modo edición (necesita productId + stock).

  /** Visibilidad del modal completo de gestión de seriales (zoneless model). */
  readonly serialsManagerOpen = signal(false);

  /** Contadores del pool de seriales del producto (resumen compacto). */
  readonly serialSummary = signal<SerialSummary>({
    total: 0,
    by_status: {},
    warranty_expired: 0,
    warranty_expiring_soon: 0,
  });

  /** True cuando el toggle requires_serial_numbers está activo. */
  get isSerialized(): boolean {
    return !!this.productForm.get('requires_serial_numbers')?.value;
  }

  /**
   * Conteo de seriales por estado del resumen, con fallback a 0 cuando el
   * backend omite un estado sin filas. (Encapsula el acceso al Record para
   * evitar el `?? 0` redundante en plantilla que el compilador AOT marca.)
   */
  serialCountByStatus(status: string): number {
    return this.serialSummary().by_status[status] ?? 0;
  }

  /**
   * Carga el resumen de seriales del producto. Solo aplica a productos
   * serializados en modo edición (requiere productId). No-op en creación o si
   * el producto no es serializado; el modal (changed) la vuelve a invocar tras
   * cualquier alta/edición/eliminación/carga masiva exitosa.
   */
  loadSerialSummary(): void {
    if (!this.isSerialized || this.productId == null) return;
    this.serialNumbersService
      .summary({ product_id: this.productId })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (summary) => this.serialSummary.set(summary),
        error: () => {
          // Silencioso: el resumen es informativo; el gestor maneja sus errores.
          this.serialSummary.set({
            total: 0,
            by_status: {},
            warranty_expired: 0,
            warranty_expiring_soon: 0,
          });
        },
      });
  }
}
