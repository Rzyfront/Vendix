import {
  Injectable,
  BadRequestException,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { CreatePurchaseOrderDto } from './dto/create-purchase-order.dto';
import { UpdatePurchaseOrderDto } from './dto/update-purchase-order.dto';
import { PurchaseOrderQueryDto } from './dto/purchase-order-query.dto';
import { ReceivePurchaseOrderDto } from './dto/receive-purchase-order.dto';
import { RegisterPaymentDto } from './dto/register-payment.dto';
import { AddAttachmentDto } from './dto/add-attachment.dto';
import {
  purchase_order_status_enum,
  tax_type_enum,
  invoice_type_enum,
} from '@prisma/client';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { FiscalScopeService } from '@common/services/fiscal-scope.service';
import { RequestContextService } from '@common/context/request-context.service';
import { toTitleCase } from '@common/utils/format.util';
import { generateSlug } from '@common/utils/slug.util';
import { StockLevelManager } from '../../inventory/shared/services/stock-level-manager.service';
import {
  CostingService,
  CostCalculationResult,
} from '../../inventory/shared/services/costing.service';
import { CostingMethodResolverService } from '../../inventory/shared/services/costing-method-resolver.service';
import { toPublicCostingMethod } from '../../inventory/shared/helpers/costing-method.mapper';
import { InventorySerialNumbersService } from '../../inventory/serial-numbers/inventory-serial-numbers.service';
import { SerialNumberEnforcementService } from '../../inventory/serial-numbers/serial-number-enforcement.service';
import { AuditService } from '@common/audit/audit.service';
import { S3Service } from '@common/services/s3.service';
import { SettingsService } from '../../settings/settings.service';
import { CostPreviewDto } from './dto/cost-preview.dto';
import { storeIndustriesSupportIngredients } from '@common/helpers/industry-capabilities.helper';

/**
 * F1 IVA lifecycle — RUT casilla 53 code for "Responsable de IVA" (O-48).
 * Mirrors FiscalObligationService.VAT_RESPONSIBLE_CODE so the cost treatment
 * (exclude vs capitalize IVA) uses the same canonical fiscal source.
 */
const VAT_RESPONSIBLE_CODE = 'O-48';

@Injectable()
export class PurchaseOrdersService {
  private readonly logger = new Logger(PurchaseOrdersService.name);

  constructor(
    private prisma: StorePrismaService,
    private stockLevelManager: StockLevelManager,
    private costingService: CostingService,
    private costingMethodResolver: CostingMethodResolverService,
    private serialNumbersService: InventorySerialNumbersService,
    private serialEnforcement: SerialNumberEnforcementService,
    private auditService: AuditService,
    private s3Service: S3Service,
    private settingsService: SettingsService,
    private fiscalScopeService: FiscalScopeService,
    private eventEmitter: EventEmitter2,
  ) {}

  /**
   * F1 IVA lifecycle — single source of truth for the net/gross split of a
   * purchase line. The frontend mirrors this exact formula for its live
   * preview, so it MUST stay byte-for-byte equivalent to the clavado contract:
   *
   *   effective_include = item.prices_include_tax ?? header.prices_include_tax
   *   r = tax_rate / 100
   *   include  → unit_price_net = gross / (1 + r); tax/u = gross - net
   *   exclude  → unit_price_net = gross;           tax/u = gross * r
   *
   * `gross` is read from `unit_price` (create) or `unit_cost` (cost preview),
   * whichever the caller provides. When there is no tax rate the line is
   * tax-free: net = gross, tax = 0 (preserves legacy behaviour exactly).
   *
   * @returns unit_price_net (per unit, → persisted `unit_cost`),
   *          tax_amount_per_unit (per unit),
   *          tax_amount (line total = per-unit × quantity, → persisted),
   *          effective_include (the resolved mode for the line).
   */
  private deriveLineTax(
    item: {
      unit_price?: number | null;
      unit_cost?: number | null;
      quantity?: number | null;
      tax_rate?: number | null;
      prices_include_tax?: boolean | null;
    },
    header: { prices_include_tax?: boolean | null },
  ): {
    unit_price_net: number;
    tax_amount_per_unit: number;
    tax_amount: number;
    effective_include: boolean;
  } {
    const gross = Number(item.unit_price ?? item.unit_cost ?? 0);
    const quantity = Number(item.quantity ?? 0);
    const r = Number(item.tax_rate ?? 0) / 100;
    const effective_include =
      item.prices_include_tax ?? header.prices_include_tax ?? false;

    let unit_price_net: number;
    let tax_amount_per_unit: number;
    if (!(r > 0)) {
      // No (or invalid) tax rate → line is tax-free, cost stays as entered.
      unit_price_net = gross;
      tax_amount_per_unit = 0;
    } else if (effective_include) {
      // Price already includes IVA: strip it out to get the net cost.
      unit_price_net = gross / (1 + r);
      tax_amount_per_unit = gross - unit_price_net;
    } else {
      // IVA added on top: entered price is already net.
      unit_price_net = gross;
      tax_amount_per_unit = gross * r;
    }

    return {
      unit_price_net,
      tax_amount_per_unit,
      tax_amount: tax_amount_per_unit * quantity,
      effective_include,
    };
  }

  /**
   * F1 IVA lifecycle — read-only check of the commerce's VAT responsibility,
   * driving the inventory cost treatment at receipt:
   *   - O-48 (responsible)     → IVA is descontable, EXCLUDED from cost.
   *   - O-49 (non-responsible) → IVA is CAPITALIZED into inventory cost.
   *
   * Canonical source: `SettingsService.getFiscalData().tax_responsibilities`
   * (RUT casilla 53). Mirrors FiscalObligationService's O-48 evaluation.
   *
   * Anti-regression rule: NO declared responsibilities / indeterminate ⇒ treat
   * as RESPONSIBLE (O-48). This preserves the pre-F1 behaviour where entered
   * cost was net and IVA was never capitalized.
   *
   * `organizationId`/`storeId` are the resolved tenant identifiers (used for
   * logging); the fiscal data itself is read from the request context inside
   * `getFiscalData()`.
   */
  private async isVatResponsible(
    organizationId?: number,
    storeId?: number,
  ): Promise<boolean> {
    try {
      const fiscalData = await this.settingsService.getFiscalData();
      const responsibilities = Array.isArray(
        (fiscalData as any)?.tax_responsibilities,
      )
        ? ((fiscalData as any).tax_responsibilities as unknown[]).filter(
            (code): code is string => typeof code === 'string',
          )
        : [];

      // No declared responsibilities / indeterminate ⇒ RESPONSIBLE (O-48).
      if (responsibilities.length === 0) return true;
      return responsibilities.includes(VAT_RESPONSIBLE_CODE);
    } catch (error: any) {
      this.logger.warn(
        `isVatResponsible: could not resolve fiscal data for org ${organizationId} / store ${storeId} (${error?.message}); defaulting to VAT responsible (O-48).`,
      );
      return true;
    }
  }

  /**
   * Resolves the UoM conversion for a product at receipt time.
   *
   * The frontend sends `quantity_received` and `unit_cost` in the PURCHASE
   * unit (the unit the operator sees on the PO line, e.g. "10 bottles").
   * The stock_levels / inventory_cost_layers / inventory_movements tables
   * all store quantities in the MINIMUM stock unit (e.g. ml, g, unit).
   *
   * This helper is the ONLY place in the PO receive flow that converts
   * purchase → stock. It guarantees `calculateCostOnReceipt` and
   * `updateStock` see the same `stockQuantity` and `stockUnitCost`, so
   * stock-on-hand and FIFO cost layers stay in lockstep (the most
   * dangerous class of bugs in the receive flow is "stock and FIFO drift
   * by exactly the conversion factor").
   *
   * Returns:
   *   stockQuantity    — quantity in minimum stock unit (integer, Int)
   *   stockUnitCost    — unit cost in minimum stock unit (decimal)
   *   purchaseFactor   — the factor applied (1 for retail/legacy)
   *
   * Retail products (is_ingredient=false or no factor configured) return
   * the inputs unchanged — preserves the existing behaviour exactly.
   */
  private async resolveUoMConversion(
    productId: number,
    purchaseQuantity: number,
    purchaseUnitCost: number,
    tx: any,
  ): Promise<{
    stockQuantity: number;
    stockUnitCost: number;
    purchaseFactor: number;
  }> {
    // Read the product's UoM configuration. We use `findFirst` with the
    // store guard through StorePrismaService so a multi-tenant call does
    // not leak across stores.
    const product = await tx.products.findFirst({
      where: { id: productId },
      select: {
        id: true,
        is_ingredient: true,
        purchase_to_stock_factor: true,
        stock_uom_id: true,
        purchase_uom_id: true,
      },
    });

    const factor = Number(product?.purchase_to_stock_factor ?? 1);
    const isIngredient = !!product?.is_ingredient;
    const hasUoM = isIngredient && factor > 0 && Number.isFinite(factor);

    if (!hasUoM) {
      return {
        stockQuantity: purchaseQuantity,
        stockUnitCost: purchaseUnitCost,
        purchaseFactor: 1,
      };
    }

    // 10 L × 1000 ml/L = 10000 ml in stock.
    // unit_cost was 5000 COP per L → 5 COP per ml.
    const stockQuantity = Math.round(purchaseQuantity * factor);
    const stockUnitCost = Number(
      (purchaseUnitCost / factor).toFixed(6),
    );

    return {
      stockQuantity,
      stockUnitCost,
      purchaseFactor: factor,
    };
  }

  async create(createPurchaseOrderDto: CreatePurchaseOrderDto) {
    const result = await this.prisma.$transaction(async (tx) => {
      // 1. Process items to handle new product creation
      const processedItems: any[] = [];
      const organization_id = RequestContextService.getOrganizationId();

      if (!organization_id) {
        throw new BadRequestException('Organization ID not found in context');
      }

      // Fase 2: read order_type up-front so the new-product creation block
      // (below) can inherit ingredient flags. Defaults to `retail` for
      // backward compat; new orders from the POP modal always carry a value.
      const orderType =
        (createPurchaseOrderDto as any).order_type ?? 'retail';

      const normalizeText = (value: unknown) =>
        String(value ?? '')
          .normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '')
          .trim()
          .toLowerCase();

      const normalizeBool = (val: any, fallback = false) => {
        if (val === undefined || val === null || val === '') return fallback;
        if (typeof val === 'boolean') return val;
        if (typeof val === 'number') return val !== 0;
        const s = normalizeText(val);
        if (
          ['si', 'yes', 'verdadero', 'true', '1', 'activo', 'x'].includes(s)
        ) {
          return true;
        }
        if (['no', 'false', 'falso', '0', 'inactivo'].includes(s)) {
          return false;
        }
        return fallback;
      };

      const normalizeProductType = (value: unknown) =>
        ['servicio', 'service'].includes(normalizeText(value))
          ? 'service'
          : 'physical';

      const normalizePricingType = (value: unknown) =>
        ['peso', 'weight', 'por peso'].includes(normalizeText(value))
          ? 'weight'
          : 'unit';

      const normalizeTaxCategoryIds = (value: unknown): number[] | undefined => {
        if (value === undefined || value === null || value === '') {
          return undefined;
        }
        const rawValues = Array.isArray(value)
          ? value
          : String(value)
              .split(/[;,]/)
              .map((item) => item.trim());
        const ids = rawValues
          .map((item) => Number(item))
          .filter((item) => Number.isInteger(item) && item > 0);
        return ids.length > 0 ? Array.from(new Set(ids)) : undefined;
      };

      for (const item of createPurchaseOrderDto.items) {
        let finalProductId = item.product_id;

        // If product_id is 0 or missing, and we have name/sku, create the product
        if ((!finalProductId || finalProductId === 0) && item.product_name) {
          // Check if product with SKU exists to avoid duplicates?
          // Start simple: Create new product
          // Resolve store_id for the new product
          let storeId: number | undefined;

          // Try to get store from location if possible, or fallback to first store of org
          const location = await tx.inventory_locations.findUnique({
            where: { id: createPurchaseOrderDto.location_id },
            select: { store_id: true },
          });

          if (location?.store_id) {
            storeId = location.store_id;
          } else {
            const firstStore = await tx.stores.findFirst({
              where: { organization_id },
            });
            storeId = firstStore?.id;
          }

          if (!storeId) {
            throw new BadRequestException(
              'Cannot create new product: No store found for this organization.',
            );
          }

          // Fase 2: ingredient inheritance for NEW products. The line is an
          // ingredient if the parent order is `ingredient` OR the item opts in
          // explicitly. We then gate that against the store's industries: a
          // store whose `industries` do not support the ingredient capacity
          // (helper: storeIndustriesSupportIngredients) NEVER persists an
          // ingredient product — the flag is silently forced off.
          const itemIsIngredient =
            orderType === 'ingredient' || item.is_ingredient === true;
          let effectiveIsIngredient = false;
          if (itemIsIngredient) {
            const storeForCaps = await tx.stores.findUnique({
              where: { id: storeId },
              select: { industries: true },
            });
            effectiveIsIngredient = storeIndustriesSupportIngredients(
              storeForCaps?.industries,
            );
          }

          // Fase 2: derive purchase_to_stock_factor from the global
          // units_of_measure catalog when BOTH UoM FKs are present. This
          // mirrors ProductsService.derivePurchaseToStockFactor (private in
          // that service) inline so the whole creation stays inside this
          // transaction. The factor is a CRITICAL costing value (purchase →
          // stock at receipt), so the catalog is the source of truth.
          let purchaseToStockFactor: number | undefined;
          if (
            effectiveIsIngredient &&
            item.purchase_uom_id != null &&
            item.stock_uom_id != null
          ) {
            const uoms = await tx.units_of_measure.findMany({
              where: { id: { in: [item.stock_uom_id, item.purchase_uom_id] } },
            });
            const stockUom = uoms.find((u) => u.id === item.stock_uom_id);
            const purchaseUom = uoms.find(
              (u) => u.id === item.purchase_uom_id,
            );
            if (!stockUom || !purchaseUom) {
              throw new BadRequestException(
                'Unidad de medida no encontrada en el catálogo para el insumo.',
              );
            }

            // "Contenido por envase" (cross-dimension): when the purchase unit
            // is a discrete package (`count`, e.g. una bolsita) and the stock
            // unit is a continuous magnitude (`mass`/`volume`, e.g. g/ml), the
            // factor CANNOT be derived from factor_to_base. The operator sends
            // it manually as `purchase_to_stock_factor` (= cuánto contenido
            // trae cada envase, p.ej. 250 g). We trust that value and SKIP the
            // same-dimension validation. The DTO guarantees Int >= 1.
            const manualFactor = item.purchase_to_stock_factor;
            const isCrossDimensionPackaging =
              purchaseUom.dimension === 'count' &&
              (stockUom.dimension === 'mass' ||
                stockUom.dimension === 'volume');

            if (
              manualFactor != null &&
              Number.isInteger(manualFactor) &&
              manualFactor >= 1 &&
              isCrossDimensionPackaging
            ) {
              purchaseToStockFactor = manualFactor;
            } else {
              // Same-dimension (or no manual factor): derive from the catalog
              // and enforce shared dimension so factor_to_base is meaningful.
              // (Validación defensiva intacta para todo caso no cross-dimension.)
              if (stockUom.dimension !== purchaseUom.dimension) {
                throw new BadRequestException(
                  `Las unidades de stock (${stockUom.code}) y compra (${purchaseUom.code}) deben pertenecer a la misma dimensión para poder convertirse.`,
                );
              }
              const derived = Math.round(
                Number(purchaseUom.factor_to_base) /
                  Number(stockUom.factor_to_base),
              );
              if (!Number.isFinite(derived) || derived < 1) {
                throw new BadRequestException(
                  `Factor de conversión inválido entre ${purchaseUom.code} y ${stockUom.code}: debe ser >= 1.`,
                );
              }
              purchaseToStockFactor = derived;
            }
          }

          // Check if product with SKU exists to avoid duplicates
          const existingProduct = await tx.products.findFirst({
            where: {
              sku: item.sku,
              store_id: storeId,
              state: { not: 'archived' },
            },
          });

          const availableForEcommerce = normalizeBool(
            item.available_for_ecommerce ?? true,
            true,
          );
          const isOnSale = normalizeBool((item as any).is_on_sale, false);
          const productType = normalizeProductType((item as any).product_type);
          const trackInventory =
            productType === 'service'
              ? false
              : normalizeBool((item as any).track_inventory, true);
          const pricingType = normalizePricingType((item as any).pricing_type);
          const isFeatured = normalizeBool((item as any).is_featured, false);
          const allowPosPriceOverride = normalizeBool(
            (item as any).allow_pos_price_override,
            false,
          );
          const hasMultiplePriceTiers = normalizeBool(
            (item as any).has_multiple_price_tiers,
            false,
          );
          const requestedTaxCategoryIds = normalizeTaxCategoryIds(
            (item as any).tax_category_ids,
          );

          // Normalize State
          let productState: any = 'active';
          if (item.state && typeof item.state === 'string') {
            const s = normalizeText(item.state);
            if (s === 'activo' || s === 'active' || s === 'habilitado')
              productState = 'active';
            else if (
              s === 'inactivo' ||
              s === 'inactive' ||
              s === 'deshabilitado'
            )
              productState = 'inactive';
            else if (s === 'archivado' || s === 'archived')
              productState = 'archived';
          }

          // Price calculation
          let basePrice = item.base_price || 0;
          const cost = item.unit_price || 0;
          let margin = item.profit_margin || 0;
          if (margin > 0 && margin < 1) margin = margin * 100;

          if (
            margin > 0 &&
            cost > 0 &&
            (!item.base_price || item.base_price === 0)
          ) {
            basePrice = cost * (1 + margin / 100);
          }

          // Resolve Brand: derive a deterministic slug (mirrors the categories
          // block below) and search/create scoped by store_id. `brands` requires
          // a non-null `slug` and enforces @@unique([store_id, slug]) +
          // @@unique([store_id, name]); searching and creating by slug+store_id
          // keeps a PO-created brand indistinguishable from a UI-created one.
          let brandId: number | undefined;
          if (item.brand_name?.trim()) {
            const brandName = item.brand_name.trim();
            const brandSlug = generateSlug(brandName);
            if (brandSlug) {
              const brand = await tx.brands.findFirst({
                where: { slug: brandSlug, store_id: storeId },
              });
              if (brand) {
                brandId = brand.id;
              } else {
                const newBrand = await tx.brands.create({
                  data: {
                    name: toTitleCase(brandName),
                    slug: brandSlug,
                    store_id: storeId,
                    description: 'Creada automáticamente por carga masiva PO',
                    state: 'active',
                  },
                });
                brandId = newBrand.id;
              }
            }
          }

          // Resolve Categories: split by ",", trim + lowercase for search, Title Case for creation
	          const categoryIds: number[] = [];
	          const categoryNames =
	            typeof item.category_names === 'string'
	              ? item.category_names
	              : '';
	          const hasCategoryNames = categoryNames.trim().length > 0;
	          if (hasCategoryNames) {
	            const names = categoryNames
              .split(',')
              .map((n) => n.trim())
              .filter((n) => n);
            for (const name of names) {
              const normalizedCatName = name.toLowerCase();
              const slug = normalizedCatName
                .replace(/[^a-z0-9]+/g, '-')
                .replace(/(^-|-$)+/g, '');

              // Search by slug (already lowercase/normalized)
              const cat = await tx.categories.findFirst({
                where: { slug: slug, store_id: storeId },
              });
              if (cat) {
                categoryIds.push(cat.id);
              } else {
                const titleCaseCatName = toTitleCase(name);
                const newCat = await tx.categories.create({
                  data: {
                    name: titleCaseCatName,
                    slug: slug,
                    store_id: storeId,
                    state: 'active',
                  },
                });
                categoryIds.push(newCat.id);
              }
            }
          }

          let taxCategoryIds: number[] | undefined;
          if (requestedTaxCategoryIds?.length) {
            const taxCategories = await tx.tax_categories.findMany({
              where: {
                id: { in: requestedTaxCategoryIds },
                OR: [{ store_id: storeId }, { store_id: null }],
              },
              select: { id: true },
            });
            if (taxCategories.length !== requestedTaxCategoryIds.length) {
              throw new BadRequestException(
                'Una o más categorías de impuesto no existen para esta tienda.',
              );
            }
            taxCategoryIds = taxCategories.map((taxCategory) => taxCategory.id);
          }

          if (existingProduct) {
            finalProductId = existingProduct.id;
            // Update existing product with new metadata if provided
            const productUpdateData: any = {
              state: productState,
              weight: item.weight || existingProduct.weight,
              brand_id:
                brandId !== undefined ? brandId : existingProduct.brand_id,
              base_price:
                basePrice > 0 ? basePrice : existingProduct.base_price,
              profit_margin:
                margin > 0 ? margin : existingProduct.profit_margin,
              cost_price: cost > 0 ? cost : existingProduct.cost_price,
              description:
                item.product_description || existingProduct.description,
            };

            if ((item as any).available_for_ecommerce !== undefined) {
              productUpdateData.available_for_ecommerce =
                availableForEcommerce;
            }
            if ((item as any).is_on_sale !== undefined) {
              productUpdateData.is_on_sale = isOnSale;
            }
            if (item.sale_price !== undefined) {
              productUpdateData.sale_price = item.sale_price;
            }

            if ((item as any).product_type !== undefined) {
              productUpdateData.product_type = productType;
            }
            if (
              (item as any).track_inventory !== undefined ||
              (item as any).product_type !== undefined
            ) {
              productUpdateData.track_inventory = trackInventory;
            }
            if ((item as any).pricing_type !== undefined) {
              productUpdateData.pricing_type = pricingType;
            }
            if ((item as any).is_featured !== undefined) {
              productUpdateData.is_featured = isFeatured;
            }
            if ((item as any).allow_pos_price_override !== undefined) {
              productUpdateData.allow_pos_price_override =
                allowPosPriceOverride;
            }
            if ((item as any).has_multiple_price_tiers !== undefined) {
              productUpdateData.has_multiple_price_tiers =
                hasMultiplePriceTiers;
            }

            if (hasCategoryNames) {
              productUpdateData.product_categories = {
                deleteMany: {},
                create: categoryIds.map((id) => ({ category_id: id })),
              };
            }

            if (taxCategoryIds !== undefined) {
              productUpdateData.product_tax_assignments = {
                deleteMany: {},
                create: taxCategoryIds.map((id) => ({ tax_category_id: id })),
              };
            }

            // Insumo (configure de producto existente): persistir la config UoM
            // + factor en el producto YA en el create. `purchase_order_items` no
            // almacena `purchase_to_stock_factor`, y el caso cross-dimension
            // (count→mass/volume) NO es re-derivable del catálogo en receive, por
            // lo que el producto es el único portador del factor hasta la
            // recepción. resolveUoMConversion exige `is_ingredient=true` + factor
            // para multiplicar, así que ambos deben quedar en el producto aquí.
            // (syncIngredientConfigOnReceipt sigue como backfill de labels /
            // same-dimension al recibir.) No se neutraliza pricing/ecommerce del
            // producto existente para no clobberear su config de venta.
            if (effectiveIsIngredient) {
              productUpdateData.is_ingredient = true;
              if (item.purchase_uom_id != null) {
                productUpdateData.purchase_uom_id = item.purchase_uom_id;
              }
              if (item.stock_uom_id != null) {
                productUpdateData.stock_uom_id = item.stock_uom_id;
              }
              if (purchaseToStockFactor != null) {
                productUpdateData.purchase_to_stock_factor =
                  purchaseToStockFactor;
              }
            }

            await tx.products.update({
              where: { id: existingProduct.id },
              data: productUpdateData,
            });
          } else {
            // Fase 2: a pure ingredient neutralizes every retail-sale
            // construct (mirrors ProductsService.sanitizeIngredientPayload)
            // and carries the UoM FKs + derived factor. Retail lines
            // (effectiveIsIngredient === false) keep the exact legacy values.
            const ingredientOverrides = effectiveIsIngredient
              ? {
                  is_ingredient: true,
                  is_sellable: false,
                  purchase_uom_id: item.purchase_uom_id ?? null,
                  stock_uom_id: item.stock_uom_id ?? null,
                  purchase_to_stock_factor: purchaseToStockFactor ?? null,
                  base_price: 0,
                  sale_price: 0,
                  is_on_sale: false,
                  available_for_ecommerce: false,
                  is_featured: false,
                  allow_pos_price_override: false,
                  has_multiple_price_tiers: false,
                }
              : {
                  base_price: basePrice,
                  sale_price: item.sale_price || 0,
                  is_on_sale: isOnSale,
                  available_for_ecommerce: availableForEcommerce,
                  is_featured: isFeatured,
                  allow_pos_price_override: allowPosPriceOverride,
                  has_multiple_price_tiers: hasMultiplePriceTiers,
                };

            const newProduct = await tx.products.create({
              data: {
                name: item.product_name,
                slug:
                  item.product_name
                    .toLowerCase()
                    .replace(/[^a-z0-9]+/g, '-')
                    .replace(/(^-|-$)+/g, '') + `-${Date.now()}`,
                description: item.product_description || '',
                sku: item.sku || `GEN-${Date.now()}`,
                cost_price: cost,
                profit_margin: margin,
                stock_quantity: 0,
                state: productState,
                store_id: storeId,
                weight: item.weight || 0,
                product_type: productType,
                track_inventory: trackInventory,
                pricing_type: pricingType,
                brand_id: brandId,
                ...ingredientOverrides,
                product_categories: {
                  create: categoryIds.map((id) => ({ category_id: id })),
                },
                product_tax_assignments:
                  taxCategoryIds !== undefined
                    ? {
                        create: taxCategoryIds.map((id) => ({
                          tax_category_id: id,
                        })),
                      }
                    : undefined,
              },
            });
            finalProductId = newProduct.id;
          }
        }

        // Insumo por product_id (flujo POP: configure de producto EXISTENTE). El
        // bloque de creación anterior solo corre para líneas SIN product_id; el
        // POP siempre envía product_id, por lo que la config UoM + factor de un
        // insumo existente se persiste aquí. purchase_order_items NO almacena el
        // factor y el caso cross-dimension (count→mass/volume) no es re-derivable
        // en receive, así que el producto es el único portador del factor hasta
        // la recepción (resolveUoMConversion exige is_ingredient=true + factor).
        if (orderType === 'ingredient' && item.product_id && finalProductId) {
          await this.persistIngredientConfigToProduct(finalProductId, item, tx);
        }

        processedItems.push({
          ...item,
          product_id: finalProductId,
          product_name: undefined,
          sku: undefined,
          product_description: undefined,
        });
      }

      // Calculate totals using processed items
      const subtotal = processedItems.reduce(
        (sum, item) => sum + item.quantity * item.unit_price,
        0,
      );

      const totalAmount =
        subtotal -
        (createPurchaseOrderDto.discount_amount || 0) +
        (createPurchaseOrderDto.tax_amount || 0) +
        (createPurchaseOrderDto.shipping_cost || 0);

      // Generate order number
      const date = new Date();
      const order_number = `PO-${date.getFullYear()}${(date.getMonth() + 1)
        .toString()
        .padStart(
          2,
          '0',
        )}${date.getDate().toString().padStart(2, '0')}-${Math.floor(
        Math.random() * 1000,
      )
        .toString()
        .padStart(3, '0')}`;

      const { items, created_by_user_id, ...orderData } =
        createPurchaseOrderDto;
      const user_id = RequestContextService.getUserId();

      // Validate Location and Supplier existence to prevent FK errors
      if (orderData.location_id) {
        const locationExists = await tx.inventory_locations.findFirst({
          where: { id: orderData.location_id, organization_id },
        });
        if (!locationExists) {
          throw new BadRequestException(
            `La bodega con ID ${orderData.location_id} no existe o no está activa.`,
          );
        }
      }

      if (orderData.supplier_id) {
        const supplierExists = await tx.suppliers.findFirst({
          where: { id: orderData.supplier_id, organization_id },
        });
        if (!supplierExists) {
          throw new BadRequestException(
            `El proveedor con ID ${orderData.supplier_id} no existe.`,
          );
        }
      }

      // Coerce ISO-string dates to Date before Prisma. `@IsDateString` only
      // validates the wire format; Prisma DateTime columns require Date or a
      // full ISO-8601 DateTime, so `YYYY-MM-DD` from <input type="date">
      // would otherwise blow up here.
      const toDate = (v: unknown): Date | undefined => {
        if (v == null || v === '') return undefined;
        if (v instanceof Date) return v;
        const d = new Date(String(v));
        return Number.isNaN(d.getTime()) ? undefined : d;
      };
      const { expected_date: rawExpectedDate, ...orderDataRest } = orderData;

      // Fase 2: `orderType` was resolved at the top of the transaction so the
      // new-product creation block could inherit ingredient flags.
      // Fase 2: when the order is `ingredient`, every line MUST carry the
      // UoM FKs. We do a soft guard here (log + default) instead of a hard
      // 400 to keep legacy clients working. The receive() flow is the
      // authoritative validator when the order is actually received.
      const isIngredient = orderType === 'ingredient';
      const purchaseOrder = await tx.purchase_orders.create({
        data: {
          ...orderDataRest,
          order_type: orderType,
          expected_date: toDate(rawExpectedDate),
          created_by_user_id: user_id,
          organization_id,
          order_number,
          subtotal_amount: subtotal,
          total_amount: totalAmount,
          order_date: new Date(),
          purchase_order_items: {
            create: processedItems.map((item) => {
              // F1 IVA lifecycle: derive net/tax from the entered unit_price
              // and the effective include-tax mode (line override ?? header).
              // `unit_cost` persists the NET price (single source of truth for
              // costing); the VAT treatment for inventory cost is decided later
              // in receive() by fiscal responsibility.
              const derived = this.deriveLineTax(item, createPurchaseOrderDto);
              return {
                product_id: item.product_id,
                product_variant_id: item.product_variant_id,
                quantity_ordered: item.quantity,
                unit_cost: derived.unit_price_net,
                unit_price_net: derived.unit_price_net,
                tax_rate: item.tax_rate ?? null,
                tax_type:
                  (item.tax_type as tax_type_enum | undefined) ??
                  tax_type_enum.iva,
                prices_include_tax: item.prices_include_tax ?? null,
                tax_amount: derived.tax_amount,
                notes: item.notes,
                batch_number: item.batch_number,
                manufacturing_date: toDate(item.manufacturing_date),
                expiration_date: toDate(item.expiration_date),
                // Fase 2: UoM FKs. Required when the parent is `ingredient`;
                // we pass `null` otherwise to keep the column clean.
                purchase_uom_id: isIngredient
                  ? (item.purchase_uom_id ?? null)
                  : null,
                stock_uom_id: isIngredient ? (item.stock_uom_id ?? null) : null,
              };
            }),
          },
        },
        include: {
          suppliers: true,
          location: true,
          purchase_order_items: {
            include: {
              products: true,
              product_variants: true,
            },
          },
        },
      });

      return purchaseOrder;
    });

    // Audit log after transaction
    try {
      const user_id = RequestContextService.getUserId();
      await this.auditService.logCustom(
        user_id ?? 0,
        'PO_CREATED',
        'purchase_orders',
        { purchase_order_id: result.id, order_number: result.order_number },
        result.id,
      );
    } catch (error) {
      this.logger.error(
        `Failed to log audit for PO create #${result.id}: ${error.message}`,
      );
    }

    return result;
  }

  async findAll(query: PurchaseOrderQueryDto) {
    const {
      page = 1,
      limit = 10,
      sort_by = 'order_date',
      sort_order = 'desc',
    } = query;
    const skip = (page - 1) * limit;

    const where: any = {
      supplier_id: query.supplier_id,
      location_id: query.location_id,
      status: query.status,
    };

    // Add date range filter
    if (query.start_date || query.end_date) {
      where.order_date = {};
      if (query.start_date) {
        where.order_date.gte = new Date(query.start_date);
      }
      if (query.end_date) {
        where.order_date.lte = new Date(query.end_date);
      }
    }

    // Add total amount range filter
    if (query.min_total || query.max_total) {
      where.total_amount = {};
      if (query.min_total) {
        where.total_amount.gte = query.min_total;
      }
      if (query.max_total) {
        where.total_amount.lte = query.max_total;
      }
    }

    // Add search filter
    if (query.search) {
      where.OR = [
        { internal_reference: { contains: query.search } },
        { supplier_reference: { contains: query.search } },
        { notes: { contains: query.search } },
        { suppliers: { name: { contains: query.search } } },
      ];
    }

    const include = {
      suppliers: true,
      location: true,
      purchase_order_items: {
        include: {
          products: true,
          product_variants: true,
        },
      },
    };

    const [data, total] = await Promise.all([
      this.prisma.purchase_orders.findMany({
        where,
        include,
        skip,
        take: limit,
        orderBy: { [sort_by]: sort_order },
      }),
      this.prisma.purchase_orders.count({ where }),
    ]);

    return {
      data,
      meta: {
        total,
        page,
        limit,
        total_pages: Math.ceil(total / limit),
      },
    };
  }

  findByStatus(
    status: purchase_order_status_enum,
    query: PurchaseOrderQueryDto,
  ) {
    return this.findAll({
      ...query,
      status,
    });
  }

  findPending(query: PurchaseOrderQueryDto) {
    return this.findAll({
      ...query,
      status: purchase_order_status_enum.approved,
    });
  }

  findBySupplier(supplierId: number, query: PurchaseOrderQueryDto) {
    return this.findAll({
      ...query,
      supplier_id: supplierId,
    });
  }

  findOne(id: number) {
    return this.prisma.purchase_orders.findUnique({
      where: { id },
      include: {
        suppliers: true,
        location: true,
        purchase_order_items: {
          include: {
            products: true,
            product_variants: true,
          },
        },
      },
    });
  }

  async update(id: number, updatePurchaseOrderDto: UpdatePurchaseOrderDto) {
    return this.prisma.$transaction(async (tx) => {
      // If items are being updated, recalculate totals
      if (updatePurchaseOrderDto.items) {
        const subtotal = updatePurchaseOrderDto.items.reduce(
          (sum, item) => sum + item.quantity * item.unit_price,
          0,
        );

        const totalAmount =
          subtotal -
          (updatePurchaseOrderDto.discount_amount || 0) +
          (updatePurchaseOrderDto.tax_amount || 0) +
          (updatePurchaseOrderDto.shipping_cost || 0);

        (updatePurchaseOrderDto as any).subtotal = subtotal;
        (updatePurchaseOrderDto as any).total_amount = totalAmount;
      }

      return tx.purchase_orders.update({
        where: { id },
        data: updatePurchaseOrderDto,
        include: {
          suppliers: true,
          location: true,
          purchase_order_items: {
            include: {
              products: true,
              product_variants: true,
            },
          },
        },
      });
    });
  }

  async approve(id: number) {
    // Schema only carries `approved_by_user_id` (FK) — there is no
    // `approved_date` column. Audit timestamp is recorded via auditService.
    const approver_id = RequestContextService.getUserId() ?? null;
    const result = await this.prisma.purchase_orders.update({
      where: { id },
      data: {
        status: purchase_order_status_enum.approved,
        approved_by_user_id: approver_id,
      },
      include: {
        suppliers: true,
        location: true,
        purchase_order_items: {
          include: {
            products: true,
            product_variants: true,
          },
        },
      },
    });

    // Audit log
    try {
      const user_id = RequestContextService.getUserId();
      await this.auditService.logCustom(
        user_id ?? 0,
        'PO_APPROVED',
        'purchase_orders',
        { purchase_order_id: id },
        id,
      );
    } catch (error) {
      this.logger.error(
        `Failed to log audit for PO approve #${id}: ${error.message}`,
      );
    }

    return result;
  }

  async cancel(id: number) {
    // Schema has no `cancelled_date` column — cancellation timestamp is
    // captured by the audit log entry below.
    const result = await this.prisma.purchase_orders.update({
      where: { id },
      data: {
        status: purchase_order_status_enum.cancelled,
      },
      include: {
        suppliers: true,
        location: true,
        purchase_order_items: {
          include: {
            products: true,
            product_variants: true,
          },
        },
      },
    });

    // Audit log
    try {
      const user_id = RequestContextService.getUserId();
      await this.auditService.logCustom(
        user_id ?? 0,
        'PO_CANCELLED',
        'purchase_orders',
        { purchase_order_id: id },
        id,
      );
    } catch (error) {
      this.logger.error(
        `Failed to log audit for PO cancel #${id}: ${error.message}`,
      );
    }

    return result;
  }

  /**
   * Centralised margin↔price resolution used by `receive()` (and exposed for
   * future call-sites). It encapsulates the "cost anchor" rule used when the
   * confirmation modal does NOT pass any override:
   *
   *   - When an override is provided, that override wins.
   *   - Otherwise the existing base_price is preserved and the margin is
   *     recomputed from the new cost_price. This matches the operator's
   *     mental model: receiving a PO at a higher cost shouldn't silently
   *     change the listing price; the margin absorbs the difference.
   *
   * Returns the final `base_price` and `profit_margin` to persist. Both are
   * numbers (not Decimal) — Prisma will coerce back to Decimal at the column.
   *
   * `costPrice` must already be the *stock* unit cost (post UoM conversion
   * when applicable); margin math is always against the minimum stock unit.
   */
  static resolvePricingAfterReceipt(args: {
    costPrice: number;
    existingBasePrice: number;
    newBasePrice?: number;
    newProfitMargin?: number;
  }): { basePrice: number; profitMargin: number } {
    const { costPrice, existingBasePrice } = args;
    const { newBasePrice, newProfitMargin } = args;

    if (newBasePrice !== undefined && newBasePrice !== null) {
      // Operator pinned the listing price → margin derived from new cost.
      const margin =
        costPrice > 0
          ? Math.round(((newBasePrice - costPrice) / costPrice) * 10000) /
            100
          : 0;
      return { basePrice: newBasePrice, profitMargin: margin };
    }

    if (newProfitMargin !== undefined && newProfitMargin !== null) {
      // Operator pinned the margin → listing price derived from new cost.
      const basePrice = costPrice * (1 + newProfitMargin / 100);
      return {
        basePrice: Math.round(basePrice * 100) / 100,
        profitMargin: newProfitMargin,
      };
    }

    // Cost-anchor default: keep the existing base_price, recompute margin.
    const margin =
      costPrice > 0
        ? Math.round(
            ((existingBasePrice - costPrice) / costPrice) * 10000,
          ) / 100
        : 0;
    return { basePrice: existingBasePrice, profitMargin: margin };
  }

  /**
   * F2 — Persist the ingredient UoM config captured on the PO line onto the
   * product at receipt time, WITHOUT ever clobbering existing values with
   * null/empty. Idempotent: re-receiving the same line resolves to the same
   * values and produces a no-op update.
   *
   * Sources of the "config capturada":
   *   - purchase_uom_id / stock_uom_id: captured on the PO item at create
   *     (only ingredient orders carry them; retail lines have them null).
   *   - purchase_to_stock_factor: derived from the catalog when both UoMs share
   *     a dimension. For the cross-dimension "contenido por envase" case
   *     (count → mass/volume) the factor is NOT derivable and must already live
   *     on the product (inherited at create, F1) — it is left intact here.
   *   - stock_unit / purchase_unit labels: sourced from the UoM `code`.
   *
   * Only fields that are (a) resolvable AND (b) empty on the product OR differ
   * are written; a field is never overwritten with null/empty. New products
   * already inherit the full config at create (F1), so this is a no-op for them.
   */
  /**
   * Persiste la config de insumo (is_ingredient + UoM FKs + `purchase_to_stock_factor`)
   * al producto EXISTENTE referenciado por una línea de orden tipo `ingredient`
   * (flujo POP configure). purchase_order_items NO tiene columna de factor y el
   * caso cross-dimension (count→mass/volume) no es re-derivable del catálogo en
   * receive, por lo que el producto es el único portador del factor hasta la
   * recepción; resolveUoMConversion exige is_ingredient=true + factor para
   * multiplicar stock = qty × factor. Rellena cuando está vacío o difiere; nunca
   * sobreescribe con vacío. Gatea por industria (solo restaurant soporta insumos).
   */
  private async persistIngredientConfigToProduct(
    productId: number,
    item: {
      purchase_uom_id?: number | null;
      stock_uom_id?: number | null;
      purchase_to_stock_factor?: number | null;
    },
    tx: any,
  ): Promise<void> {
    if (item.purchase_uom_id == null && item.stock_uom_id == null) return;

    const product = await tx.products.findFirst({
      where: { id: productId },
      select: {
        id: true,
        store_id: true,
        is_ingredient: true,
        purchase_uom_id: true,
        stock_uom_id: true,
        purchase_to_stock_factor: true,
      },
    });
    if (!product) return;

    const store = await tx.stores.findUnique({
      where: { id: product.store_id },
      select: { industries: true },
    });
    if (!storeIndustriesSupportIngredients(store?.industries)) return;

    // Deriva el factor: manual cross-dimension (count→mass/volume) o catálogo
    // same-dimension. Cross-dimension NO es derivable del factor_to_base.
    let factor: number | undefined;
    if (item.purchase_uom_id != null && item.stock_uom_id != null) {
      const uoms = await tx.units_of_measure.findMany({
        where: { id: { in: [item.stock_uom_id, item.purchase_uom_id] } },
      });
      const stockUom = uoms.find((u) => u.id === item.stock_uom_id);
      const purchaseUom = uoms.find((u) => u.id === item.purchase_uom_id);
      if (stockUom && purchaseUom) {
        const manual = item.purchase_to_stock_factor;
        const isCrossDimensionPackaging =
          purchaseUom.dimension === 'count' &&
          (stockUom.dimension === 'mass' || stockUom.dimension === 'volume');
        if (
          manual != null &&
          Number.isInteger(manual) &&
          manual >= 1 &&
          isCrossDimensionPackaging
        ) {
          factor = manual;
        } else if (stockUom.dimension === purchaseUom.dimension) {
          const derived = Math.round(
            Number(purchaseUom.factor_to_base) /
              Number(stockUom.factor_to_base),
          );
          if (Number.isFinite(derived) && derived >= 1) factor = derived;
        }
      }
    }

    const data: Record<string, any> = {};
    if (!product.is_ingredient) data.is_ingredient = true;
    if (
      item.purchase_uom_id != null &&
      product.purchase_uom_id !== item.purchase_uom_id
    ) {
      data.purchase_uom_id = item.purchase_uom_id;
    }
    if (
      item.stock_uom_id != null &&
      product.stock_uom_id !== item.stock_uom_id
    ) {
      data.stock_uom_id = item.stock_uom_id;
    }
    if (factor != null && product.purchase_to_stock_factor !== factor) {
      data.purchase_to_stock_factor = factor;
    }
    if (Object.keys(data).length > 0) {
      await tx.products.update({ where: { id: productId }, data });
    }
  }

  private async syncIngredientConfigOnReceipt(
    productId: number,
    orderItem:
      | { purchase_uom_id?: number | null; stock_uom_id?: number | null }
      | undefined
      | null,
    tx: any,
  ): Promise<void> {
    const capturedPurchaseUomId = orderItem?.purchase_uom_id ?? null;
    const capturedStockUomId = orderItem?.stock_uom_id ?? null;

    // Nothing captured on the line → not an ingredient line, no-op.
    if (capturedPurchaseUomId == null && capturedStockUomId == null) {
      return;
    }

    const product = await tx.products.findFirst({
      where: { id: productId },
      select: {
        id: true,
        purchase_uom_id: true,
        stock_uom_id: true,
        purchase_to_stock_factor: true,
        stock_unit: true,
        purchase_unit: true,
      },
    });
    if (!product) return;

    // When both FKs are present, resolve the catalog rows to derive the factor
    // (same-dimension only) and the human-readable unit labels.
    let derivedFactor: number | undefined;
    let stockUnitLabel: string | undefined;
    let purchaseUnitLabel: string | undefined;
    if (capturedPurchaseUomId != null && capturedStockUomId != null) {
      const uoms = await tx.units_of_measure.findMany({
        where: { id: { in: [capturedStockUomId, capturedPurchaseUomId] } },
      });
      const stockUom = uoms.find((u) => u.id === capturedStockUomId);
      const purchaseUom = uoms.find((u) => u.id === capturedPurchaseUomId);
      if (stockUom && purchaseUom) {
        stockUnitLabel = stockUom.code;
        purchaseUnitLabel = purchaseUom.code;
        // Same-dimension → derivable from factor_to_base. Cross-dimension
        // (count → mass/volume) → NOT derivable; keep the product's existing
        // manual factor (F1) untouched.
        if (stockUom.dimension === purchaseUom.dimension) {
          const factor = Math.round(
            Number(purchaseUom.factor_to_base) /
              Number(stockUom.factor_to_base),
          );
          if (Number.isFinite(factor) && factor >= 1) {
            derivedFactor = factor;
          }
        }
      }
    }

    // Fill/patch only when the captured value is present AND the product is
    // empty or differs. Never write null/empty.
    const data: Record<string, any> = {};
    if (
      capturedPurchaseUomId != null &&
      product.purchase_uom_id !== capturedPurchaseUomId
    ) {
      data.purchase_uom_id = capturedPurchaseUomId;
    }
    if (
      capturedStockUomId != null &&
      product.stock_uom_id !== capturedStockUomId
    ) {
      data.stock_uom_id = capturedStockUomId;
    }
    if (
      derivedFactor != null &&
      product.purchase_to_stock_factor !== derivedFactor
    ) {
      data.purchase_to_stock_factor = derivedFactor;
    }
    if (stockUnitLabel && (product.stock_unit ?? '') !== stockUnitLabel) {
      data.stock_unit = stockUnitLabel;
    }
    if (
      purchaseUnitLabel &&
      (product.purchase_unit ?? '') !== purchaseUnitLabel
    ) {
      data.purchase_unit = purchaseUnitLabel;
    }

    if (Object.keys(data).length > 0) {
      await tx.products.update({
        where: { id: productId },
        data,
      });
    }
  }

  async receive(id: number, dto: ReceivePurchaseOrderDto) {
    const result = await this.prisma.$transaction(async (tx) => {
      // Create reception record
      const user_id = RequestContextService.getUserId();
      const reception = await tx.purchase_order_receptions.create({
        data: {
          purchase_order_id: id,
          received_by_user_id: user_id,
          notes: dto.notes,
        },
      });

      // Process each item
      for (const item of dto.items) {
        if (item.quantity_received <= 0) continue;

        // Create reception item record
        await tx.purchase_order_reception_items.create({
          data: {
            reception_id: reception.id,
            purchase_order_item_id: item.id,
            quantity_received: item.quantity_received,
          },
        });

        // Increment quantity_received on purchase_order_items
        await tx.purchase_order_items.update({
          where: { id: item.id },
          data: {
            quantity_received: { increment: item.quantity_received },
          },
        });
      }

      // Fetch the updated order to check status and process movements
      const purchaseOrder = await tx.purchase_orders.findUnique({
        where: { id },
        include: {
          purchase_order_items: true,
          location: true,
        },
      });

      if (!purchaseOrder) {
        throw new NotFoundException('Purchase order not found');
      }

      // Resolve costing method via the org/store precedence resolver.
      const organizationId = RequestContextService.getOrganizationId();
      const storeId =
        purchaseOrder.location?.store_id ?? RequestContextService.getStoreId();
      const costingMethod = await this.costingMethodResolver.resolveCostingMethod(
        organizationId!,
        storeId ?? undefined,
      );

      // F1 IVA lifecycle: resolve the commerce's VAT responsibility ONCE for
      // this receipt. O-48 (responsible) excludes IVA from inventory cost;
      // O-49 (non-responsible) capitalizes it. Indeterminate ⇒ responsible.
      const vatResponsible = await this.isVatResponsible(
        organizationId ?? undefined,
        storeId ?? undefined,
      );

      // D2: accumulate the purchase-unit subtotal received in THIS specific
      // reception batch (quantity_received_now × unit_cost, in purchase-order
      // currency, matching the same basis used for `subtotal` at PO creation
      // — see the `subtotal = sum(quantity * unit_price)` calc above in
      // create()). Used below to prorate the accounting entry amount.
      let receivedBatchSubtotal = 0;

      // Create inventory movements, update stock, and calculate cost for received items
      for (const item of dto.items) {
        if (item.quantity_received <= 0) continue;

        const orderItem = purchaseOrder.purchase_order_items.find(
          (i) => i.id === item.id,
        );
        const productId = orderItem?.product_id;
        const productVariantId = orderItem?.product_variant_id;

        if (productId) {
          // F1: `unit_cost` now persists the NET price (see create/deriveLineTax).
          const netUnitCost = Number(orderItem?.unit_cost || 0);
          // AP proration basis stays on the NET subtotal (matches orderSubtotal
          // below, which reads unit_cost), so the accounting ratio is unchanged.
          receivedBatchSubtotal += item.quantity_received * netUnitCost;

          // ===== F1 IVA lifecycle: cost treatment by fiscal responsibility =====
          // Per-unit IVA sealed on the line at create (tax_amount / qty_ordered),
          // with a recompute fallback for legacy lines that predate F1.
          const qtyOrdered = orderItem?.quantity_ordered ?? 0;
          const lineTaxAmount =
            orderItem?.tax_amount != null ? Number(orderItem.tax_amount) : null;
          const ivaPerUnit =
            lineTaxAmount != null && qtyOrdered > 0
              ? lineTaxAmount / qtyOrdered
              : netUnitCost * (Number(orderItem?.tax_rate ?? 0) / 100);

          // O-48 responsible → cost EXCLUDES IVA (net). O-49 non-responsible →
          // CAPITALIZE IVA into cost. Capitalization is on the PURCHASE unit,
          // BEFORE resolveUoMConversion (so the per-stock-unit cost the FIFO
          // engine sees already carries the capitalized IVA when applicable).
          const costUnit = vatResponsible
            ? netUnitCost
            : netUnitCost + ivaPerUnit;

          // Seal the VAT attributable to the units received in THIS batch,
          // proportional to quantity_received (purchase units), accumulating
          // across partial receptions. O-48 → deductible (descontable);
          // O-49 → capitalized into inventory cost.
          const sealedTaxNow = ivaPerUnit * item.quantity_received;
          const prevSealed = vatResponsible
            ? Number(orderItem?.deductible_tax_amount ?? 0)
            : Number(orderItem?.capitalized_tax_amount ?? 0);
          const newSealed =
            Math.round((prevSealed + sealedTaxNow) * 100) / 100;
          await tx.purchase_order_items.update({
            where: { id: item.id },
            data: vatResponsible
              ? { deductible_tax_amount: newSealed }
              : { capitalized_tax_amount: newSealed },
          });

          // ===== UoM conversion (purchase unit → minimum stock unit) =====
          // The frontend sends `item.quantity_received` in the purchase unit
          // (e.g. 10 bottles). The stock tables store everything in the
          // minimum stock unit (e.g. ml). resolveUoMConversion is the ONLY
          // place that multiplies by `purchase_to_stock_factor`, so the cost
          // engine and the stock increment see the same numbers and the
          // `stock_unit_cost` we record per movement is internally
          // consistent with `quantity_on_hand`.
          const {
            stockQuantity: stockQtyReceived,
            stockUnitCost: receiptUnitCost,
            purchaseFactor,
          } = await this.resolveUoMConversion(
            productId,
            item.quantity_received,
            costUnit,
            tx,
          );

          if (purchaseFactor > 1) {
            this.logger.log(
              `[UoM] PO #${id} item #${item.id}: ${item.quantity_received} × ${purchaseFactor} = ${stockQtyReceived} stock units @ ${receiptUnitCost}/unit`,
            );
          }

          // Cost FIRST: weighted-average needs pre-receipt stock reads.
          let costResult: CostCalculationResult | null = null;
          try {
            costResult = await this.costingService.calculateCostOnReceipt(
              {
                product_id: productId,
                variant_id: productVariantId || undefined,
                location_id: purchaseOrder.location_id!,
                quantity_received: stockQtyReceived,
                unit_cost: receiptUnitCost,
                costing_method: costingMethod,
                purchase_order_id: id,
                batch_number: orderItem?.batch_number || undefined,
                manufacturing_date: orderItem?.manufacturing_date || undefined,
                expiration_date: orderItem?.expiration_date || undefined,
              },
              tx,
            );
          } catch (error) {
            this.logger.error(
              `Failed to calculate cost for PO item #${item.id}: ${error.message}`,
              error.stack,
            );
            // Do not block receipt — fall back to the receipt unit cost below.
          }

          // Then update stock levels using StockLevelManager.
          await this.stockLevelManager.updateStock(
            {
              product_id: productId,
              variant_id: productVariantId || undefined,
              location_id: purchaseOrder.location_id!,
              quantity_change: stockQtyReceived,
              movement_type: 'stock_in',
              reason: 'Purchase order receipt',
              create_movement: true,
              source_module: 'pop_purchase',
              unit_cost: costResult?.new_cost_per_unit ?? receiptUnitCost,
              movement_unit_cost: receiptUnitCost,
            },
            tx,
          );

          // ===== QUI-431: serial pool population (same tx) =====
          // For serialized products, every received unit must exist as a real
          // `in_stock` pool row at this location. We populate exactly
          // `stockQtyReceived` rows (the minimum-stock-unit count that
          // updateStock added to quantity_on_hand) using the provided serials,
          // auto-generating unique placeholders for any shortfall so the pool
          // stays in strict parity with stock-on-hand. No-op for products that
          // do not require serial numbers.
          if (await this.serialEnforcement.isSerialized(productId, tx)) {
            // Resolve the optional inventory_batches.id from the PO line's
            // batch_number (batch_id on serials is nullable; we only link
            // when an existing batch row matches product + batch_number).
            let serialBatchId: number | undefined;
            if (orderItem?.batch_number) {
              const batch = await tx.inventory_batches.findFirst({
                where: {
                  product_id: productId,
                  batch_number: orderItem.batch_number,
                },
                select: { id: true },
              });
              serialBatchId = batch?.id;
            }

            await this.serialNumbersService.populatePoolOnReceipt(
              productId,
              productVariantId || undefined,
              purchaseOrder.location_id!,
              serialBatchId,
              item.serial_numbers,
              receiptUnitCost,
              stockQtyReceived,
              tx,
            );

            // Validate parity at item close (count in_stock serials vs on-hand).
            await this.serialEnforcement.assertParityForLocation(
              productId,
              productVariantId || undefined,
              purchaseOrder.location_id!,
              tx,
            );
          }

          // ===== QUI-425 (D2): apply optional pricing overrides =====
          // When the confirmation modal sends new_base_price or
          // new_profit_margin, persist them to the product (and variant when
          // applicable). When neither override is provided we still re-anchor
          // the existing base_price against the *new* cost_price so the
          // stored margin reflects reality — this is the cost-anchor rule
          // and matches what the modal displays in `resulting_margin`.
          if (item.new_base_price !== undefined || item.new_profit_margin !== undefined) {
            const dtoItem = item;
            // QUI-425: recompute margin against the SCOPED cost (the value
            // persisted to cost_price), not the receiving-location-only cost,
            // so base_price = cost_price·(1+margin/100) stays consistent and
            // matches the cost preview's resulting_margin.
            const costForPricing =
              costResult?.new_scoped_cost_per_unit ??
              costResult?.new_cost_per_unit ??
              receiptUnitCost;

            // Persist on the variant first (if present), then on the product
            // for variant-less items. Variants use price_override (NOT
            // base_price) per the product-pricing skill.
            if (productVariantId) {
              const existingVariant = await tx.product_variants.findUnique({
                where: { id: productVariantId },
                select: { price_override: true, profit_margin: true },
              });
              const resolved = PurchaseOrdersService.resolvePricingAfterReceipt(
                {
                  costPrice: Number(costForPricing),
                  existingBasePrice: Number(
                    existingVariant?.price_override ?? 0,
                  ),
                  newBasePrice: dtoItem.new_base_price,
                  newProfitMargin: dtoItem.new_profit_margin,
                },
              );
              await tx.product_variants.update({
                where: { id: productVariantId },
                data: {
                  price_override: resolved.basePrice,
                  profit_margin: resolved.profitMargin,
                },
              });
            } else {
              const existingProduct = await tx.products.findUnique({
                where: { id: productId },
                select: { base_price: true, profit_margin: true },
              });
              const resolved = PurchaseOrdersService.resolvePricingAfterReceipt(
                {
                  costPrice: Number(costForPricing),
                  existingBasePrice: Number(existingProduct?.base_price ?? 0),
                  newBasePrice: dtoItem.new_base_price,
                  newProfitMargin: dtoItem.new_profit_margin,
                },
              );
              await tx.products.update({
                where: { id: productId },
                data: {
                  base_price: resolved.basePrice,
                  profit_margin: resolved.profitMargin,
                },
              });
            }
          } else {
            // No override — apply the cost-anchor rule so the persisted
            // margin tracks the new cost. Without this, the displayed
            // resulting_margin in the preview would diverge from the stored
            // margin on the product.
            // QUI-425: recompute margin against the SCOPED cost (the value
            // persisted to cost_price), not the receiving-location-only cost,
            // so base_price = cost_price·(1+margin/100) stays consistent and
            // matches the cost preview's resulting_margin.
            const costForPricing =
              costResult?.new_scoped_cost_per_unit ??
              costResult?.new_cost_per_unit ??
              receiptUnitCost;
            if (costForPricing > 0) {
              if (productVariantId) {
                const existingVariant = await tx.product_variants.findUnique({
                  where: { id: productVariantId },
                  select: { price_override: true, profit_margin: true },
                });
                const resolved =
                  PurchaseOrdersService.resolvePricingAfterReceipt({
                    costPrice: Number(costForPricing),
                    existingBasePrice: Number(
                      existingVariant?.price_override ?? 0,
                    ),
                  });
                await tx.product_variants.update({
                  where: { id: productVariantId },
                  data: {
                    price_override: resolved.basePrice,
                    profit_margin: resolved.profitMargin,
                  },
                });
              } else {
                const existingProduct = await tx.products.findUnique({
                  where: { id: productId },
                  select: { base_price: true, profit_margin: true },
                });
                const resolved =
                  PurchaseOrdersService.resolvePricingAfterReceipt({
                    costPrice: Number(costForPricing),
                    existingBasePrice: Number(existingProduct?.base_price ?? 0),
                  });
                await tx.products.update({
                  where: { id: productId },
                  data: {
                    base_price: resolved.basePrice,
                    profit_margin: resolved.profitMargin,
                  },
                });
              }
            }
          }

          // F2 — persist the ingredient UoM config captured on the PO line
          // onto the product at receipt time (idempotent; never clobbers with
          // null/empty). New products already inherit the config at create (F1).
          await this.syncIngredientConfigOnReceipt(productId, orderItem, tx);
        }
      }

      // Determine new status based on cumulative quantities
      const all_items_received = purchaseOrder.purchase_order_items.every(
        (item) => (item.quantity_received || 0) >= item.quantity_ordered,
      );

      const some_items_received = purchaseOrder.purchase_order_items.some(
        (item) => (item.quantity_received || 0) > 0,
      );

      let newStatus = purchaseOrder.status;
      if (all_items_received) {
        newStatus = purchase_order_status_enum.received;
      } else if (
        some_items_received &&
        newStatus !== purchase_order_status_enum.received
      ) {
        newStatus = 'partial' as purchase_order_status_enum;
      }

      // Update purchase order status
      const updated_po = await tx.purchase_orders.update({
        where: { id },
        data: {
          status: newStatus,
          received_date: all_items_received ? new Date() : null,
          // F2 IVA lifecycle: persist the supplier's own invoice reference when
          // provided at receipt. Used as the fiscal document's invoice_number
          // and issue_date for the deductible-VAT recognition (240804).
          ...(dto.supplier_invoice_number != null && {
            supplier_invoice_number: dto.supplier_invoice_number,
          }),
          ...(dto.supplier_invoice_date != null && {
            supplier_invoice_date: new Date(dto.supplier_invoice_date),
          }),
        },
        include: {
          suppliers: true,
          location: true,
          purchase_order_items: {
            include: {
              products: true,
              product_variants: true,
            },
          },
        },
      });

      // D2: order-wide subtotal at the same basis as `subtotal` in create()
      // (quantity_ordered × unit_cost across ALL items, not just this batch).
      // Used to derive the proportional share of `total_amount` (which already
      // folds in discount/tax/shipping at header level) for THIS reception.
      const orderSubtotal = updated_po.purchase_order_items.reduce(
        (sum, i) => sum + i.quantity_ordered * Number(i.unit_cost || 0),
        0,
      );

      return {
        updated_po,
        all_items_received,
        reception_id: reception.id,
        received_batch_subtotal: receivedBatchSubtotal,
        order_subtotal: orderSubtotal,
        // F1/F2 IVA lifecycle: fiscal responsibility resolved once inside the
        // tx (O-48 → net cost + deductible VAT; O-49 → capitalized in cost).
        // Surfaced here so the post-tx block can decide whether to recognize
        // the deductible VAT (only O-48).
        vat_responsible: vatResponsible,
      };
    });

    // Audit log after transaction
    try {
      const user_id = RequestContextService.getUserId();
      const audit_action = result.all_items_received
        ? 'PO_RECEIVED'
        : 'PO_PARTIALLY_RECEIVED';
      await this.auditService.logCustom(
        user_id ?? 0,
        audit_action,
        'purchase_orders',
        { purchase_order_id: id, items_count: dto.items.length },
        id,
      );
    } catch (error) {
      this.logger.error(
        `Failed to log audit for PO receive #${id}: ${error.message}`,
      );
    }

    // ===== F2 IVA lifecycle: shared context for the accounting emits =====
    const store_id = result.updated_po.location?.store_id ?? undefined;
    const supplier = result.updated_po.suppliers
      ? {
          id: result.updated_po.suppliers.id,
          name: result.updated_po.suppliers.name,
          tax_id: result.updated_po.suppliers.tax_id ?? undefined,
        }
      : undefined;

    // Step 10: resolve the fiscal accounting entity ONCE (via the canonical
    // FiscalScopeService) and propagate it explicitly to every emitted
    // accounting event. This makes the entity deterministic/traceable instead
    // of relying on createAutoEntry's fallback resolution.
    let accounting_entity_id: number | undefined;
    try {
      const entity =
        await this.fiscalScopeService.resolveAccountingEntityForFiscal({
          organization_id: result.updated_po.organization_id,
          store_id,
        });
      accounting_entity_id = entity?.id;
    } catch (error: any) {
      this.logger.warn(
        `F2: could not resolve fiscal accounting entity for PO #${id}: ${error?.message}`,
      );
    }

    // D2: emit purchase_order.received on EVERY reception (partial or final)
    // so inventory (DR 1435) recognized at receipt time is matched by
    // accounts payable (CR 2205) in the SAME event — no more waiting for the
    // order to be fully received.
    //
    // F2: the amount is the NET share received (Σ quantity × unit_cost, with
    // unit_cost = net per F1). We scale on the NET order subtotal, NOT on
    // `purchase_orders.total_amount` — the latter is inconsistent (net in
    // "exclude"/added-on-top mode, gross in "include" mode). Posting NET here
    // is what lets the F2 VAT complement (DR 240804 / CR 2205 for the IVA)
    // bring the payable to gross WITHOUT double-counting the tax.
    //
    // Idempotency: `source_id` is the reception id (`purchase_order_receptions.id`,
    // unique per reception, not per order), NOT the purchase_order_id. This
    // lets createAutoEntry's (source_type, source_id) duplicate guard allow a
    // second/third partial reception of the SAME order to post its own entry
    // instead of being skipped as a duplicate of the first.
    //
    // The reception that completes the order (all_items_received) posts only
    // the REMAINDER against the net order total — not its own prorated share —
    // so rounding drift from prior partial receptions never leaves a gap or a
    // double-count. The remainder is computed against what accounting has
    // ACTUALLY posted so far (sum of total_debit for this order's previous
    // reception ids), so a prior reception whose emit failed is naturally
    // recovered here instead of being silently lost.
    try {
      // NET order total (Σ quantity_ordered × unit_cost, unit_cost = net). The
      // authoritative net value, independent of the inconsistent total_amount.
      const net_total = Number(result.order_subtotal || 0);

      // F2: régime-aware emit total. O-48 (responsible) posts NET here and lets
      // the VAT complement (DR 240804 / CR 2205) bring the payable to gross.
      // O-49 (non-responsible) has its IVA CAPITALIZED into inventory cost by F1
      // (sealed in capitalized_tax_amount) and NEVER generates a VAT complement,
      // so the reception itself must post GROSS (net + capitalized IVA) — else
      // the GL 1435 understates inventory vs. the FIFO layer AND the CR 2205
      // understates what is actually owed to the supplier. The all_items_received
      // remainder branch trues the order-level total up to gross even across
      // partial receptions.
      const capitalized_iva = result.vat_responsible
        ? 0
        : Math.round(
            result.updated_po.purchase_order_items.reduce(
              (sum, i) => sum + Number(i.capitalized_tax_amount ?? 0),
              0,
            ) * 100,
          ) / 100;
      const emit_total = Math.round((net_total + capitalized_iva) * 100) / 100;

      let batch_amount: number;
      if (result.all_items_received) {
        // Sum what accounting already posted (NET) for THIS order's earlier
        // receptions (source_type is fixed; source_id ranges over this
        // order's other reception ids).
        const priorReceptionIds = (
          await this.prisma.purchase_order_receptions.findMany({
            where: { purchase_order_id: id, id: { not: result.reception_id } },
            select: { id: true },
          })
        ).map((r) => r.id);

        let alreadyPosted = 0;
        if (priorReceptionIds.length > 0) {
          const priorEntries = await this.prisma.accounting_entries.findMany({
            where: {
              source_type: 'purchase_order.received',
              source_id: { in: priorReceptionIds },
            },
            select: { total_debit: true },
          });
          alreadyPosted = priorEntries.reduce(
            (sum, e) => sum + Number(e.total_debit || 0),
            0,
          );
        }
        batch_amount = Math.round((emit_total - alreadyPosted) * 100) / 100;
      } else if (result.order_subtotal > 0) {
        // Proportional share of this batch vs. the order's full NET subtotal
        // scaled onto the emit total (gross for O-49). The final reception's
        // remainder branch trues up any per-batch rounding drift.
        batch_amount =
          Math.round(
            (result.received_batch_subtotal / result.order_subtotal) *
              emit_total *
              100,
          ) / 100;
      } else {
        batch_amount = 0;
      }

      if (batch_amount > 0) {
        this.eventEmitter.emit('purchase_order.received', {
          purchase_order_id: result.updated_po.id,
          reception_id: result.reception_id,
          organization_id: result.updated_po.organization_id,
          store_id,
          accounting_entity_id,
          total_amount: batch_amount,
          user_id: RequestContextService.getUserId(),
          // C4-followup: result.updated_po.suppliers ya viene completo del
          // include de la transacción — sin lookup adicional.
          supplier,
        });
      }
    } catch (error) {
      this.logger.error(
        `Failed to emit purchase_order.received for PO #${id} (reception #${result.reception_id}): ${error.message}`,
      );
    }

    // ===== F2 (Step 9): recognize the DEDUCTIBLE VAT (IVA descontable) =====
    // Only for a VAT-responsible commerce (O-48), only once the order is fully
    // received (Σ deductible_tax_amount is fully sealed by F1 across partial
    // receptions), and only when there is IVA to recognize. O-49 never reaches
    // here — its VAT is already capitalized into inventory cost by F1.
    //
    // We materialize a purchase fiscal document (`invoices` row) that feeds the
    // VAT declaration (calculateVat), and emit `purchase.vat_recognized` so the
    // ledger complement DR 240804 / CR 2205 (iva) is posted. The document is
    // created WITHOUT going through invoice-flow send()/accept(), so it never
    // fires `support_document.accepted` (which would post 5195 + full 2205).
    try {
      if (result.vat_responsible && result.all_items_received && store_id != null) {
        const iva_amount =
          Math.round(
            result.updated_po.purchase_order_items.reduce(
              (sum, i) => sum + Number(i.deductible_tax_amount ?? 0),
              0,
            ) * 100,
          ) / 100;
        const net_amount = Number(result.order_subtotal || 0);

        if (iva_amount > 0 && accounting_entity_id != null) {
          const invoice = await this.materializeVatDocument({
            purchase_order_id: result.updated_po.id,
            order_number: result.updated_po.order_number,
            supplier_invoice_number:
              result.updated_po.supplier_invoice_number ?? null,
            supplier_invoice_date:
              result.updated_po.supplier_invoice_date ?? null,
            supplier,
            organization_id: result.updated_po.organization_id,
            store_id,
            accounting_entity_id,
            net_amount,
            iva_amount,
            user_id: RequestContextService.getUserId(),
          });

          if (invoice) {
            this.eventEmitter.emit('purchase.vat_recognized', {
              invoice_id: invoice.id,
              purchase_order_id: result.updated_po.id,
              reception_id: result.reception_id,
              organization_id: result.updated_po.organization_id,
              store_id,
              accounting_entity_id,
              iva_amount,
              supplier,
              user_id: RequestContextService.getUserId(),
            });
          }
        }
      }
    } catch (error: any) {
      this.logger.error(
        `F2: failed to recognize deductible VAT for PO #${id} (reception #${result.reception_id}): ${error?.message}`,
      );
    }

    return result.updated_po;
  }

  /**
   * F2 IVA lifecycle — materialize (idempotently) the purchase fiscal document
   * that carries the deductible VAT of a POP purchase into the VAT declaration.
   *
   * Design decisions (documented on purpose):
   * - `invoice_type`: defaults to `support_document`. There is no supplier
   *   "electronic-invoicer" flag in the schema; when one is added, switch to
   *   `purchase_invoice` for e-invoicing suppliers. Both types are classified
   *   as DEDUCTIBLE (not a sale) by `calculateVat`.
   * - `dian_status = not_applicable`: this is an internally-generated purchase
   *   support document, so `calculateVat.isAcceptedForTax` counts it without a
   *   DIAN round-trip.
   * - Created via a direct scoped Prisma insert (NOT `InvoicingService.create`)
   *   to avoid consuming our own DIAN numbering resolution — the invoice_number
   *   is the SUPPLIER's number (or the PO `order_number` as a traceable
   *   fallback), never one of our sequence.
   * - Traceability PO↔invoice (no FK column exists on `invoices`): the
   *   `invoice_number` carries the supplier/PO reference and `supplier_id`
   *   links the counterparty; `notes` records the PO id + order_number.
   * - Idempotency: guarded by the `invoices` unique
   *   (accounting_entity_id, invoice_type, invoice_number). A pre-check
   *   `findFirst` reuses an existing row; a concurrent unique violation (P2002)
   *   is caught and the winning row is returned — so there is never more than
   *   one document per purchase.
   */
  private async materializeVatDocument(params: {
    purchase_order_id: number;
    order_number: string;
    supplier_invoice_number: string | null;
    supplier_invoice_date: Date | null;
    supplier?: { id: number; name?: string; tax_id?: string };
    organization_id: number;
    store_id: number;
    accounting_entity_id: number;
    net_amount: number;
    iva_amount: number;
    user_id?: number;
  }): Promise<{ id: number } | null> {
    const invoice_type = invoice_type_enum.support_document;
    const invoice_number =
      params.supplier_invoice_number?.trim() || params.order_number;
    const issue_date = params.supplier_invoice_date ?? new Date();

    // Idempotency pre-check: reuse an existing document for this purchase.
    const existing = await this.prisma.invoices.findFirst({
      where: {
        accounting_entity_id: params.accounting_entity_id,
        invoice_type,
        invoice_number,
      },
      select: { id: true },
    });
    if (existing) {
      this.logger.log(
        `F2: reusing existing VAT document invoice #${existing.id} for PO #${params.purchase_order_id}`,
      );
      return existing;
    }

    const net = Math.round(params.net_amount * 100) / 100;
    const iva = Math.round(params.iva_amount * 100) / 100;
    const total = Math.round((net + iva) * 100) / 100;
    const tax_rate = net > 0 ? Math.round((iva / net) * 10000) / 100 : 0;

    try {
      const invoice = await this.prisma.invoices.create({
        data: {
          organization_id: params.organization_id,
          // store_id is injected by StorePrismaService from the request context.
          accounting_entity_id: params.accounting_entity_id,
          fiscal_document_type: 'support_document',
          invoice_number,
          invoice_type,
          status: 'validated',
          dian_status: 'not_applicable',
          supplier_id: params.supplier?.id,
          customer_name: params.supplier?.name,
          customer_tax_id: params.supplier?.tax_id,
          subtotal_amount: net,
          discount_amount: 0,
          tax_amount: iva,
          withholding_amount: 0,
          total_amount: total,
          currency: 'COP',
          issue_date,
          created_by_user_id: params.user_id,
          notes: `F2: reconocimiento IVA descontable — PO #${params.purchase_order_id} (${params.order_number})`,
          invoice_taxes: {
            create: [
              {
                tax_name: 'IVA',
                tax_rate,
                taxable_amount: net,
                tax_amount: iva,
                tax_type: tax_type_enum.iva,
              },
            ],
          },
        },
        select: { id: true },
      });
      this.logger.log(
        `F2: materialized VAT document invoice #${invoice.id} (${invoice_type} ${invoice_number}) for PO #${params.purchase_order_id}`,
      );
      return invoice;
    } catch (error: any) {
      // Concurrent creation lost the race on the unique constraint — reuse the
      // winning row so recognition stays idempotent.
      if (error?.code === 'P2002') {
        const winner = await this.prisma.invoices.findFirst({
          where: {
            accounting_entity_id: params.accounting_entity_id,
            invoice_type,
            invoice_number,
          },
          select: { id: true },
        });
        if (winner) return winner;
      }
      throw error;
    }
  }

  // ===== Receptions =====

  async getReceptions(purchaseOrderId: number) {
    return this.prisma.purchase_order_receptions.findMany({
      where: { purchase_order_id: purchaseOrderId },
      include: {
        received_by: {
          select: {
            id: true,
            username: true,
            first_name: true,
            last_name: true,
          },
        },
        items: {
          include: {
            purchase_order_item: {
              include: {
                products: { select: { id: true, name: true } },
                product_variants: {
                  select: { id: true, sku: true, name: true },
                },
              },
            },
          },
        },
      },
      orderBy: { received_at: 'desc' },
    });
  }

  // ===== Cost Summary =====

  async getCostSummary(purchaseOrderId: number) {
    return this.prisma.inventory_cost_layers.findMany({
      where: { purchase_order_id: purchaseOrderId },
      orderBy: { received_at: 'desc' },
    });
  }

  // ===== Timeline =====

  async getTimeline(purchaseOrderId: number) {
    const [auditLogs, receptions, payments, attachments] = await Promise.all([
      this.prisma.audit_logs.findMany({
        where: { resource: 'purchase_orders', resource_id: purchaseOrderId },
        include: {
          users: {
            select: {
              id: true,
              username: true,
              first_name: true,
              last_name: true,
            },
          },
        },
        orderBy: { created_at: 'desc' },
      }),
      this.prisma.purchase_order_receptions.findMany({
        where: { purchase_order_id: purchaseOrderId },
        include: {
          received_by: {
            select: {
              id: true,
              username: true,
              first_name: true,
              last_name: true,
            },
          },
          items: {
            include: {
              purchase_order_item: {
                include: {
                  products: { select: { id: true, name: true, sku: true } },
                  product_variants: {
                    select: { id: true, sku: true, name: true },
                  },
                },
              },
            },
          },
        },
        orderBy: { received_at: 'desc' },
      }),
      this.prisma.purchase_order_payments.findMany({
        where: { purchase_order_id: purchaseOrderId },
        include: {
          created_by: {
            select: {
              id: true,
              username: true,
              first_name: true,
              last_name: true,
            },
          },
        },
        orderBy: { created_at: 'desc' },
      }),
      this.prisma.purchase_order_attachments.findMany({
        where: { purchase_order_id: purchaseOrderId },
        include: {
          uploaded_by: {
            select: {
              id: true,
              username: true,
              first_name: true,
              last_name: true,
            },
          },
        },
        orderBy: { created_at: 'desc' },
      }),
    ]);

    const timeline = [
      ...auditLogs.map((l) => ({
        type: 'audit' as const,
        date: l.created_at || new Date(0),
        data: l,
      })),
      ...receptions.map((r) => ({
        type: 'reception' as const,
        date: r.received_at,
        data: r,
      })),
      ...payments.map((p) => ({
        type: 'payment' as const,
        date: p.created_at,
        data: p,
      })),
      ...attachments.map((a) => ({
        type: 'attachment' as const,
        date: a.created_at,
        data: a,
      })),
    ].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

    return timeline;
  }

  // ===== Attachments =====

  async addAttachment(
    purchaseOrderId: number,
    file: Express.Multer.File,
    dto: AddAttachmentDto,
  ) {
    // 1. Upload to S3 using S3Service (store the KEY, not the presigned URL)
    const s3Key = await this.s3Service.uploadFile(
      file.buffer,
      `purchase-orders/attachments/${purchaseOrderId}/${Date.now()}-${file.originalname}`,
      file.mimetype,
    );

    // 2. Create DB record with S3 key
    const userId = RequestContextService.getUserId();
    const attachment = await this.prisma.purchase_order_attachments.create({
      data: {
        purchase_order_id: purchaseOrderId,
        file_url: s3Key,
        file_name: file.originalname,
        file_type: file.mimetype,
        file_size: file.size,
        supplier_invoice_number: dto.supplier_invoice_number,
        supplier_invoice_date: dto.supplier_invoice_date
          ? new Date(dto.supplier_invoice_date)
          : null,
        supplier_invoice_amount: dto.supplier_invoice_amount,
        notes: dto.notes,
        uploaded_by_user_id: userId,
      },
    });

    // 3. Audit log
    try {
      await this.auditService.logCustom(
        userId ?? 0,
        'PO_ATTACHMENT_ADDED',
        'purchase_orders',
        { file_name: file.originalname, attachment_id: attachment.id },
        purchaseOrderId,
      );
    } catch (error) {
      this.logger.error(
        `Failed to log audit for PO attachment #${purchaseOrderId}: ${error.message}`,
      );
    }

    return attachment;
  }

  async getAttachments(purchaseOrderId: number) {
    const attachments = await this.prisma.purchase_order_attachments.findMany({
      where: { purchase_order_id: purchaseOrderId },
      include: {
        uploaded_by: {
          select: {
            id: true,
            username: true,
            first_name: true,
            last_name: true,
          },
        },
      },
      orderBy: { created_at: 'desc' },
    });

    // Generate presigned URLs for each attachment
    return Promise.all(
      attachments.map(async (att) => ({
        ...att,
        download_url: await this.s3Service.signUrl(att.file_url),
      })),
    );
  }

  async removeAttachment(attachmentId: number) {
    const attachment = await this.prisma.purchase_order_attachments.findUnique({
      where: { id: attachmentId },
    });

    if (!attachment) {
      throw new NotFoundException('Attachment not found');
    }

    // Delete from S3
    try {
      await this.s3Service.deleteFile(attachment.file_url);
    } catch (error) {
      this.logger.error(
        `Failed to delete S3 file ${attachment.file_url}: ${error.message}`,
      );
    }

    // Delete from DB
    await this.prisma.purchase_order_attachments.delete({
      where: { id: attachmentId },
    });

    return { deleted: true };
  }

  // ===== Payments =====

  async registerPayment(purchaseOrderId: number, dto: RegisterPaymentDto) {
    const po = await this.prisma.purchase_orders.findUnique({
      where: { id: purchaseOrderId },
    });
    if (!po) {
      throw new NotFoundException('Purchase order not found');
    }

    // Get existing payments total
    const existingPayments =
      await this.prisma.purchase_order_payments.aggregate({
        where: { purchase_order_id: purchaseOrderId },
        _sum: { amount: true },
      });

    const totalPaid =
      Number(existingPayments._sum.amount || 0) + Number(dto.amount);
    const totalAmount = Number(po.total_amount);

    if (totalPaid > totalAmount) {
      throw new BadRequestException(
        'El pago excedería el monto total de la orden',
      );
    }

    const userId = RequestContextService.getUserId();

    // Create payment record
    const payment = await this.prisma.purchase_order_payments.create({
      data: {
        purchase_order_id: purchaseOrderId,
        amount: dto.amount,
        payment_date: new Date(dto.payment_date),
        payment_method: dto.payment_method,
        reference: dto.reference,
        notes: dto.notes,
        created_by_user_id: userId,
      },
    });

    // Update payment_status on PO
    let paymentStatus: 'unpaid' | 'partial' | 'paid' = 'unpaid';
    if (totalPaid >= totalAmount) paymentStatus = 'paid';
    else if (totalPaid > 0) paymentStatus = 'partial';

    await this.prisma.purchase_orders.update({
      where: { id: purchaseOrderId },
      data: { payment_status: paymentStatus as any },
    });

    // Audit log
    try {
      await this.auditService.logCustom(
        userId ?? 0,
        'PO_PAYMENT_REGISTERED',
        'purchase_orders',
        {
          amount: dto.amount,
          method: dto.payment_method,
          payment_id: payment.id,
        },
        purchaseOrderId,
      );
    } catch (error) {
      this.logger.error(
        `Failed to log audit for PO payment #${purchaseOrderId}: ${error.message}`,
      );
    }

    // Emit event for accounting
    try {
      this.eventEmitter.emit('purchase_order.payment', {
        purchase_order_id: purchaseOrderId,
        organization_id: po.organization_id,
        amount: Number(dto.amount),
        payment_method: dto.payment_method,
        user_id: userId,
      });
    } catch (error) {
      this.logger.error(
        `Failed to emit purchase_order.payment for PO #${purchaseOrderId}: ${error.message}`,
      );
    }

    return payment;
  }

  async getPayments(purchaseOrderId: number) {
    return this.prisma.purchase_order_payments.findMany({
      where: { purchase_order_id: purchaseOrderId },
      include: {
        created_by: {
          select: {
            id: true,
            username: true,
            first_name: true,
            last_name: true,
          },
        },
      },
      orderBy: { created_at: 'desc' },
    });
  }

  async getCostPreview(dto: CostPreviewDto) {
    const organizationId = RequestContextService.getOrganizationId();
    if (!organizationId) {
      throw new BadRequestException('Organization ID not found in context');
    }

    // Resolve costing method via org/store precedence (mirrors receive()).
    const location = await this.prisma.inventory_locations.findUnique({
      where: { id: dto.location_id },
      select: { store_id: true },
    });
    const storeId = location?.store_id ?? RequestContextService.getStoreId();
    const costingMethod = await this.costingMethodResolver.resolveCostingMethod(
      organizationId,
      storeId ?? undefined,
    );

    // F3 preview↔persist parity: resolve the commerce's VAT responsibility ONCE
    // for this preview, using the SAME source of truth as receive() (see the
    // vatResponsible read at receive()'s cost-treatment block). O-48
    // responsible → IVA is descontable, EXCLUDED from cost (net). O-49
    // non-responsible → IVA is CAPITALIZED into the inventory cost. Without
    // this, the preview shows a NET cost while receive() persists a GROSS one,
    // so the modal's new_cost_per_unit diverges from the recorded cost_per_unit
    // by exactly the IVA factor (the observed 1.19 for a 19% line).
    const vatResponsible = await this.isVatResponsible(
      organizationId,
      storeId ?? undefined,
    );

    // Scoped cost aggregates (STORE vs ORGANIZATION) are computed per-item via
    // CostingService.getScopedStockAggregate, which owns the operating-scope
    // location filter and reads UNSCOPED to include org-level warehouses.

    const items: Array<{
      product_id: number;
      product_variant_id: number | null;
      product_name: string;
      variant_name?: string;
      current_stock: number;
      current_cost_per_unit: number;
      global_stock: number;
      global_cost_per_unit: number;
      new_stock: number;
      new_cost_per_unit: number;
      incoming_quantity: number;
      incoming_cost: number;
      // F1 IVA lifecycle preview parity (frontend mirrors deriveLineTax):
      incoming_gross_cost: number;
      unit_price_net: number;
      incoming_tax_per_unit: number;
      incoming_tax_amount: number;
      effective_include: boolean;
      is_reactivation: boolean;
      current_base_price: number;
      current_profit_margin: number;
      resulting_margin: number | null;
    }> = [];

    for (const item of dto.items) {
      const stockLevel = await this.prisma.stock_levels.findFirst({
        where: {
          product_id: item.product_id,
          product_variant_id: item.product_variant_id || null,
          location_id: dto.location_id,
        },
      });

      const currentStock = Number(stockLevel?.quantity_on_hand ?? 0);
      const currentCost = Number(stockLevel?.cost_per_unit ?? 0);

      // Aggregate stock across the scoped location set (org or store) via the
      // shared helper, which reads UNSCOPED so org-level central warehouses
      // (store_id = null) and sibling stores are counted for ORGANIZATION scope
      // — the store-scoped client would drop them and report global_stock = 0,
      // wrongly flagging a reactivation and ignoring the general inventory.
      const { quantity: globalStock, cost_per_unit: globalCostPerUnit } =
        await this.costingService.getScopedStockAggregate({
          product_id: item.product_id,
          variant_id: item.product_variant_id || undefined,
          location_id: dto.location_id,
        });

      // F1 IVA lifecycle: derive the NET cost from the entered (possibly
      // gross) unit_cost + tax_rate + effective include-tax mode. The NET is
      // the cost basis for CPP/FIFO — mirrors what create/receive persist.
      const derivedTax = this.deriveLineTax(
        {
          unit_cost: item.unit_cost,
          quantity: item.quantity,
          tax_rate: item.tax_rate,
          prices_include_tax: item.prices_include_tax,
        },
        dto,
      );
      const netUnitCost = derivedTax.unit_price_net;

      // ===== F3 preview↔persist parity: mirror receive()'s unit cost EXACTLY =====
      // receive() derives the per-stock-unit cost that FIFO/CPP consumes as:
      //   costUnit = vatResponsible ? netUnitCost : netUnitCost + ivaPerUnit
      //   { stockQuantity, stockUnitCost } = resolveUoMConversion(qty, costUnit)
      // where ivaPerUnit == orderItem.tax_amount / quantity_ordered. Because
      // create() persists tax_amount = deriveLineTax().tax_amount (= per-unit
      // tax × quantity) and quantity_ordered = quantity, that ratio is exactly
      // deriveLineTax()'s tax_amount_per_unit — which is what we have here.
      //
      // (1) IVA: O-48 responsible → NET; O-49 non-responsible → capitalize IVA.
      const ivaPerUnit = derivedTax.tax_amount_per_unit;
      const costUnit = vatResponsible ? netUnitCost : netUnitCost + ivaPerUnit;

      // (2) UoM: convert the incoming purchase-unit quantity + capitalized cost
      // to MINIMUM stock units via the SAME helper receive() uses. The CPP must
      // be computed in stock units because globalStock/globalCostPerUnit come
      // from stock_levels (already in stock units) — mixing a purchase-unit
      // quantity into the denominator drifts the result by the conversion
      // factor. resolveUoMConversion no-ops (factor=1) for retail products, so
      // this is byte-for-byte identical to the old behaviour when no UoM
      // conversion applies. `this.prisma` acts as the read client (the helper
      // only issues a scoped products.findFirst, no writes).
      const {
        stockQuantity: incomingStockQty,
        stockUnitCost: incomingStockUnitCost,
      } = await this.resolveUoMConversion(
        item.product_id,
        item.quantity,
        costUnit,
        this.prisma,
      );

      const newStock = globalStock + incomingStockQty;
      const isReactivation = globalStock <= 0;

      let newCostPerUnit: number;
      if (isReactivation || costingMethod === 'fifo') {
        // Stock at zero: previous CPP is orphaned, new cost = the capitalized,
        // stock-unit receipt cost receive() would seal.
        newCostPerUnit = incomingStockUnitCost;
      } else {
        // CPP (weighted average) in STOCK units — mirrors calculateCostOnReceipt.
        newCostPerUnit =
          (globalStock * globalCostPerUnit +
            incomingStockQty * incomingStockUnitCost) /
          newStock;
      }

      // Round to 2 decimals for display
      newCostPerUnit = Math.round(newCostPerUnit * 100) / 100;

      // Fetch product name + current pricing snapshot for the margin UX.
      // We read base_price + profit_margin so the confirmation modal can show
      // the *resulting* margin if the operator accepts the new cost without
      // overrides, and let them know what they're about to overwrite.
      const product = await this.prisma.products.findUnique({
        where: { id: item.product_id },
        select: { name: true, base_price: true, profit_margin: true },
      });

      let variantName: string | undefined;
      let variantBasePrice: number | null = null;
      let variantMargin: number | null = null;
      if (item.product_variant_id) {
        // Variants carry their own price_override (NOT base_price) and
        // profit_margin. We read both so the margin UX reflects the variant
        // pricing when a variant is involved.
        const variant = await this.prisma.product_variants.findUnique({
          where: { id: item.product_variant_id },
          select: { name: true, price_override: true, profit_margin: true },
        });
        variantName = variant?.name || undefined;
        variantBasePrice = variant?.price_override != null
          ? Number(variant.price_override)
          : null;
        variantMargin = variant?.profit_margin != null
          ? Number(variant.profit_margin)
          : null;
      }

      // Current selling price: variant override wins, otherwise product base.
      // current_profit_margin: variant margin wins, otherwise product margin.
      const currentBasePrice =
        variantBasePrice !== null
          ? variantBasePrice
          : Number(product?.base_price ?? 0);
      const currentProfitMargin =
        variantMargin !== null
          ? variantMargin
          : Number(product?.profit_margin ?? 0);

      // Resulting margin reflects what the margin will become if the operator
      // accepts the new cost without changing the base price. Null when the
      // new cost is 0 (e.g. reactivation of a previously-orphaned stock) to
      // avoid a divide-by-zero display.
      const resultingMargin =
        newCostPerUnit > 0
          ? Math.round(
              ((currentBasePrice - newCostPerUnit) / newCostPerUnit) * 10000,
            ) / 100
          : null;

      items.push({
        product_id: item.product_id,
        product_variant_id: item.product_variant_id || null,
        product_name: product?.name || 'Producto desconocido',
        variant_name: variantName,
        current_stock: currentStock,
        current_cost_per_unit: isReactivation
          ? 0
          : Math.round(currentCost * 100) / 100,
        global_stock: globalStock,
        global_cost_per_unit: Math.round(globalCostPerUnit * 100) / 100,
        new_stock: newStock,
        new_cost_per_unit: newCostPerUnit,
        incoming_quantity: item.quantity,
        // incoming_cost is the NET cost basis that actually enters inventory
        // (equals the entered value when no tax applies — legacy-compatible).
        incoming_cost: Math.round(netUnitCost * 100) / 100,
        incoming_gross_cost: item.unit_cost,
        unit_price_net: Math.round(netUnitCost * 100) / 100,
        incoming_tax_per_unit:
          Math.round(derivedTax.tax_amount_per_unit * 100) / 100,
        incoming_tax_amount: Math.round(derivedTax.tax_amount * 100) / 100,
        effective_include: derivedTax.effective_include,
        is_reactivation: isReactivation,
        current_base_price: currentBasePrice,
        current_profit_margin: currentProfitMargin,
        resulting_margin: resultingMargin,
      });
    }

    return { costing_method: toPublicCostingMethod(costingMethod), items };
  }

  remove(id: number) {
    return this.prisma.purchase_orders.delete({
      where: { id },
    });
  }
}
