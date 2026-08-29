import {
  Injectable,
  Logger,
  NotFoundException,
  ConflictException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { StorePrismaService } from '../../../prisma/services/store-prisma.service';
import { GlobalPrismaService } from '../../../prisma/services/global-prisma.service';
import {
  CreateProductDto,
  UpdateProductDto,
  ProductQueryDto,
  CreateProductVariantDto,
  UpdateProductVariantDto,
  CreateVariantWithStockDto,
  ProductImageDto,
  ProductState,
  ProductType,
} from './dto';
import { Prisma } from '@prisma/client';
import { generateSlug } from '@common/utils/slug.util';
import { StockLevelManager } from '../inventory/shared/services/stock-level-manager.service';
import {
  InventoryAdjustmentsService,
  AdjustmentTransactionResult,
} from '../inventory/adjustments/inventory-adjustments.service';
import { LocationsService } from '../inventory/locations/locations.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { RequestContextService } from '@common/context/request-context.service';
import { ProductVariantService } from './services/product-variant.service';
import {
  assertTiersAllowed,
  assertVariantsAllowed,
} from './services/tiers-variants-exclusive.util';
import { resolvePackSize } from './services/packaging.util';
import {
  buildSaleConfigExplanation,
  SaleConfigExplanation,
  SaleConfigPresentation,
  SaleConfigUnit,
} from './services/sale-config-explainer.util';
import { S3Service } from '@common/services/s3.service';
import { QrService } from '@common/services/qr.service';
import { RemoteImageService } from '@common/services/remote-image.service';
import {
  S3PathHelper,
  S3OrgContext,
  S3StoreContext,
} from '@common/helpers/s3-path.helper';
import { extractS3KeyFromUrl } from '@common/helpers/s3-url.helper';
import { VendixHttpException, ErrorCodes } from 'src/common/errors';
import { ImageContext } from '@common/config/image-presets';
import { AIEngineService } from '../../../ai-engine/ai-engine.service';
import {
  GenerateProductDescriptionDto,
  GenerateProductImageEnhancementDto,
} from './dto';
import {
  resolvePosStockScope,
  ResolvedInventoryScope,
  displayableStockLevelsWhere,
} from '../inventory/shared/helpers/pos-stock-scope.helper';
import { resolveProductLowStockThreshold } from '../inventory/shared/helpers/low-stock-threshold.helper';
import { mergeStoreSettingsWithDefaults } from '../settings/defaults/default-store-settings';
import type { StoreSettings } from '../settings/interfaces/store-settings.interface';
import { PromotionEngineService } from '../promotions/promotion-engine/promotion-engine.service';
import { AutoEntryService } from '../accounting/auto-entries/auto-entry.service';
import { storeIndustriesSupportIngredients } from '@common/helpers/industry-capabilities.helper';
import { assertCanChargeVat } from '@common/helpers/vat-responsibility.helper';
import { SettingsService } from '../settings/settings.service';
import type {
  ActiveProductPromotion,
  ActivePromotionProductInput,
} from '../promotions/dto/promotion-quote.interface';

/**
 * Tope de ids materializados por `ProductsService.findIds()`.
 *
 * Acota "seleccionar todos los resultados del filtro" para no prometer al
 * cliente una selección impracticable. Cuando el conteo real lo supera, la
 * respuesta viene con `capped: true` y la UI debe decirlo explícitamente.
 */
export const MAX_PRODUCT_IDS = 1000;

/**
 * CP-PURCHASE-TRANSPARENCY D.4 — una línea del castigo de inventario que
 * precede a un archivado: una tripleta (ubicación, variante, producto) con
 * existencias que se van a llevar a cero.
 */
export interface ArchiveWriteOffLine {
  location_id: number;
  location_name: string;
  product_variant_id: number | null;
  variant_sku: string | null;
  quantity_on_hand: number;
  /**
   * Costo unitario por la CADENA CANÓNICA —`stock_levels.cost_per_unit` →
   * `product_variants.cost_price` → `products.cost_price` → 0—, la misma que
   * `CostingService.consumeCostLayers` aplica bajo promedio ponderado. Bajo
   * FIFO el COGS real sale de las capas y puede diferir; por eso la fila de
   * auditoría guarda tanto lo que se le enseñó al operador como lo que el
   * ajuste terminó costeando.
   */
  unit_cost: number;
  value: number;
  /** `false` ⇒ la cadena canónica se agotó sin encontrar costo. */
  has_known_cost: boolean;
}

/** Una existencia que el archivado NO puede tocar, y por qué se bloquea. */
export interface ArchiveOutOfScopeStock {
  location_id: number;
  location_name: string;
  store_id: number | null;
  quantity_on_hand: number;
}

/**
 * Lo que el archivado va a destruir, calculado ANTES de destruirlo. Es el
 * contrato que la interfaz necesita para enseñar «esto es lo que se va a
 * destruir» y pedir confirmación (D.9), y el mismo objeto que viaja en
 * `details` cuando el backend rechaza por falta de confirmación.
 */
export interface ArchiveWriteOffPlan {
  product_id: number;
  /** `true` cuando hay unidades que castigar: sin esto, archivar no confirma. */
  requires_confirmation: boolean;
  total_units: number;
  total_value: number;
  /**
   * Unidades cuyo costo efectivo es CERO tras agotar la cadena canónica.
   * Medido en desarrollo: el 63,9 % de las unidades fantasma (1.122.249 de
   * 1.756.346). Se destruyen igual —son existencias que no existen— pero su
   * baja no produce asiento contable, porque un asiento por valor cero no es
   * un asiento. Cero aquí significa «costo desconocido», no «gratis», y por eso
   * la cifra viaja hasta la fila de auditoría en vez de diluirse.
   */
  zero_cost_units: number;
  lines: ArchiveWriteOffLine[];
  /**
   * Existencias del producto en ubicaciones que el alcance de la tienda NO ve
   * —hoy, en la práctica, la bodega central de la organización
   * (`inventory_locations.store_id IS NULL`)—. BLOQUEAN el archivado en vez de
   * destruirse: el cliente con alcance de tienda ni siquiera puede escribirlas
   * (el ajuste fallaría con `INV_FIND_001` a mitad de la transacción), y darlas
   * de baja desde la pantalla de una tienda destruiría inventario de la
   * organización que puede estar surtiendo a otras.
   */
  out_of_scope_units: number;
  out_of_scope: ArchiveOutOfScopeStock[];
}

/** Opciones del archivado individual. */
export interface RemoveProductOptions {
  /**
   * El operador VIO el desglose del castigo y dijo que sí. Por defecto `false`:
   * sin esto, un producto con existencias no se archiva. La ruta masiva la
   * propaga desde su propio DTO (D.6) para que un lote de un solo identificador
   * no sea un atajo alrededor de esta compuerta.
   */
  confirm_stock_write_off?: boolean;
  /**
   * Identificador del lote cuando el archivado viene de la ruta masiva. Sólo
   * viaja a la fila de auditoría, para poder reconstruir qué se destruyó bajo
   * una misma confirmación.
   */
  batch_id?: string;
}


type OnlinePurchaseStatusReason =
  | 'ready'
  | 'ecommerce_not_configured'
  | 'ecommerce_domain_not_active';

interface OnlinePurchaseStatus {
  ready: boolean;
  reason: OnlinePurchaseStatusReason;
  message: string;
  domain_id: number | null;
  domain_hostname: string | null;
}

interface OnlinePurchaseData {
  online_purchase_url: string;
  online_purchase_qr_code: string;
  online_purchase_domain_id: number;
  online_purchase_generated_at: Date;
}

@Injectable()
export class ProductsService {
  private readonly logger = new Logger(ProductsService.name);

  constructor(
    private readonly prisma: StorePrismaService,
    private readonly inventoryLocationsService: LocationsService,
    private readonly stockLevelManager: StockLevelManager,
    private readonly eventEmitter: EventEmitter2,
    private readonly productVariantService: ProductVariantService,
    private readonly s3Service: S3Service,
    private readonly qrService: QrService,
    private readonly remoteImageService: RemoteImageService,
    private readonly s3PathHelper: S3PathHelper,
    private readonly ai_engine: AIEngineService,
    private readonly promotionEngine: PromotionEngineService,
    private readonly settingsService: SettingsService,
    private readonly autoEntryService: AutoEntryService,
    // D.4 — el castigo de inventario del archivado pasa SIEMPRE por el
    // servicio de ajustes: nunca por SQL, nunca escribiendo `stock_levels` a
    // mano. Así hereda movimiento, snapshot de valoración, espejo
    // denormalizado y evento contable sin reimplementar ninguno.
    private readonly inventoryAdjustments: InventoryAdjustmentsService,
    // D.4 — SOLO LECTURA, y sólo para una cosa: contar las existencias del
    // producto que quedan FUERA del alcance de la tienda. Ver
    // `buildArchiveWriteOffPlan`.
    private readonly globalPrisma: GlobalPrismaService,
  ) {}

  /**
   * Valida contra el PUC de la organización TODAS las subcuentas de ingreso que
   * un guardado de producto trae consigo: la del producto y la de cada variante,
   * en UNA sola consulta.
   *
   * PATCH-SAFE (y es el punto): sólo entran al lote los campos que el DTO
   * REALMENTE trae. Un producto viejo cuyo `account_code` quedó inválido —porque
   * alguien borró o desactivó la cuenta después— se sigue pudiendo editar en
   * cualquier otro campo: ese `account_code` no viaja en el payload, luego no se
   * valida. Sólo se exige una cuenta válida a quien la está escribiendo ahora.
   *
   * `null` explícito (limpiar el override) también pasa: lo descarta
   * `validateProductAccountCodes`, que ignora vacíos.
   *
   * Sin `organization_id` en el contexto no se valida: el scoping de tenant es
   * responsabilidad del guard/ALS, y fallar aquí convertiría un contexto
   * incompleto en un error de "cuenta contable" que no le dice nada al usuario.
   */
  private async assertAccountCodesArePostable(payload: {
    account_code?: string | null;
    variants?: Array<{ account_code?: string | null } | undefined> | null;
  }): Promise<void> {
    const organization_id = RequestContextService.getOrganizationId();
    if (!organization_id) return;

    const codes: Array<string | null | undefined> = [];
    if ('account_code' in payload && payload.account_code !== undefined) {
      codes.push(payload.account_code);
    }
    for (const variant of payload.variants ?? []) {
      if (variant && variant.account_code !== undefined) {
        codes.push(variant.account_code);
      }
    }
    if (codes.length === 0) return;

    await this.autoEntryService.validateProductAccountCodes(
      organization_id,
      codes,
    );
  }

  /**
   * F4 — Gate "no responsable de IVA" (escritura de producto).
   *
   * Un comercio que NO es responsable de IVA ante la DIAN no puede asignar
   * una categoría de impuesto tipo `iva` a un producto. INC/ICA/retenciones
   * siguen permitidos; las lecturas nunca se bloquean.
   *
   * Solo dispara el rechazo cuando el payload realmente incluye IVA: si no
   * hay categorías IVA en la selección, no consulta fiscal_data (barato en el
   * camino feliz). Indeterminado ⇒ responsable (no bloquea).
   *
   * @param taxCategories categorías ya validadas (existencia/scope) que se van
   *        a asignar, con su `tax_type`.
   */
  private async assertProductVatAssignmentAllowed(
    taxCategories: Array<{ tax_type: string | null }>,
  ): Promise<void> {
    const hasIva = taxCategories.some(
      (tc) => (tc.tax_type ?? '').toLowerCase() === 'iva',
    );
    if (!hasIva) return;

    let fiscalData: any = null;
    try {
      fiscalData = await this.settingsService.getFiscalData();
    } catch {
      // Contexto/fiscal_data no resoluble ⇒ indeterminado ⇒ responsable.
      return;
    }
    assertCanChargeVat(fiscalData, 'product');
  }

  /**
   * Deriva products.purchase_to_stock_factor a partir del catálogo global
   * units_of_measure cuando el payload trae AMBOS stock_uom_id y purchase_uom_id.
   *
   * El factor de conversión es un valor CRÍTICO de costeo (purchase→stock al
   * recibir compras): la fuente de verdad es factor_to_base del catálogo, NO el
   * cliente. Por eso se sobrescribe cualquier purchase_to_stock_factor enviado.
   *
   * Reglas:
   * - Caso cross-dimension "contenido por envase": si la unidad de compra es
   *   discreta (`count`, p.ej. una bolsita) y la de stock es continua
   *   (`mass`/`volume`, p.ej. g/ml), el factor NO se puede derivar de
   *   factor_to_base. El operador lo envía manualmente (`manual_factor`, entero
   *   >= 1 = contenido por envase) → se respeta y se OMITE la validación de
   *   misma-dimensión.
   * - Resto de casos: requiere que ambas unidades compartan la MISMA dimension
   *   (no se puede convertir, p.ej., volumen a peso) → BadRequest si difieren.
   * - factor = round(purchase.factor_to_base / stock.factor_to_base).
   * - Si solo viene uno de los dos FKs (o ninguno), NO se toca el factor:
   *   devuelve undefined y el caller deja el valor existente intacto.
   */
  private async derivePurchaseToStockFactor(
    stock_uom_id: number | null | undefined,
    purchase_uom_id: number | null | undefined,
    manual_factor?: number | null,
  ): Promise<number | undefined> {
    if (
      stock_uom_id === undefined ||
      stock_uom_id === null ||
      purchase_uom_id === undefined ||
      purchase_uom_id === null
    ) {
      return undefined;
    }

    const uoms = await this.prisma.units_of_measure.findMany({
      where: { id: { in: [stock_uom_id, purchase_uom_id] } },
    });

    const stockUom = uoms.find((u) => u.id === stock_uom_id);
    const purchaseUom = uoms.find((u) => u.id === purchase_uom_id);

    if (!stockUom || !purchaseUom) {
      throw new VendixHttpException(
        ErrorCodes.PROD_VALIDATE_001,
        'Unidad de medida no encontrada en el catálogo',
        { stock_uom_id, purchase_uom_id },
      );
    }

    // Cross-dimension "contenido por envase": compra `count` (envase) → stock
    // `mass`/`volume` (contenido). El factor es manual; se respeta sin validar
    // misma-dimensión (no es derivable del catálogo).
    const isCrossDimensionPackaging =
      purchaseUom.dimension === 'count' &&
      (stockUom.dimension === 'mass' || stockUom.dimension === 'volume');
    if (
      manual_factor != null &&
      Number.isInteger(manual_factor) &&
      manual_factor >= 1 &&
      isCrossDimensionPackaging
    ) {
      return manual_factor;
    }

    if (stockUom.dimension !== purchaseUom.dimension) {
      throw new BadRequestException(
        `Las unidades de stock (${stockUom.code}) y compra (${purchaseUom.code}) deben pertenecer a la misma dimensión para poder convertirse`,
      );
    }

    return Math.round(
      Number(purchaseUom.factor_to_base) / Number(stockUom.factor_to_base),
    );
  }

  /**
   * La unidad de STOCK debe ser exacta.
   *
   * El inventario es `Int` en la unidad base (`stock_levels.quantity_on_hand`),
   * así que una unidad cuyo `factor_to_base` no es entero —pulgada = 25,4 mm,
   * galón = 3785,411784 ml— no puede representarse sin perder mercancía en cada
   * conversión. El catálogo marca esas unidades con `is_stock_eligible=false`;
   * siguen sirviendo como unidad de COMPRA (solo convierten al recibir) o como
   * presentación de venta.
   */
  private async assertStockUomEligible(
    stock_uom_id: number | null | undefined,
  ): Promise<void> {
    if (stock_uom_id === undefined || stock_uom_id === null) return;

    const uom = await this.prisma.units_of_measure.findFirst({
      where: { id: stock_uom_id },
      select: { code: true, name: true, is_stock_eligible: true, is_active: true },
    });
    if (!uom || !uom.is_active) {
      throw new VendixHttpException(
        ErrorCodes.PROD_VALIDATE_001,
        'Unidad de medida no encontrada en el catálogo',
        { stock_uom_id },
      );
    }
    if (!uom.is_stock_eligible) {
      throw new VendixHttpException(
        ErrorCodes.PROD_UOM_NOT_STOCK_ELIGIBLE,
        `${uom.name} (${uom.code}) no puede ser la unidad de stock porque su factor de conversión no es entero. Úsala como unidad de compra o define el stock en una unidad exacta.`,
        { stock_uom_id, code: uom.code },
      );
    }
  }

  async generateDescription(dto: GenerateProductDescriptionDto) {
    const productData: Record<string, any> = { nombre: dto.name };

    if (dto.brand) productData.marca = dto.brand;
    if (dto.category) productData.categorías = dto.category;
    if (dto.base_price) productData.precio = dto.base_price;
    if (dto.sku) productData.sku = dto.sku;
    if (dto.extra_context) productData.extra = dto.extra_context;

    const variables: Record<string, string> = {
      name: dto.name,
      brand: dto.brand || '',
      category: dto.category || '',
      base_price: dto.base_price ? String(dto.base_price) : '',
      sku: dto.sku || '',
      context: JSON.stringify(productData),
    };

    const response = await this.ai_engine.run(
      'product_description_creator',
      variables,
    );

    if (!response.success) {
      throw new VendixHttpException(ErrorCodes.AI_REQUEST_001);
    }

    return { description: response.content };
  }

  async enhanceImage(dto: GenerateProductImageEnhancementDto) {
    const referenceImage = await this.resolveImageReference(dto.image_url);
    const productTypeLabel =
      dto.product_type === 'service' ? 'servicio' : 'producto';
    const variables: Record<string, string> = {
      requested_improvement: dto.prompt.trim(),
      product_name: dto.product_name || '',
      product_type: productTypeLabel,
      description: dto.description || '',
      context: JSON.stringify(dto.extra_context || {}),
    };

    const response = await this.ai_engine.runImage(
      'product_image_enhancer',
      variables,
      {
        action: 'edit',
        inputFidelity: 'high',
        quality: 'high',
        outputFormat: 'png',
        size: 'auto',
        referenceImages: [{ url: referenceImage, detail: 'high' }],
      },
    );

    if (!response.success || !response.imageBase64) {
      throw new VendixHttpException(ErrorCodes.AI_REQUEST_001);
    }

    const imageUrl = response.imageBase64.startsWith('data:image/')
      ? response.imageBase64
      : `data:image/png;base64,${response.imageBase64}`;

    return {
      image_url: imageUrl,
      revised_prompt: response.revisedPrompt,
      model: response.model,
    };
  }

  private async resolveImageReference(imageUrl: string): Promise<string> {
    const trimmed = imageUrl.trim();
    if (trimmed.startsWith('data:image/')) {
      return trimmed;
    }

    const fetchableUrl =
      trimmed.startsWith('http://') || trimmed.startsWith('https://')
        ? trimmed
        : await this.s3Service.signUrl(trimmed);

    if (!fetchableUrl) {
      throw new VendixHttpException(ErrorCodes.UPLOAD_REMOTE_URL_001);
    }

    const preview = await this.remoteImageService.fetchPreview(fetchableUrl);
    return preview.dataUrl;
  }

  async getProductPromotions(productId: number) {
    const records = await this.prisma.promotion_products.findMany({
      where: { product_id: productId },
      include: {
        promotions: {
          select: {
            id: true,
            name: true,
            type: true,
            value: true,
            state: true,
            start_date: true,
            end_date: true,
          },
        },
      },
    });
    const result = records.map((r) => r.promotions);
    // QUI-727 (A.1) / ADR-10 — `cocina` no ve dinero. El `value` de la
    // promoción es el monto del descuento; para cocina se omite (conservando
    // el resto de la estructura: tipo, estado, fechas).
    return this.isKitchenRole()
      ? result.map((p: any) => this.stripPromotionMoneyForCocina(p))
      : result;
  }

  /**
   * QUI-727 (A.1) / ADR-10 — elimina los campos monetarios de una promoción
   * antes de exponerla a `cocina`. El shape seleccionado por
   * `getProductPromotions` sólo trae `value` como monto (descuento); se quita
   * únicamente ese y cualquier otra clave monetaria que llegue a existir
   * (`discount_value`, `max_discount`, `min_purchase`), conservando el resto
   * (tipo de descuento, estado, fechas). Idempotente y no destructivo: si la
   * promoción ya no tiene montos, devuelve el mismo objeto.
   */
  private stripPromotionMoneyForCocina(promotion: any): any {
    if (!promotion || typeof promotion !== 'object') return promotion;
    const {
      value: _value,
      discount_value: _discountValue,
      max_discount: _maxDiscount,
      min_purchase: _minPurchase,
      ...rest
    } = promotion;
    return rest;
  }

  /**
   * Fase 1: pure-ingredient payload sanitizer. If the incoming payload
   * declares `is_ingredient=true` and `is_sellable=false` (a pure
   * ingredient), we force every retail-sale construct to a neutral value
   * so the persisted row is coherent regardless of what the client sent.
   *
   * Idempotent: safe to call on every create/update. Backend is the
   * second line of defense (the form does it in the UI; we do not trust
   * the client). Per the consolidation plan, the DB does NOT carry a
   * hard constraint on the (is_ingredient, is_sellable) pair.
   *
   * Returns a *new* DTO with neutralized fields. The caller should use
   * the returned object in place of the original payload.
   */
  private sanitizeIngredientPayload<
    T extends {
      is_ingredient?: boolean | null;
      is_sellable?: boolean | null;
      base_price?: number | null;
      sale_price?: number | null;
      is_on_sale?: boolean | null;
      allow_pos_price_override?: boolean | null;
      has_multiple_price_tiers?: boolean | null;
      enabled_price_tier_ids?: number[] | null;
      available_for_ecommerce?: boolean | null;
      is_featured?: boolean | null;
      online_purchase_url?: string | null;
    },
  >(dto: T): T {
    const isPure = !!dto.is_ingredient && dto.is_sellable === false;
    if (!isPure) return dto;
    return {
      ...dto,
      base_price: 0,
      sale_price: 0,
      is_on_sale: false,
      allow_pos_price_override: false,
      has_multiple_price_tiers: false,
      enabled_price_tier_ids: [],
      available_for_ecommerce: false,
      is_featured: false,
      online_purchase_url: null,
    } as T;
  }

  /**
   * Store-capability gate for the `is_ingredient` flag (cross-cutting rule).
   *
   * A store can only persist ingredient products if its `industries` support
   * the ingredient capacity (helper: storeIndustriesSupportIngredients,
   * currently `restaurant`). If the payload opts into `is_ingredient=true`
   * but the store does not qualify, the flag is SILENTLY forced off — the
   * retail flow (is_ingredient false/undefined) is never touched.
   *
   * Returns a (possibly mutated) copy of the DTO. Only does DB work when the
   * payload actually requests `is_ingredient=true`, so the retail path stays
   * query-free.
   */
  private async enforceIngredientCapability<
    T extends { is_ingredient?: boolean | null },
  >(dto: T, storeId: number | null | undefined): Promise<T> {
    if (dto.is_ingredient !== true) {
      return dto;
    }
    if (!storeId) {
      return { ...dto, is_ingredient: false };
    }
    const store = await this.prisma.stores.findUnique({
      where: { id: storeId },
      select: { industries: true },
    });
    if (!storeIndustriesSupportIngredients(store?.industries)) {
      return { ...dto, is_ingredient: false };
    }
    return dto;
  }

  async updateProductPromotions(productId: number, promotionIds: number[]) {
    return this.prisma.$transaction(async (tx) => {
      await tx.promotion_products.deleteMany({
        where: { product_id: productId },
      });
      if (promotionIds.length) {
        await tx.promotion_products.createMany({
          data: promotionIds.map((pid) => ({
            promotion_id: pid,
            product_id: productId,
          })),
        });
      }
      return this.getProductPromotions(productId);
    });
  }

  /**
   * Validates and normalizes product data based on product_type.
   * Services cannot have physical attributes (weight, inventory, serial numbers).
   */
  private validateByProductType(dto: Record<string, any>): void {
    if (dto.product_type !== ProductType.SERVICE) return;

    // Services cannot have physical attributes
    if (dto.weight && dto.weight > 0) {
      throw new VendixHttpException(ErrorCodes.PROD_SVC_001);
    }
    if (dto.requires_serial_numbers || dto.requires_batch_tracking) {
      throw new VendixHttpException(ErrorCodes.PROD_SVC_001);
    }

    // Force inventory off for services
    dto.track_inventory = false;
    dto.weight = undefined;
    dto.dimensions = undefined;
    dto.stock_quantity = undefined;
    dto.min_stock_level = undefined;
    dto.max_stock_level = undefined;
    dto.reorder_point = undefined;
    dto.reorder_quantity = undefined;
    dto.requires_serial_numbers = undefined;
    dto.requires_batch_tracking = undefined;
  }

  /**
   * Enforce store-level uniqueness of a barcode across BOTH products and
   * product variants. Source of truth in application logic because variants
   * carry no DB unique constraint; for products it also yields a clean
   * conflict error instead of a raw DB constraint violation.
   *
   * Scoped via StorePrismaService (store-bounded reads). `excludeProductId` /
   * `excludeVariantId` let create/update skip the row being mutated.
   */
  private async assertBarcodeUnique(
    barcode: string | null | undefined,
    options: { excludeProductId?: number; excludeVariantId?: number } = {},
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    const normalized = barcode?.trim();
    if (!normalized) return; // empty/undefined barcodes are not constrained

    const prisma = tx || this.prisma;

    const productConflict = await prisma.products.findFirst({
      where: {
        barcode: { equals: normalized },
        ...(options.excludeProductId && { NOT: { id: options.excludeProductId } }),
      },
      select: { id: true },
    });
    if (productConflict) {
      throw new VendixHttpException(
        ErrorCodes.PROD_BARCODE_DUP_001,
        'El código de barras ya está en uso en esta tienda',
        { barcode: normalized, conflict_type: 'product' },
      );
    }

    const variantConflict = await prisma.product_variants.findFirst({
      where: {
        barcode: { equals: normalized },
        ...(options.excludeVariantId && { NOT: { id: options.excludeVariantId } }),
      },
      select: { id: true },
    });
    if (variantConflict) {
      throw new VendixHttpException(
        ErrorCodes.PROD_BARCODE_DUP_001,
        'El código de barras ya está en uso en esta tienda',
        { barcode: normalized, conflict_type: 'variant' },
      );
    }

    // Tercera tabla del mismo espacio de nombres (QUI-648): la presentación
    // "Caja x12" pistolea su propio código y no puede chocar con el del
    // producto ni con el de una variante. El scoping por tienda lo aporta el
    // cliente scopeado; el índice único parcial lo respalda en la base.
    const presentationConflict =
      await prisma.product_price_tier_assignments.findFirst({
        where: {
          barcode: { equals: normalized },
          ...(options.excludeProductId && {
            NOT: { product_id: options.excludeProductId },
          }),
        },
        select: { product_id: true, price_tier_id: true },
      });
    if (presentationConflict) {
      throw new VendixHttpException(
        ErrorCodes.PROD_BARCODE_DUP_001,
        'El código de barras ya está en uso por una presentación de venta en esta tienda',
        { barcode: normalized, conflict_type: 'presentation' },
      );
    }
  }

  async create(createProductDto: CreateProductDto) {
    // Fase 1: pure-ingredient sanitization. Idempotent.
    let sanitizedDto = this.sanitizeIngredientPayload(createProductDto);
    try {
      // Validate service-specific constraints
      this.validateByProductType(sanitizedDto);

      // Obtener store_id del DTO o del contexto del token
      // Obtener store_id del contexto
      const context = RequestContextService.getContext();
      const store_id = context?.store_id;

      if (!store_id) {
        throw new VendixHttpException(ErrorCodes.STORE_CONTEXT_001);
      }

      // Cross-cutting gate: a store whose industries do not support ingredients
      // can never persist is_ingredient=true. Force it off, then re-sanitize so
      // the neutralized sale fields stay coherent if the flag just flipped.
      sanitizedDto = await this.enforceIngredientCapability(
        sanitizedDto,
        store_id,
      );
      sanitizedDto = this.sanitizeIngredientPayload(sanitizedDto);

      // Verify user context for audit
      const user_id = context?.user_id;
      if (!user_id) {
        throw new VendixHttpException(ErrorCodes.PROD_PERM_001);
      }

      // Generar slug si no se proporciona
      const slug = sanitizedDto.slug || generateSlug(sanitizedDto.name);

      // Verificar que el slug sea único dentro de la tienda
      const existingProduct = await this.prisma.products.findFirst({
        where: {
          slug: slug,
        },
      });

      if (existingProduct) {
        throw new VendixHttpException(ErrorCodes.PROD_DUP_001);
      }

      // Verificar que el SKU sea único si se proporciona
      if (sanitizedDto.sku) {
        const existingSku = await this.prisma.products.findFirst({
          where: {
            sku: sanitizedDto.sku,
          },
        });

        if (existingSku) {
          throw new VendixHttpException(ErrorCodes.PROD_DUP_001);
        }
      }

      // Verificar unicidad del código de barras (producto y variantes) a
      // nivel de tienda antes de crear.
      await this.assertBarcodeUnique(sanitizedDto.barcode);
      if (sanitizedDto.variants && sanitizedDto.variants.length > 0) {
        const seenBarcodes = new Set<string>();
        for (const variant of sanitizedDto.variants) {
          const code = variant.barcode?.trim();
          if (!code) continue;
          if (seenBarcodes.has(code)) {
            throw new VendixHttpException(
              ErrorCodes.PROD_BARCODE_DUP_001,
              'El código de barras ya está en uso en esta tienda',
              { barcode: code, conflict_type: 'variant' },
            );
          }
          seenBarcodes.add(code);
          await this.assertBarcodeUnique(code);
        }
      }

      // Multi-tarifa ⊕ variantes: excluyentes. El producto todavía no existe,
      // así que la cuenta de variantes sale del payload.
      if (sanitizedDto.has_multiple_price_tiers === true) {
        await assertTiersAllowed(this.prisma as any, null, {
          incomingVariantCount: sanitizedDto.variants?.length ?? 0,
          action: 'create_product_with_price_tiers',
        });
      }

      // Verificar que el brand_id exista y esté activo
      if (sanitizedDto.brand_id) {
        const brand = await this.prisma.brands.findFirst({
          where: {
            id: sanitizedDto.brand_id,
            state: { not: 'archived' }, // Excluir marcas archivadas
          },
        });

        if (!brand) {
          throw new VendixHttpException(ErrorCodes.PROD_VALIDATE_001);
        }
      } else {
        // Si brand_id es nulo pero la tabla lo requiere, poner un valor por defecto o error
      }

      // Consultation validation
      if (sanitizedDto.is_consultation) {
        if (sanitizedDto.product_type !== ProductType.SERVICE) {
          throw new BadRequestException(
            'Solo los servicios pueden ser consultas',
          );
        }
        if (!sanitizedDto.requires_booking) {
          throw new BadRequestException(
            'Las consultas requieren reserva previa',
          );
        }
        if (!sanitizedDto.consultation_template_id) {
          throw new BadRequestException(
            'Las consultas requieren una plantilla de consulta',
          );
        }
        if (
          sanitizedDto.send_preconsultation &&
          !sanitizedDto.preconsultation_template_id
        ) {
          throw new BadRequestException(
            'Si se envía preconsulta, se requiere una plantilla de preconsulta',
          );
        }
      }
      if (sanitizedDto.is_consultation === false) {
        sanitizedDto.send_preconsultation = false;
        sanitizedDto.consultation_template_id = undefined;
        sanitizedDto.preconsultation_template_id = undefined;
      }

      // Subcuenta PUC del producto y de cada variante: debe EXISTIR, estar
      // activa y aceptar movimientos en el `chart_of_accounts` de esta
      // organización. Antes sólo se validaba la forma (4-20 dígitos) y un
      // código inexistente se persistía sin queja para descubrirse semanas
      // después como un asiento acreditado a la cuenta de ingreso por defecto.
      // Va ANTES de abrir la transacción: una sola lectura, fuera del pool
      // comprometido, y sin haber escrito nada todavía.
      await this.assertAccountCodesArePostable(sanitizedDto);

      const {
        store_id: dto_store_id,
        category_ids,
        tax_category_ids,
        image_urls,
        images,
        stock_quantity,
        stock_by_location,
        variants,
        enabled_price_tier_ids,
        ...productData
      } = createProductDto;
      const onlinePurchaseData = await this.buildOnlinePurchaseData(
        store_id,
        slug,
      );

      // La unidad de stock debe ser exacta antes de derivar nada: el factor se
      // calcula contra ella y el inventario se lleva en enteros de la base.
      await this.assertStockUomEligible(sanitizedDto.stock_uom_id);

      // Derivar purchase_to_stock_factor desde el catálogo de UoM (fuente de
      // verdad de costeo). Sobrescribe lo que mande el cliente cuando vienen
      // ambos FKs; si no, se respeta el valor del payload.
      const derivedFactor = await this.derivePurchaseToStockFactor(
        sanitizedDto.stock_uom_id,
        sanitizedDto.purchase_uom_id,
        sanitizedDto.purchase_to_stock_factor,
      );

      const result = await this.prisma.$transaction(
        async (prisma) => {
          // Crear producto usando scoped client para asegurar isolation
          const product = await prisma.products.create({
            data: {
              ...productData,
              // Normalizar barcode: '' / whitespace-only → null. Postgres
              // permite múltiples NULL bajo UNIQUE(store_id, barcode) pero NO
              // múltiples '', así que un '' debe persistirse como null.
              barcode: sanitizedDto.barcode?.trim() || null,
              store_id: store_id, // Agregar el store_id del contexto
              slug: slug,
              stock_quantity: 0, // Se inicializará via stock_levels
              ...(derivedFactor !== undefined
                ? { purchase_to_stock_factor: derivedFactor }
                : {}),
              ...(onlinePurchaseData ?? {}),
              updated_at: new Date(),
            } as any,
          });

          if (category_ids && category_ids.length > 0) {
            await prisma.product_categories.createMany({
              data: category_ids.map((categoryId) => ({
                product_id: product.id,
                category_id: categoryId,
              })),
            });
          }

          if (
            enabled_price_tier_ids !== undefined &&
            enabled_price_tier_ids.length > 0
          ) {
            await prisma.product_price_tier_assignments.createMany({
              data: enabled_price_tier_ids.map((priceTierId) => ({
                product_id: product.id,
                price_tier_id: priceTierId,
              })),
              skipDuplicates: true,
            });
          }

          // Crear variantes si se proporcionan
          if (variants && variants.length > 0) {
            for (const variantData of variants) {
              const { variant_image_url, ...variantFields } = variantData;
              const createdVariant =
                await this.productVariantService.createVariant(
                  product.id,
                  {
                    ...variantFields,
                    stock_quantity: variantFields.stock_quantity || 0,
                  },
                  prisma,
                );

              // Process variant image if base64 provided
              if (
                variant_image_url &&
                variant_image_url.startsWith('data:image')
              ) {
                const { org, store: storeCtx } =
                  await this.getStoreWithOrgContext(store_id);
                const basePath = this.s3PathHelper.buildProductPath(
                  org,
                  storeCtx,
                );
                const uploadResult = await this.s3Service.uploadBase64(
                  variant_image_url,
                  `${basePath}/${slug}-variant-${createdVariant.id}-${Date.now()}`,
                  undefined,
                  { generateThumbnail: true, context: ImageContext.PRODUCT },
                );
                const variantImage = await prisma.product_images.create({
                  data: {
                    product_id: product.id,
                    image_url: uploadResult.key,
                    is_main: false,
                  },
                });
                await prisma.product_variants.update({
                  where: { id: createdVariant.id },
                  data: { image_id: variantImage.id },
                });
              }
            }
          }

          // Asignar categorías de impuestos si se proporcionan
          if (tax_category_ids && tax_category_ids.length > 0) {
            // Obtener contexto para validación
            const current_context = RequestContextService.getContext();

            // Validar que las categorías de impuestos existan y estén dentro del scope
            const tax_categories = await prisma.tax_categories.findMany({
              where: {
                id: { in: tax_category_ids },
                ...(current_context?.is_super_admin
                  ? {}
                  : {
                      OR: [
                        { store_id: store_id }, // Categorías específicas - El interceptor garantiza que este store_id es del usuario
                        { store_id: null }, // Categorías globales
                      ],
                    }),
              },
            });

            if (tax_categories.length !== tax_category_ids.length) {
              const found_ids = tax_categories.map((tc) => tc.id);
              const missing_ids = tax_category_ids.filter(
                (id) => !found_ids.includes(id),
              );
              throw new VendixHttpException(ErrorCodes.PROD_VALIDATE_001);
            }

            // F4 — comercio no responsable de IVA no puede asignar IVA.
            await this.assertProductVatAssignmentAllowed(tax_categories);

            await prisma.product_tax_assignments.createMany({
              data: tax_categories.map((tax_category) => ({
                product_id: product.id,
                tax_category_id: tax_category.id,
              })),
            });
          }

          // Manejar imágenes (combinar image_urls legacy con images structured)
          const finalImages: any[] = [];
          let imageContext:
            | { org: S3OrgContext; store: S3StoreContext }
            | undefined;

          // 1. Procesar image_urls (legacy)
          if (image_urls && image_urls.length > 0) {
            imageContext ??= await this.getStoreWithOrgContext(store_id);
            const uploadedImages = await this.handleImageUploads(
              image_urls.map((url, index) => ({
                image_url: url,
                is_main: index === 0,
              })),
              slug,
              imageContext.org,
              imageContext.store,
            );
            finalImages.push(
              ...uploadedImages.map((img) => ({
                ...img,
                product_id: product.id,
              })),
            );
          }

          // 2. Procesar images (structured with possible base64)
          if (images && images.length > 0) {
            imageContext ??= await this.getStoreWithOrgContext(store_id);
            const uploadedImages = await this.handleImageUploads(
              images,
              slug,
              imageContext.org,
              imageContext.store,
            );
            finalImages.push(
              ...uploadedImages.map((img) => ({
                ...img,
                product_id: product.id,
              })),
            );
          }

          if (finalImages.length > 0) {
            // Asegurar que solo haya un is_main
            const mainExists = finalImages.some((img) => img.is_main);
            if (!mainExists) finalImages[0].is_main = true;

            await prisma.product_images.createMany({
              data: finalImages,
            });
          }

          // Un producto CON variantes no tiene stock propio: el saldo vive en
          // cada variante y `syncProductStock` suma esas filas. Escribir además
          // una fila base (`product_variant_id: null`) con el total dejaba
          // existencias fantasma: invisibles en catálogo y POS —porque toda
          // lectura filtra por variante—, pero editables por el ajuste masivo y
          // destruidas en la siguiente edición del producto. El frontend manda
          // `stock_quantity = suma de las variantes` (`product-create-page`), así
          // que sin esta guarda el total se duplicaba en una fila huérfana.
          const hasVariants = !!(variants && variants.length > 0);

          // Inicializar stock levels para múltiples ubicaciones
          if (hasVariants) {
            if (
              (stock_by_location && stock_by_location.length > 0) ||
              (stock_quantity && stock_quantity > 0)
            ) {
              this.logger.warn(
                `Producto ${product.id} se creó con ${variants!.length} variante(s): se ignora el stock base recibido (stock_quantity=${stock_quantity ?? 0}, ubicaciones=${stock_by_location?.length ?? 0}). El saldo lo llevan las variantes.`,
              );
            }
          } else if (stock_by_location && stock_by_location.length > 0) {
            // Usar las ubicaciones especificadas en el DTO
            for (const stockLocation of stock_by_location) {
              await this.stockLevelManager.updateStock(
                {
                  product_id: product.id,
                  location_id: stockLocation.location_id,
                  quantity_change: stockLocation.quantity,
                  movement_type: 'initial',
                  reason: `Initial stock on product creation${stockLocation.notes ? ': ' + stockLocation.notes : ''}`,
                  user_id: user_id,
                  create_movement: true,
                  validate_availability: false,
                },
                prisma,
              );
            }
          } else if (stock_quantity && stock_quantity > 0) {
            // Mantener compatibilidad con el campo stock_quantity (usa ubicación default)
            const defaultLocation =
              await this.inventoryLocationsService.getDefaultLocation(
                product.store_id,
              );

            await this.stockLevelManager.updateStock(
              {
                product_id: product.id,
                location_id: defaultLocation.id,
                quantity_change: stock_quantity,
                movement_type: 'initial',
                reason: 'Initial stock on product creation (legacy)',
                user_id: user_id,
                create_movement: true,
                validate_availability: false,
              },
              prisma,
            );
          }

          // Inicializar stock levels para todas las ubicaciones de la organización
          // Obtenemos el organization_id del contexto
          const orgContext = RequestContextService.getContext();
          if (orgContext?.organization_id) {
            await this.stockLevelManager.initializeStockLevelsForProduct(
              product.id,
              orgContext.organization_id,
              prisma,
            );
          }

          // Obtener el producto completo con todas las relaciones para retornar
          const completeProduct = await prisma.products.findUnique({
            where: { id: product.id },
            include: {
              stores: {
                select: {
                  id: true,
                  name: true,
                  slug: true,
                  organization_id: true,
                },
              },
              brands: true,
              product_categories: {
                include: {
                  categories: true,
                },
              },
              product_tax_assignments: {
                include: {
                  tax_categories: true,
                },
              },
              product_price_tier_assignments: {
                select: { price_tier_id: true },
              },
              product_images: {
                orderBy: { is_main: 'desc' },
              },
              product_variants: {
                include: {
                  product_images: true,
                },
              },
              reviews: {
                where: { state: 'approved' },
                include: {
                  users: {
                    select: {
                      id: true,
                      first_name: true,
                      last_name: true,
                    },
                  },
                },
                orderBy: { created_at: 'desc' },
                take: 10,
              },
              stock_levels: {
                select: {
                  quantity_available: true,
                  quantity_reserved: true,
                  reorder_point: true,
                  inventory_locations: {
                    select: {
                      id: true,
                      name: true,
                      type: true,
                    },
                  },
                },
              },
              _count: {
                select: {
                  product_variants: true,
                  product_images: true,
                  reviews: true,
                },
              },
            },
          });

          // Calcular stock totals dinámicamente
          const totalStockAvailable = completeProduct.stock_levels.reduce(
            (sum, stock) => sum + stock.quantity_available,
            0,
          );
          const totalStockReserved = completeProduct.stock_levels.reduce(
            (sum, stock) => sum + stock.quantity_reserved,
            0,
          );

          // Retornar producto con información de stock enriquecida
          const mainImage = completeProduct.product_images[0];
          let imageUrl = mainImage?.image_url;
          if (imageUrl && !imageUrl.startsWith('http')) {
            imageUrl = await this.s3Service.getPresignedUrl(imageUrl);
          }

          return {
            ...completeProduct,
            image_url: imageUrl,
            // Mantener compatibilidad con el campo existente pero basado en stock_levels
            stock_quantity: totalStockAvailable,
            // Nuevos campos agregados para mayor claridad
            total_stock_available: totalStockAvailable,
            total_stock_reserved: totalStockReserved,
            enabled_price_tier_ids:
              completeProduct.product_price_tier_assignments?.map(
                (assignment) => assignment.price_tier_id,
              ) ?? [],
            stock_by_location: completeProduct.stock_levels.map((stock) => ({
              location_id: stock.inventory_locations.id,
              location_name: stock.inventory_locations.name,
              location_type: stock.inventory_locations.type,
              available: stock.quantity_available,
              reserved: stock.quantity_reserved,
              reorder_point: stock.reorder_point,
            })),
          };
        },
        { timeout: 30000 },
      );

      return result;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === 'P2002') {
          throw new VendixHttpException(ErrorCodes.PROD_DUP_001);
        }
        if (error.code === 'P2003') {
          throw new VendixHttpException(ErrorCodes.PROD_VALIDATE_001);
        }
      }
      throw error;
    }
  }

  /**
   * Construye el `where` del catálogo de productos a partir de
   * `ProductQueryDto`. Fuente ÚNICA de la traducción filtro → Prisma: la
   * consumen `findAll()` (listado paginado) y `findIds()` (materialización de
   * ids para selección masiva), de modo que "seleccionar todos los resultados
   * del filtro" opere exactamente sobre el mismo conjunto que se está viendo.
   *
   * El scope por tienda lo inyecta `StorePrismaService`; aquí no se resuelve
   * tenant a mano.
   */
  private buildProductWhere(query: ProductQueryDto): Prisma.productsWhereInput {
    const {
      search,
      state,
      brand_id,
      include_inactive,
      pos_optimized,
      barcode,
      category_id,
      track_inventory,
      product_type,
      requires_booking,
      is_sellable,
      is_batch_produced,
      is_ingredient,
      ids,
    } = query;

    // Estado: el query param `state` (vía UI o API) tiene prioridad sobre
    // el default. Si el usuario filtra explícitamente por "Archivado",
    // ese filtro debe aplicarse aunque el default sea "excluir archivados".
    //
    // Bug previo: la lógica con `state: include_inactive ? undefined : { not: 'archived' }`
    // + spread `...(state && { state })` no se propagaba correctamente en
    // todos los casos, así que filtrar por "Archivado" devolvía 0 productos.
    //
    // Fix: calcular el state explícitamente basado en la prioridad.
    let effectiveState: ProductState | { not: ProductState } | undefined;
    if (state) {
      effectiveState = state;
    } else if (pos_optimized) {
      effectiveState = ProductState.ACTIVE;
    } else if (include_inactive) {
      effectiveState = undefined;
    } else {
      effectiveState = { not: ProductState.ARCHIVED };
    }

    return {
      // Auto-scoped by StorePrismaService
      state: effectiveState,
      ...(barcode && {
        // Búsqueda exacta por código de barras para POS.
        // Resuelve por barcode a nivel de producto O de cualquier variante.
        OR: [
          { barcode: { equals: barcode } },
          { product_variants: { some: { barcode: { equals: barcode } } } },
          // Tercer espacio del mismo namespace (QUI-648): pistolear el código
          // de la "Caja x12" devuelve su producto, y el POS resuelve la
          // presentación desde el assignment que lo lleva.
          {
            product_price_tier_assignments: {
              some: { barcode: { equals: barcode } },
            },
          },
        ],
      }),
      ...(search &&
        !barcode && {
          OR: [
            { name: { contains: search, mode: 'insensitive' } },
            { description: { contains: search, mode: 'insensitive' } },
            { sku: { contains: search, mode: 'insensitive' } },
          ],
        }),
      ...(brand_id && { brand_id }),
      ...(category_id && {
        product_categories: {
          some: { category_id },
        },
      }),
      ...(track_inventory !== undefined && { track_inventory }),
      ...(product_type && { product_type }),
      ...(requires_booking !== undefined && { requires_booking }),
      ...(is_sellable !== undefined && { is_sellable }),
      ...(is_batch_produced !== undefined && { is_batch_produced }),
      // QUI-729 — tri-estado por `is_ingredient`: ausente => sin filtro
      // ("Todos"), false => solo productos (default del listado admin), true =>
      // solo insumos. Sin default server-side (ADR-6): el default vive en el
      // cliente, y `findIds` (selección masiva) hereda exactamente el mismo
      // conjunto, así que "seleccionar todo" conserva la capacidad de incluir
      // insumos cuando el parámetro se omite.
      ...(is_ingredient !== undefined && { is_ingredient }),
      // Hidratación del stack de selección de la edición masiva: el cliente
      // guarda ids que pueden no estar en la página cargada y los pide de golpe.
      // Se combina con el resto de los filtros (no los reemplaza), así que un id
      // archivado no reaparece: el `effectiveState` por defecto lo sigue
      // excluyendo, igual que en el listado.
      ...(ids?.length && { id: { in: ids } }),
    } as Prisma.productsWhereInput;
  }

  /**
   * Materializa los ids de producto que satisfacen los mismos filtros del
   * listado, con tope explícito (`MAX_PRODUCT_IDS`).
   *
   * Habilita "seleccionar todos los resultados del filtro" sin traer productos
   * completos. `total` es el conteo real sin tope y `capped` avisa cuando el
   * conjunto real excede lo materializado, para que la UI lo diga en voz alta
   * en lugar de truncar en silencio.
   */
  async findIds(
    query: ProductQueryDto,
  ): Promise<{ ids: number[]; total: number; capped: boolean }> {
    const where = this.buildProductWhere(query);

    const [rows, total] = await Promise.all([
      this.prisma.products.findMany({
        where,
        select: { id: true },
        orderBy: { created_at: 'desc' },
        take: MAX_PRODUCT_IDS,
      }),
      this.prisma.products.count({ where }),
    ]);

    return {
      ids: rows.map((row) => row.id),
      total,
      capped: total > MAX_PRODUCT_IDS,
    };
  }

  /**
   * QUI-727 (A.1) — ADR-10: ninguna superficie de cocina muestra dinero.
   *
   * Se usa en `findAll` y `findOne` para recortar el DTO de producto ANTES de
   * serializarlo cuando el actor autenticado tiene el rol `cocina`. Es la
   * primera proyección por rol del repo y se decide AQUÍ (en el servicio),
   * no con un interceptor global: la regla es específica de un rol concreto
   * sobre la lectura de productos, y meterla en un interceptor la haría
   * implícita y difícil de auditar frente a otras lecturas que sí deben
   * mostrar dinero.
   *
   * Alcance de A.1: `cost_price`, `profit_margin` y TODO precio de venta
   * (`base_price`, `sale_price`, `final_price`, `price_override`, promo
   * activa). `mesero` y `STORE_ADMIN` ven lo de siempre.
   */
  private isKitchenRole(): boolean {
    return RequestContextService.getRoles().includes('cocina');
  }

  /**
   * QUI-727 (A.1) — ADR-10: el dato monetario no debe viajar en el payload
   * para `cocina`. Recorta el objeto de producto (y sus variantes) quitando
   * los campos de dinero. Idempotente y no destructivo para el resto de
   * campos estructurales (stock, flags, atributos) que cocina sí consume.
   */
  private stripCocinaMoney(dto: any): any {
    if (!dto || typeof dto !== 'object') return dto;
    const {
      cost_price,
      profit_margin,
      base_price,
      sale_price,
      final_price,
      active_promotion,
      sale_config_summary,
      ...rest
    } = dto;
    if (Array.isArray(rest.product_variants)) {
      rest.product_variants = rest.product_variants.map((variant: any) => {
        if (!variant || typeof variant !== 'object') return variant;
        const {
          cost_price: _vCost,
          profit_margin: _vMargin,
          sale_price: _vSale,
          price_override: _vOverride,
          ...variantRest
        } = variant;
        return variantRest;
      });
    }
    return rest;
  }

  async findAll(query: ProductQueryDto) {
    const {
      page = 1,
      limit = 10,
      pos_optimized,
      barcode,
      include_stock,
      include_variants,
    } = query;
    const skip = (page - 1) * limit;

    // Obtener contexto para aplicar scope automático
    const context = RequestContextService.getContext();
    // store_id check is handled by StorePrismaService

    // QUI-727 (A.1) / ADR-10 — proyección por rol: `cocina` no ve dinero.
    const isCocina = this.isKitchenRole();

    const where = this.buildProductWhere(query);

    // Resolve POS stock scope so we can constrain the stock_levels includes at
    // the Prisma layer (server-side filtering) instead of post-filtering rows.
    const posStockScope: ResolvedInventoryScope | null = pos_optimized
      ? await this.resolvePosScope()
      : null;
    // QUI-559: the POS must only display stock it can actually charge. The
    // filter is the configured scope INTERSECTED with the store's sellable
    // locations — previously `all_locations` meant "no filter at all", so the
    // grid summed inactive warehouses, the central warehouse and
    // quarantine/damaged stock, and the sale was then rejected with a 409
    // because the payment validation excludes exactly those locations.
    const posStockLevelsWhere =
      posStockScope && context?.store_id
        ? displayableStockLevelsWhere(context.store_id, posStockScope)
        : posStockScope?.scope === 'main_location'
          ? { location_id: posStockScope.mainLocationId }
          : undefined;
    // Force stock_levels include under pos_optimized so the recomputed
    // stock_quantity always reflects the resolved scope, never the
    // denormalized cross-location aggregate.
    const includeStockEffective = pos_optimized ? true : include_stock;

    const [products, total, settings] = await Promise.all([
      this.prisma.products.findMany({
        where,
        skip,
        take: limit,
        include: {
          stores: {
            select: {
              id: true,
              name: true,
              slug: true,
            },
          },
          brands: {
            select: {
              id: true,
              name: true,
            },
          },
          product_categories: {
            include: {
              categories: {
                select: {
                  id: true,
                  name: true,
                },
              },
            },
          },
          product_tax_assignments: {
            include: {
              tax_categories: {
                include: {
                  tax_rates: true,
                },
              },
            },
          },
          product_price_tier_assignments: {
            select: { price_tier_id: true, barcode: true },
          },
          product_images: {
            where: { is_main: true },
            take: 1,
          },
          ...(includeStockEffective && {
            stock_levels: {
              ...(posStockLevelsWhere && { where: posStockLevelsWhere }),
              select: {
                product_variant_id: true,
                quantity_available: true,
                quantity_reserved: true,
                inventory_locations: {
                  select: {
                    id: true,
                    name: true,
                    type: true,
                  },
                },
              },
            },
          }),
          ...((include_variants || pos_optimized || barcode) && {
            product_variants: {
              select: {
                id: true,
                sku: true,
                barcode: true,
                price_override: true,
                cost_price: true,
                profit_margin: true,
                is_on_sale: true,
                sale_price: true,
                stock_quantity: true,
                track_inventory_override: true,
                service_duration_minutes: true,
                service_pricing_type: true,
                buffer_minutes: true,
                preparation_time_minutes: true,
                attributes: true,
                name: true,
                stock_levels: {
                  ...(posStockLevelsWhere && { where: posStockLevelsWhere }),
                  select: {
                    quantity_available: true,
                    quantity_reserved: true,
                    ...(!pos_optimized && {
                      inventory_locations: {
                        select: {
                          id: true,
                          name: true,
                          type: true,
                        },
                      },
                    }),
                  },
                },
                product_images: {
                  select: { image_url: true },
                },
              },
            },
          }),
          _count: {
            select: {
              product_variants: true,
              product_images: true,
              reviews: true,
            },
          },
        },
        orderBy: { created_at: 'desc' },
      }),
      this.prisma.products.count({ where }),
      this.loadMergedSettings(),
    ]);

    // Resolve active auto-apply promotions for every product in the listing
    // (batch query). Cards use the promotional unit price computed off the
    // tax-inclusive `final_price`, so the displayed savings stay consistent
    // with the rest of the listing pricing math.
    const activePromotionsByProductId =
      await this.resolveActivePromotionsForListing(products);

    // Para POS optimizado, retornar productos directamente con imágenes firmadas
    if (pos_optimized) {
      const productsWithSignedImages = await Promise.all(
        products.map(async (product) => {
          const raw_image_url = product.product_images?.[0]?.image_url || null;
          const signed_image_url = await this.s3Service.signUrl(raw_image_url);
          const lowStockThreshold = resolveProductLowStockThreshold(
            settings,
            product,
          );

          // Map variant data for POS
          const product_variants =
            product.product_variants?.map((variant: any) => {
              // Disponibilidad calculada desde stock_levels (filtrados ya por
              // posStockScope en el include), NUNCA desde variant.stock_quantity.
              const variantStock = this.sumVariantStock(variant);
              const variantImageUrl = variant.product_images?.image_url || null;
              const effectiveTracking =
                variant.track_inventory_override ?? product.track_inventory;
              const isAvailable = !effectiveTracking || variantStock > 0;

              return {
                id: variant.id,
                name: variant.name,
                sku: variant.sku,
                // Barcode de la variante: necesario para que el escaneo en POS
                // (handleBarcodeScan -> variants.find(v => v.barcode === code))
                // casa la variante exacta. Sin exponerlo, el scan caía siempre
                // al modal de selección manual.
                barcode: variant.barcode,
                price_override: variant.price_override
                  ? Number(variant.price_override)
                  : null,
                cost_price: variant.cost_price
                  ? Number(variant.cost_price)
                  : null,
                profit_margin: variant.profit_margin
                  ? Number(variant.profit_margin)
                  : null,
                is_on_sale: variant.is_on_sale,
                sale_price: variant.sale_price
                  ? Number(variant.sale_price)
                  : null,
                stock: variantStock,
                stock_quantity: variantStock,
                // Campos explícitos source-of-truth para el frontend POS.
                available_stock: effectiveTracking ? variantStock : null,
                is_available: isAvailable,
                effective_track_inventory: effectiveTracking,
                track_inventory_override: variant.track_inventory_override,
                service_duration_minutes: variant.service_duration_minutes,
                service_pricing_type: variant.service_pricing_type,
                buffer_minutes: variant.buffer_minutes,
                preparation_time_minutes: variant.preparation_time_minutes,
                image_url: variantImageUrl,
                attributes: this.parseVariantAttributes(variant.attributes),
              };
            }) || [];

          // Stock del producto en modo POS:
          // - El include ya filtró stock_levels por posStockScope.
          // - Si el producto tiene variantes, sumar sólo filas con
          //   product_variant_id != null para no duplicar; si no, sumar base.
          const hasVariantsRaw = (product.product_variants?.length ?? 0) > 0;
          const stockLevelsForProductTotals = hasVariantsRaw
            ? (product.stock_levels ?? []).filter(
                (sl: any) => sl.product_variant_id != null,
              )
            : (product.stock_levels ?? []);
          const productStockQty = stockLevelsForProductTotals.reduce(
            (s: number, l: any) => s + (l.quantity_available ?? 0),
            0,
          );
          const productIsAvailable = hasVariantsRaw
            ? product_variants.some((v: any) => v.is_available)
            : !product.track_inventory || productStockQty > 0;

          const activePromotion =
            activePromotionsByProductId.get(product.id) ?? null;
          return {
            id: product.id,
            name: product.name,
            slug: product.slug,
            description: product.description,
            base_price: product.base_price,
            sale_price: product.sale_price,
            is_on_sale: product.is_on_sale,
            final_price: this.calculateFinalPrice(product),
            active_promotion: activePromotion,
            sku: product.sku,
            barcode: product.barcode,
            cost_price: product.cost_price,
            profit_margin: product.profit_margin,
            min_stock_level: product.min_stock_level,
            reorder_point: product.reorder_point,
            low_stock_threshold: lowStockThreshold,
            stock_quantity: productStockQty,
            available_stock: product.track_inventory ? productStockQty : null,
            is_available: productIsAvailable,
            effective_track_inventory: product.track_inventory,
            state: product.state,
            pricing_type: String(product.pricing_type),
            product_type: product.product_type,
            track_inventory: product.track_inventory,
            // El POS lee este flag para abrir el modal obligatorio de captura
            // de seriales; sin exponerlo aquí, el modal nunca se dispara y la
            // venta de entrega directa procede sin verificar el serial.
            requires_serial_numbers: product.requires_serial_numbers,
            available_for_ecommerce: product.available_for_ecommerce,
            is_featured: product.is_featured,
            allow_pos_price_override: product.allow_pos_price_override,
            requires_batch_tracking: product.requires_batch_tracking,
            requires_booking: product.requires_booking,
            booking_mode: product.booking_mode,
            buffer_minutes: product.buffer_minutes,
            is_recurring: product.is_recurring,
            service_duration_minutes: product.service_duration_minutes,
            service_modality: product.service_modality,
            service_pricing_type: product.service_pricing_type,
            service_instructions: product.service_instructions,
            image_url: signed_image_url || null,
            brand: product.brands,
            categories:
              product.product_categories?.map((pc: any) => pc.categories) || [],
            product_tax_assignments: product.product_tax_assignments,
            stock_levels: product.stock_levels,
            has_variants: product_variants.length > 0,
            product_variants,
            // Multi-tarifa / empaque (fase 5) — POS necesita el flag para
            // decidir si renderiza el selector de tarifa por línea.
            has_multiple_price_tiers: (product as any).has_multiple_price_tiers,
            enabled_price_tier_ids:
              (product as any).product_price_tier_assignments?.map(
                (assignment: any) => assignment.price_tier_id,
              ) ?? [],
            // QUI-648: cómo se mide y cómo se cobra el producto. Van en el
            // LISTADO —no solo en el detalle— porque el POS decide la captura
            // al tocar la tarjeta: sin esto tendría que pedir el detalle de
            // cada producto medido antes de poder agregarlo al carrito.
            // `sale_config_summary` no viaja acá a propósito: cuesta dos
            // consultas por producto y sería un N+1 sobre la grilla.
            stock_uom_id: (product as any).stock_uom_id ?? null,
            price_unit_quantity: (product as any).price_unit_quantity ?? 1,
            ...(barcode && {
              scanned_price_tier_id:
                (product as any).product_price_tier_assignments?.find(
                  (assignment: any) => assignment.barcode === barcode,
                )?.price_tier_id ?? null,
            }),
          };
        }),
      );

      // Sign variant images
      for (const product of productsWithSignedImages) {
        if (product.product_variants) {
          for (const variant of product.product_variants) {
            if (variant.image_url) {
              variant.image_url = await this.s3Service.signUrl(
                variant.image_url,
              );
            }
          }
        }
      }

      const data = isCocina
        ? productsWithSignedImages.map((p) => this.stripCocinaMoney(p))
        : productsWithSignedImages;
      return {
        data,
        meta: {
          total,
          page,
          limit,
          totalPages: Math.ceil(total / limit),
        },
      };
    }

    // Calcular stock totals dinámicamente para cada producto.
    // Cuando el producto tiene variantes, excluir filas base para no duplicar stock.
    const productsWithStock = await Promise.all(
      products.map(async (product) => {
        const lowStockThreshold = resolveProductLowStockThreshold(
          settings,
          product,
        );
        const hasVariants =
          (product._count?.product_variants ??
            product.product_variants?.length ??
            0) > 0;
        const stockLevelsForTotals = hasVariants
          ? product.stock_levels?.filter(
              (sl: any) => sl.product_variant_id !== null,
            ) || []
          : product.stock_levels || [];
        const totalStockAvailable = stockLevelsForTotals.reduce(
          (sum: number, stock: any) => sum + stock.quantity_available,
          0,
        );
        const totalStockReserved = stockLevelsForTotals.reduce(
          (sum: number, stock: any) => sum + stock.quantity_reserved,
          0,
        );

        const raw_image_url = product.product_images?.[0]?.image_url || null;
        const signed_image_url = await this.s3Service.signUrl(raw_image_url);

        // Map variant data when requested
        const mapped_variants = include_variants
          ? product.product_variants?.map((variant: any) => {
              const variantStock = this.sumVariantStock(variant);
              const effectiveTracking =
                variant.track_inventory_override ?? product.track_inventory;
              return {
                id: variant.id,
                name: variant.name,
                sku: variant.sku,
                barcode: variant.barcode,
                price_override: variant.price_override
                  ? Number(variant.price_override)
                  : null,
                cost_price: variant.cost_price
                  ? Number(variant.cost_price)
                  : null,
                profit_margin: variant.profit_margin
                  ? Number(variant.profit_margin)
                  : null,
                is_on_sale: variant.is_on_sale,
                sale_price: variant.sale_price
                  ? Number(variant.sale_price)
                  : null,
                stock_quantity: variantStock,
                available_stock: effectiveTracking ? variantStock : null,
                is_available: !effectiveTracking || variantStock > 0,
                effective_track_inventory: effectiveTracking,
                track_inventory_override: variant.track_inventory_override,
                service_duration_minutes: variant.service_duration_minutes,
                service_pricing_type: variant.service_pricing_type,
                buffer_minutes: variant.buffer_minutes,
                preparation_time_minutes: variant.preparation_time_minutes,
                attributes: this.parseVariantAttributes(variant.attributes),
              };
            }) || []
          : undefined;

        const activePromotion =
          activePromotionsByProductId.get(product.id) ?? null;
        return {
          id: product.id,
          name: product.name,
          slug: product.slug,
          description: product.description,
          base_price: product.base_price,
          sale_price: product.sale_price,
          is_on_sale: product.is_on_sale,
          final_price: this.calculateFinalPrice(product),
          active_promotion: activePromotion,
          sku: product.sku,
          barcode: product.barcode,
          cost_price: product.cost_price,
          profit_margin: product.profit_margin,
          min_stock_level: product.min_stock_level,
          reorder_point: product.reorder_point,
          low_stock_threshold: lowStockThreshold,
          state: product.state,
          pricing_type: String(product.pricing_type),
          product_type: product.product_type,
          // Flags de la suite restaurante — los consume el selector de
          // componentes de recetas/combos (filtro client-side en
          // RecipeIngredientsService: is_ingredient || is_sellable) y los
          // flujos de producción/KDS. Sin estos campos el listado los omitía
          // y el selector quedaba vacío.
          is_sellable: product.is_sellable,
          is_ingredient: product.is_ingredient,
          is_combo: product.is_combo,
          is_batch_produced: product.is_batch_produced,
          track_inventory: product.track_inventory,
          // El POS lee este flag para abrir el modal obligatorio de captura
          // de seriales; sin exponerlo aquí, el modal nunca se dispara y la
          // venta de entrega directa procede sin verificar el serial.
          requires_serial_numbers: product.requires_serial_numbers,
          available_for_ecommerce: product.available_for_ecommerce,
          is_featured: product.is_featured,
          allow_pos_price_override: product.allow_pos_price_override,
          requires_batch_tracking: product.requires_batch_tracking,
          requires_booking: product.requires_booking,
          booking_mode: product.booking_mode,
          buffer_minutes: product.buffer_minutes,
          is_recurring: product.is_recurring,
          service_duration_minutes: product.service_duration_minutes,
          service_modality: product.service_modality,
          service_pricing_type: product.service_pricing_type,
          service_instructions: product.service_instructions,
          image_url: signed_image_url || null,
          brand: product.brands,
          categories:
            product.product_categories?.map((pc: any) => pc.categories) || [],
          product_tax_assignments: product.product_tax_assignments,
          // Mantener compatibilidad con el campo existente pero basado en stock_levels
          stock_quantity: totalStockAvailable,
          available_stock: product.track_inventory ? totalStockAvailable : null,
          is_available: hasVariants
            ? (mapped_variants?.some((v: any) => v.is_available) ?? false)
            : !product.track_inventory || totalStockAvailable > 0,
          effective_track_inventory: product.track_inventory,
          // Nuevos campos agregados para mayor claridad
          total_stock_available: totalStockAvailable,
          total_stock_reserved: totalStockReserved,
          stock_by_location:
            product.stock_levels?.map((stock) => ({
              location_id: stock.inventory_locations.id,
              location_name: stock.inventory_locations.name,
              location_type: stock.inventory_locations.type,
              available: stock.quantity_available,
              reserved: stock.quantity_reserved,
            })) || [],
          stock_levels: product.stock_levels,
          stores: product.stores,
          ...(include_variants && {
            has_variants: (mapped_variants?.length ?? 0) > 0,
            product_variants: mapped_variants,
          }),
          // Multi-tarifa / empaque (fase 5) — exponer en el listado para que
          // la grid del admin y POS conozcan el flag sin tener que hacer
          // findOne adicional.
          has_multiple_price_tiers: (product as any).has_multiple_price_tiers,
          enabled_price_tier_ids:
            (product as any).product_price_tier_assignments?.map(
              (assignment: any) => assignment.price_tier_id,
            ) ?? [],
          // QUI-648: cómo se mide y cómo se cobra el producto (ver la rama
          // `pos_optimized` para el porqué de exponerlo en el listado).
          stock_uom_id: (product as any).stock_uom_id ?? null,
          price_unit_quantity: (product as any).price_unit_quantity ?? 1,
          // Pistolear el código de una presentación devuelve el producto Y
          // cuál de sus presentaciones se escaneó. Sin esto el POS recibiría
          // el producto y tendría que adivinar la unidad de venta, que es
          // justo lo que el código de barras vino a resolver.
          ...(barcode && {
            scanned_price_tier_id:
              (product as any).product_price_tier_assignments?.find(
                (assignment: any) => assignment.barcode === barcode,
              )?.price_tier_id ?? null,
          }),
        };
      }),
    );

    const data = isCocina
      ? productsWithStock.map((p) => this.stripCocinaMoney(p))
      : productsWithStock;
    return {
      data,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async findOne(id: number) {
    // Obtener contexto para aplicar scope automático
    const context = RequestContextService.getContext();
    // QUI-727 (A.1) / ADR-10 — proyección por rol: `cocina` no ve dinero.
    const isCocina = this.isKitchenRole();

    const product = await this.prisma.products.findFirst({
      where: {
        id,
        state: { not: ProductState.ARCHIVED }, // No mostrar productos archivados
        // Aplicar scope de store_id a menos que sea super admin
        ...(!context?.is_super_admin && {
          store_id: context?.store_id,
        }),
      },
      include: {
        stores: {
          select: {
            id: true,
            name: true,
            slug: true,
            organization_id: true,
          },
        },
        brands: true,
        online_purchase_domain: {
          select: {
            id: true,
            hostname: true,
          },
        },
        product_categories: {
          include: {
            categories: true,
          },
        },
        product_tax_assignments: {
          include: {
            tax_categories: {
              include: {
                tax_rates: true,
              },
            },
          },
        },
        product_price_tier_assignments: {
          select: { price_tier_id: true },
        },
        product_images: {
          orderBy: { is_main: 'desc' },
        },
        product_variants: {
          include: {
            product_images: true,
          },
        },
        reviews: {
          where: { state: 'approved' },
          include: {
            users: {
              select: {
                id: true,
                first_name: true,
                last_name: true,
              },
            },
          },
          orderBy: { created_at: 'desc' },
          take: 10,
        },
        stock_levels: {
          select: {
            location_id: true,
            product_variant_id: true,
            quantity_on_hand: true,
            quantity_available: true,
            quantity_reserved: true,
            reorder_point: true,
            inventory_locations: {
              select: {
                id: true,
                name: true,
                type: true,
              },
            },
          },
        },
        _count: {
          select: {
            product_variants: true,
            product_images: true,
            reviews: true,
          },
        },
        inventory_batches: {
          include: {
            inventory_locations: true,
          },
        },
      },
    });

    if (!product) {
      throw new VendixHttpException(ErrorCodes.PROD_FIND_001);
    }

    // Calcular stock totals dinámicamente.
    // Si el producto tiene variantes, sumar solo filas de variantes (excluir base)
    // para evitar contar stock base huérfano dos veces.
    const hasVariants =
      (product._count?.product_variants ??
        product.product_variants?.length ??
        0) > 0;
    const stockLevelsForTotals = hasVariants
      ? product.stock_levels.filter((sl: any) => sl.product_variant_id !== null)
      : product.stock_levels;
    const totalStockAvailable = stockLevelsForTotals.reduce(
      (sum, stock) => sum + stock.quantity_available,
      0,
    );
    const totalStockReserved = stockLevelsForTotals.reduce(
      (sum, stock) => sum + stock.quantity_reserved,
      0,
    );

    // Sign all images
    await this.signProductImages(product);
    const [onlinePurchaseStatus, settings] = await Promise.all([
      this.resolveOnlinePurchaseStatus(product.store_id),
      this.loadMergedSettings(product.store_id),
    ]);
    const lowStockThreshold = resolveProductLowStockThreshold(
      settings,
      product,
    );

    // Retornar producto con información de stock enriquecida
    const dto = {
      id: product.id,
      name: product.name,
      slug: product.slug,
      description: product.description,
      base_price: product.base_price,
      sale_price: product.sale_price,
      is_on_sale: product.is_on_sale,
      final_price: this.calculateFinalPrice(product),
      sku: product.sku,
      // Código de barras: persistido vía `...productData` en update y vía el
      // bloque explícito en create, pero el form de edición lo lee de ESTE
      // mapeo de detalle al recargar; sin exponerlo aquí parecía "no guardarse".
      barcode: product.barcode,
      cost_price: product.cost_price,
      profit_margin: product.profit_margin,
      min_stock_level: product.min_stock_level,
      reorder_point: product.reorder_point,
      low_stock_threshold: lowStockThreshold,
      state: product.state,
      pricing_type: String(product.pricing_type),
      product_type: product.product_type,
      // Flags de la suite restaurante. Se persisten vía `...productData` en
      // create/update, pero el form de edición los lee de ESTE mapeo de
      // detalle al recargar; sin exponerlos aquí parecían "no guardarse".
      is_sellable: product.is_sellable,
      is_ingredient: product.is_ingredient,
      is_combo: product.is_combo,
      is_batch_produced: product.is_batch_produced,
      // UoM (Modelo B): el form de edición y el panel de inventario los leen
      // de ESTE mapeo. Sin exponerlos aquí, el detalle del producto pierde la
      // capacidad por unidad y el panel muestra el total crudo en vez de
      // unidades selladas.
      stock_unit: product.stock_unit,
      purchase_unit: product.purchase_unit,
      purchase_to_stock_factor: product.purchase_to_stock_factor,
      stock_uom_id: product.stock_uom_id,
      purchase_uom_id: product.purchase_uom_id,
      // Escala del precio: sin exponerla, el editor recargaría un producto
      // vendido por metro como si costara eso por milímetro.
      price_unit_quantity: (product as any).price_unit_quantity ?? 1,
      // Cómo se vende, en una frase. La misma que muestra el editor, para que
      // el móvil y Vexi no tengan que reconstruirla por su cuenta.
      sale_config_summary: await this.buildSaleConfigSummary(
        product as any,
        hasVariants,
      ),
      track_inventory: product.track_inventory,
      // Flag de seriales. Se persiste vía `...productData` en update y vía el
      // bloque explícito en create, pero el form de edición lo lee de ESTE
      // mapeo de detalle al recargar; sin exponerlo aquí parecía "no guardarse".
      requires_serial_numbers: product.requires_serial_numbers,
      available_for_ecommerce: product.available_for_ecommerce,
      is_featured: product.is_featured,
      allow_pos_price_override: product.allow_pos_price_override,
      // Service-specific fields
      service_duration_minutes: product.service_duration_minutes,
      service_modality: product.service_modality,
      service_pricing_type: product.service_pricing_type,
      requires_booking: product.requires_booking,
      is_recurring: product.is_recurring,
      service_instructions: product.service_instructions,
      booking_mode: product.booking_mode,
      buffer_minutes: product.buffer_minutes,
      online_purchase_url: product.online_purchase_url,
      online_purchase_qr_code: product.online_purchase_qr_code,
      online_purchase_domain_id: product.online_purchase_domain_id,
      online_purchase_generated_at: product.online_purchase_generated_at,
      online_purchase_domain_hostname:
        product.online_purchase_domain?.hostname ??
        onlinePurchaseStatus.domain_hostname,
      online_purchase_ready: onlinePurchaseStatus.ready,
      online_purchase_status_reason: onlinePurchaseStatus.reason,
      online_purchase_status_message: this.getOnlinePurchaseStatusMessage(
        product,
        onlinePurchaseStatus,
      ),
      // Consultation fields
      is_consultation: product.is_consultation,
      send_preconsultation: product.send_preconsultation,
      consultation_template_id: product.consultation_template_id,
      preconsultation_template_id: product.preconsultation_template_id,
      // Multi-tarifa / empaque (fase 5)
      has_multiple_price_tiers: (product as any).has_multiple_price_tiers,
      enabled_price_tier_ids:
        (product as any).product_price_tier_assignments?.map(
          (assignment: any) => assignment.price_tier_id,
        ) ?? [],
      image_url: await this.signProductImage(product),
      brand: product.brands,
      categories:
        product.product_categories?.map((pc: any) => pc.categories) || [],
      product_tax_assignments: product.product_tax_assignments,
      product_images: product.product_images,
      product_variants: product.product_variants,
      reviews: product.reviews,
      _count: product._count,
      inventory_batches: product.inventory_batches,
      // Mantener compatibilidad con el campo existente pero basado en stock_levels
      stock_quantity: totalStockAvailable,
      // Nuevos campos agregados para mayor claridad
      total_stock_available: totalStockAvailable,
      total_stock_reserved: totalStockReserved,
      stock_by_location: product.stock_levels.map((stock) => ({
        location_id: stock.inventory_locations.id,
        location_name: stock.inventory_locations.name,
        location_type: stock.inventory_locations.type,
        available: stock.quantity_available,
        reserved: stock.quantity_reserved,
        reorder_point: stock.reorder_point,
      })),
      stock_levels: product.stock_levels,
      stores: product.stores,
    };
    return isCocina ? this.stripCocinaMoney(dto) : dto;
  }

  /**
   * Frase que describe cómo se vende el producto: unidad de stock, escala de
   * precio y presentaciones. Se arma con el helper compartido para que el
   * detalle de API diga exactamente lo mismo que el editor.
   *
   * Cuesta dos consultas y solo se pagan cuando el producto declara unidad de
   * stock o tiene presentaciones habilitadas; el catálogo por pieza —la
   * inmensa mayoría— sale por el camino corto sin tocar la base.
   */
  private async buildSaleConfigSummary(
    product: any,
    hasVariants: boolean,
  ): Promise<SaleConfigExplanation | null> {
    const tierIds: number[] = (product.product_price_tier_assignments ?? [])
      .map((a: any) => a.price_tier_id)
      .filter((id: any) => typeof id === 'number');

    if (!product.stock_uom_id && tierIds.length === 0) return null;

    let stockUnit: SaleConfigUnit | null = null;
    let catalog: SaleConfigUnit[] = [];
    if (product.stock_uom_id) {
      const unit = await this.prisma.units_of_measure.findFirst({
        where: { id: product.stock_uom_id },
        select: {
          code: true,
          name: true,
          dimension: true,
          factor_to_base: true,
        },
      });
      if (unit) {
        stockUnit = {
          code: unit.code,
          name: unit.name,
          dimension: unit.dimension,
          factor_to_base: Number(unit.factor_to_base),
        };
        const siblings = await this.prisma.units_of_measure.findMany({
          where: { dimension: unit.dimension, is_active: true },
          select: {
            code: true,
            name: true,
            dimension: true,
            factor_to_base: true,
          },
        });
        catalog = siblings.map((u) => ({
          code: u.code,
          name: u.name,
          dimension: u.dimension,
          factor_to_base: Number(u.factor_to_base),
        }));
      }
    }

    let presentations: SaleConfigPresentation[] = [];
    if (tierIds.length > 0) {
      const tiers = await this.prisma.price_tiers.findMany({
        where: { id: { in: tierIds }, is_active: true },
        select: {
          id: true,
          name: true,
          units_per_package: true,
          product_overrides: {
            where: { product_id: product.id, variant_id: null },
            select: {
              override_price: true,
              override_units_per_package: true,
            },
          },
        },
      });
      presentations = tiers
        .map((tier) => {
          const override = tier.product_overrides?.[0];
          return {
            name: tier.name,
            packSize: resolvePackSize(
              tier.units_per_package,
              override?.override_units_per_package,
            ),
            price:
              override?.override_price != null
                ? Number(override.override_price)
                : null,
          };
        })
        .filter((p) => p.packSize > 1);
    }

    return buildSaleConfigExplanation({
      stockUnit,
      catalog,
      presentations,
      hasVariants,
      priceUnitQuantity: Number(product.price_unit_quantity ?? 1),
      basePrice:
        product.base_price != null ? Number(product.base_price) : null,
    });
  }

  async findBySlug(storeId: number, slug: string) {
    // storeId param is redundant if forced by context, but we can keep it if needed.
    // However, StorePrismaService filters by context.store_id.
    const product = await this.prisma.products.findFirst({
      where: {
        slug,
        state: ProductState.ACTIVE, // Solo productos activos
      },
      include: {
        stores: true,
        brands: true,
        product_images: true,
        product_variants: true,
      },
    });

    if (!product) {
      throw new VendixHttpException(ErrorCodes.PROD_FIND_001);
    }

    await this.signProductImages(product);

    const dto = {
      ...product,
      pricing_type: String(product.pricing_type),
      image_url: await this.signProductImage(product),
    };
    // QUI-727 (A.1) / ADR-10 — `cocina` no ve dinero: recorta precio/costo/
    // margen (y `price_override` de las variantes incluidas) del objeto final.
    return this.isKitchenRole() ? this.stripCocinaMoney(dto) : dto;
  }

  /**
   * Actualiza un producto aplicando todas las reglas cruzadas del dominio.
   *
   * @param options.lean cuando es `true` devuelve solo `{ id, name, sku }` en
   *        vez de delegar en `findOne()` (que trae promociones activas, stock
   *        por ubicación e imágenes firmadas). Pensado para consumidores en
   *        lote — p.ej. edición masiva — que no consumen el producto completo
   *        y donde N lecturas completas son puro coste. Sin el parámetro el
   *        comportamiento es idéntico al histórico.
   */
  async update(
    id: number,
    updateProductDto: UpdateProductDto,
    options?: { lean?: boolean },
  ): Promise<any> {
    // Fase 1: pure-ingredient sanitization. Idempotent.
    let sanitizedDto = this.sanitizeIngredientPayload(updateProductDto);
    try {
      // Validate service-specific constraints
      this.validateByProductType(sanitizedDto);

      // Verificar que el producto existe y no está archivado
      const existingProduct = await this.prisma.products.findFirst({
        where: {
          id,
          state: { not: ProductState.ARCHIVED },
        },
      });

      if (!existingProduct) {
        throw new VendixHttpException(ErrorCodes.PROD_FIND_001);
      }

      // Cross-cutting gate: only stores whose industries support ingredients
      // may set is_ingredient=true. Gate against the product's own store, then
      // re-sanitize so neutralized sale fields stay coherent if it flipped off.
      sanitizedDto = await this.enforceIngredientCapability(
        sanitizedDto,
        existingProduct.store_id,
      );
      sanitizedDto = this.sanitizeIngredientPayload(sanitizedDto);

      // BLOCK: Check for active stock reservations on the product itself
      const hasActiveReservations =
        await this.prisma.stock_reservations.findFirst({
          where: {
            product_id: id,
            product_variant_id: null,
            status: 'active',
          },
        });
      if (hasActiveReservations) {
        // D.7 — un mismo rechazo, un solo código y un solo estado. Este bloqueo
        // decía `INV_STOCK_001` (400, «Stock insuficiente»), que describe otra
        // cosa: aquí SÍ hay stock, lo que pasa es que está comprometido. El
        // registro de errores y `product-variant.service.ts` ya usaban
        // `PROD_HAS_RESERVATIONS_001` (409) para el mismo hecho, y el frontend
        // no puede ramificar sobre un código que cambia según la puerta.
        throw new VendixHttpException(
          ErrorCodes.PROD_HAS_RESERVATIONS_001,
          'Cannot modify product with active stock reservations. Release reservations first.',
        );
      }

      // Si se actualiza el slug, verificar que sea único dentro de la tienda
      if (sanitizedDto.slug) {
        const existingSlug = await this.prisma.products.findFirst({
          where: {
            slug: sanitizedDto.slug,
            NOT: { id },
          },
        });

        if (existingSlug) {
          throw new VendixHttpException(ErrorCodes.PROD_DUP_001);
        }
      }

      // Si se actualiza el SKU, verificar que sea único dentro de la tienda
      if (sanitizedDto.sku) {
        const existingSku = await this.prisma.products.findFirst({
          where: {
            store_id: existingProduct.store_id,
            sku: sanitizedDto.sku,
            NOT: { id },
          },
        });

        if (existingSku) {
          throw new VendixHttpException(ErrorCodes.PROD_DUP_001);
        }
      }

      // Verificar unicidad del código de barras (producto y variantes) a
      // nivel de tienda antes de actualizar, excluyendo la fila actual.
      if (sanitizedDto.barcode !== undefined) {
        await this.assertBarcodeUnique(sanitizedDto.barcode, {
          excludeProductId: id,
        });
      }
      if (sanitizedDto.variants && sanitizedDto.variants.length > 0) {
        const seenBarcodes = new Set<string>();
        for (const variant of sanitizedDto.variants) {
          const code = variant.barcode?.trim();
          if (!code) continue;
          if (seenBarcodes.has(code)) {
            throw new VendixHttpException(
              ErrorCodes.PROD_BARCODE_DUP_001,
              'El código de barras ya está en uso en esta tienda',
              { barcode: code, conflict_type: 'variant' },
            );
          }
          seenBarcodes.add(code);
          await this.assertBarcodeUnique(code, {
            excludeVariantId: variant.id,
          });
        }
      }

      // Validate: variants require product to have SKU
      if (sanitizedDto.variants && sanitizedDto.variants.length > 0) {
        const productSku = sanitizedDto.sku || existingProduct.sku;
        if (!productSku || productSku.trim() === '') {
          throw new VendixHttpException(ErrorCodes.PROD_VALIDATE_002);
        }
      }

      // BLOCK: cannot change to SERVICE if existing variants present
      if (
        sanitizedDto.product_type === ProductType.SERVICE &&
        existingProduct.product_type !== ProductType.SERVICE
      ) {
        const existingVariantCount = await this.prisma.product_variants.count({
          where: { product_id: id },
        });
        if (existingVariantCount > 0) {
          throw new VendixHttpException(
            ErrorCodes.PROD_SVC_HAS_VARIANTS_001,
            'No se puede cambiar a SERVICE un producto con variantes existentes',
          );
        }
      }

      // BLOCK: multi-tarifa ⊕ variantes. Se bloquea la petición que CREA el
      // conflicto, no la que lo arrastra: un producto legacy que ya tiene ambos
      // debe poder editarse (y reducir variantes) para salir del estado
      // inconsistente. La UI informa el conflicto en ese caso.
      {
        const wasTiers =
          (existingProduct as any).has_multiple_price_tiers === true;
        const willBeTiers =
          sanitizedDto.has_multiple_price_tiers !== undefined
            ? sanitizedDto.has_multiple_price_tiers === true
            : wasTiers;
        const effectiveVariantCount =
          sanitizedDto.variants !== undefined
            ? sanitizedDto.variants.length
            : await this.prisma.product_variants.count({
                where: { product_id: id },
              });

        if (willBeTiers && !wasTiers && effectiveVariantCount > 0) {
          // Prender multi-tarifa sobre un producto con variantes.
          await assertTiersAllowed(this.prisma as any, null, {
            incomingVariantCount: effectiveVariantCount,
            action: 'enable_price_tiers',
          });
        } else if (
          willBeTiers &&
          sanitizedDto.variants?.some((v: any) => !v.id)
        ) {
          // Agregar variantes nuevas a un producto que se vende por presentación.
          await assertVariantsAllowed(this.prisma as any, id, {
            action: 'add_variants',
          });
        }
      }

      // Obtener contexto al inicio
      const context = RequestContextService.getContext();
      const user_id = context?.user_id;

      if (
        !user_id &&
        (sanitizedDto.stock_quantity !== undefined ||
          (sanitizedDto.stock_by_location &&
            sanitizedDto.stock_by_location.length > 0))
      ) {
        throw new VendixHttpException(ErrorCodes.PROD_PERM_001);
      }

      // Consultation validation (only when explicitly setting is_consultation)
      if (sanitizedDto.is_consultation === true) {
        const effectiveProductType =
          sanitizedDto.product_type ?? existingProduct.product_type;
        if (effectiveProductType !== ProductType.SERVICE) {
          throw new BadRequestException(
            'Solo los servicios pueden ser consultas',
          );
        }
        const effectiveRequiresBooking =
          sanitizedDto.requires_booking ?? existingProduct.requires_booking;
        if (!effectiveRequiresBooking) {
          throw new BadRequestException(
            'Las consultas requieren reserva previa',
          );
        }
        const effectiveTemplateId =
          sanitizedDto.consultation_template_id ??
          existingProduct.consultation_template_id;
        if (!effectiveTemplateId) {
          throw new BadRequestException(
            'Las consultas requieren una plantilla de consulta',
          );
        }
        const effectiveSendPreconsultation =
          sanitizedDto.send_preconsultation ??
          existingProduct.send_preconsultation;
        const effectivePreconsultationTemplateId =
          sanitizedDto.preconsultation_template_id ??
          existingProduct.preconsultation_template_id;
        if (
          effectiveSendPreconsultation &&
          !effectivePreconsultationTemplateId
        ) {
          throw new BadRequestException(
            'Si se envía preconsulta, se requiere una plantilla de preconsulta',
          );
        }
      }
      if (sanitizedDto.is_consultation === false) {
        sanitizedDto.send_preconsultation = false;
        sanitizedDto.consultation_template_id = undefined;
        sanitizedDto.preconsultation_template_id = undefined;
      }

      // Subcuenta PUC — misma validación que en `create()`, con semántica
      // PATCH: sólo se juzga lo que el payload TRAE. Un producto cuyo
      // `account_code` histórico quedó inválido (cuenta borrada o desactivada
      // después) se sigue pudiendo editar en precio, nombre o stock; sólo se le
      // exige una cuenta contabilizable a quien la está escribiendo ahora.
      await this.assertAccountCodesArePostable(sanitizedDto);

      // IMPORTANTE: se destructura `sanitizedDto`, NO `updateProductDto`.
      // `sanitizeIngredientPayload()` y `enforceIngredientCapability()`
      // devuelven copias con los campos neutralizados, así que leer el DTO
      // original descartaba silenciosamente esas neutralizaciones y el
      // `prisma.products.update()` persistía los valores crudos del cliente
      // (insumo puro conservando precio y flags de venta).
      // `sanitizedDto` es siempre un superconjunto del DTO original (ambos
      // helpers hacen spread del objeto completo), luego el resto de los
      // caminos de `update()` reciben exactamente los mismos campos.
      const {
        category_ids,
        tax_category_ids,
        image_urls,
        images,
        stock_quantity,
        stock_by_location,
        variants,
        stock_transfer_mode,
        variant_removal_stock_mode,
        enabled_price_tier_ids,
        price, // Exclude as it's not in DB
        ...productData
      } = sanitizedDto as UpdateProductDto & { price?: number };
      const onlinePurchaseData = await this.buildOnlinePurchaseData(
        existingProduct.store_id,
        sanitizedDto.slug || existingProduct.slug,
      );
      const shouldRefreshOnlinePurchase =
        !!onlinePurchaseData &&
        this.shouldRefreshOnlinePurchase(existingProduct, onlinePurchaseData);

      // Derivar purchase_to_stock_factor desde el catálogo de UoM (fuente de
      // verdad de costeo). PATCH semantics: se usan los FKs efectivos (DTO con
      // fallback al producto existente) para que cambiar una sola unidad
      // recalcule el factor contra la contraparte ya persistida. Solo se toca
      // el factor cuando ambos FKs efectivos están presentes.
      const effectiveStockUomId =
        sanitizedDto.stock_uom_id ?? existingProduct.stock_uom_id;
      const effectivePurchaseUomId =
        sanitizedDto.purchase_uom_id ?? existingProduct.purchase_uom_id;
      const uomFkTouched =
        sanitizedDto.stock_uom_id !== undefined ||
        sanitizedDto.purchase_uom_id !== undefined;
      if (sanitizedDto.stock_uom_id !== undefined) {
        await this.assertStockUomEligible(sanitizedDto.stock_uom_id);
      }

      // Cambiar la unidad de stock de un producto que YA opera no es renombrar
      // una etiqueta: existencias, capas de costo, lotes y recetas están
      // escritos en la unidad vieja. Se exige el flag explícito porque una
      // conversión silenciosa multiplicaría el inventario por mil sin que
      // nadie lo pidiera.
      const stockUomChanged =
        sanitizedDto.stock_uom_id !== undefined &&
        existingProduct.stock_uom_id != null &&
        Number(sanitizedDto.stock_uom_id) !==
          Number(existingProduct.stock_uom_id);
      let pendingUomConversion: {
        from: number;
        to: number;
      } | null = null;
      if (stockUomChanged) {
        const [levels, layers, batches, recipeLines] = await Promise.all([
          this.prisma.stock_levels.count({
            where: { product_id: id, NOT: { quantity_on_hand: 0 } },
          }),
          this.prisma.inventory_cost_layers.count({
            where: { product_id: id, NOT: { quantity_remaining: 0 } },
          }),
          this.prisma.inventory_batches.count({
            where: { product_id: id, NOT: { quantity: 0 } },
          }),
          this.prisma.recipe_items.count({
            where: { component_product_id: id },
          }),
        ]);
        const hasData = levels + layers + batches + recipeLines > 0;
        if (hasData) {
          if (sanitizedDto.stock_uom_conversion !== 'convert') {
            throw new VendixHttpException(
              ErrorCodes.PROD_UOM_CONVERSION_REQUIRED,
              `El producto tiene existencias, costos, lotes o recetas expresados en su unidad actual. Envía "stock_uom_conversion": "convert" para convertirlos, o deja la unidad como está.`,
            );
          }
          pendingUomConversion = {
            from: Number(existingProduct.stock_uom_id),
            to: Number(sanitizedDto.stock_uom_id),
          };
        }
      }
      delete (sanitizedDto as any).stock_uom_conversion;
      delete (productData as any).stock_uom_conversion;
      const derivedFactor = uomFkTouched
        ? await this.derivePurchaseToStockFactor(
            effectiveStockUomId,
            effectivePurchaseUomId,
            sanitizedDto.purchase_to_stock_factor,
          )
        : undefined;

      const result = await this.prisma.$transaction(
        async (prisma) => {
          // La conversión va PRIMERO y en la misma transacción: si algo no
          // divide exacto, el producto no llega a cambiar de unidad.
          if (pendingUomConversion) {
            await this.stockLevelManager.convertStockUom({
              product_id: id,
              from_uom_id: pendingUomConversion.from,
              to_uom_id: pendingUomConversion.to,
              user_id: RequestContextService.getUserId(),
              tx: prisma,
            });
          }

          // Actualizar producto
          const product = await prisma.products.update({
            where: { id },
            data: {
              ...productData,
              // PATCH semantics: solo tocar barcode si el DTO lo trae. Cuando
              // viene, normalizar '' / whitespace-only → null para no violar
              // UNIQUE(store_id, barcode). Si NO viene, no se sobreescribe el
              // valor existente.
              ...(sanitizedDto.barcode !== undefined
                ? { barcode: sanitizedDto.barcode?.trim() || null }
                : {}),
              ...(derivedFactor !== undefined
                ? { purchase_to_stock_factor: derivedFactor }
                : {}),
              ...(shouldRefreshOnlinePurchase ? onlinePurchaseData : {}),
              updated_at: new Date(),
            } as any,
          });

          // Actualizar categorías si se proporcionan
          if (category_ids !== undefined) {
            await prisma.product_categories.deleteMany({
              where: { product_id: id },
            });

            if (category_ids.length > 0) {
              await prisma.product_categories.createMany({
                data: category_ids.map((categoryId) => ({
                  product_id: id,
                  category_id: categoryId,
                })),
              });
            }
          }

          if (enabled_price_tier_ids !== undefined) {
            await prisma.product_price_tier_assignments.deleteMany({
              where: { product_id: id },
            });

            if (enabled_price_tier_ids.length > 0) {
              await prisma.product_price_tier_assignments.createMany({
                data: enabled_price_tier_ids.map((priceTierId) => ({
                  product_id: id,
                  price_tier_id: priceTierId,
                })),
                skipDuplicates: true,
              });
            }
          }

          // Actualizar categorías de impuestos si se proporcionan
          if (tax_category_ids !== undefined) {
            await prisma.product_tax_assignments.deleteMany({
              where: { product_id: id },
            });

            if (tax_category_ids.length > 0) {
              // F4 — resolver tax_type de las categorías para bloquear IVA en
              // comercios no responsables antes de escribir las asignaciones.
              const tax_categories = await prisma.tax_categories.findMany({
                where: { id: { in: tax_category_ids } },
                select: { id: true, tax_type: true },
              });
              await this.assertProductVatAssignmentAllowed(tax_categories);

              await prisma.product_tax_assignments.createMany({
                data: tax_category_ids.map((tax_category_id) => ({
                  product_id: id,
                  tax_category_id: tax_category_id,
                })),
              });
            }
          }

          // Actualizar imágenes si se proporcionan
          if (image_urls !== undefined || images !== undefined) {
            // Las imágenes de variantes se gestionan en su propio bucle
            // (líneas ~1899-2011) y NO deben ser tocadas aquí. Solo
            // recolectamos / borramos imágenes de producto que NO estén
            // referenciadas por ninguna variante; la FK Restrict en
            // product_variants.image_id ya garantiza que las imágenes en
            // uso quedan protegidas.
            const unreferencedProductImagesWhere = {
              product_id: id,
              NOT: {
                product_variants: {
                  some: {},
                },
              },
            } as const;

            // 0. Recolectar URLs viejas (de imágenes no referenciadas) para
            //    limpiar S3 después.
            const oldImages = await prisma.product_images.findMany({
              where: unreferencedProductImagesWhere,
              select: { image_url: true },
            });
            const oldS3Keys = oldImages
              .map((img) => img.image_url)
              .filter(Boolean);

            // 1. Borrar SOLO las product_images no referenciadas por
            //    variantes.
            await prisma.product_images.deleteMany({
              where: unreferencedProductImagesWhere,
            });

            const finalImages: any[] = [];

            let imageContext:
              | { org: S3OrgContext; store: S3StoreContext }
              | undefined;

            // 2. Procesar image_urls (legacy)
            if (image_urls && image_urls.length > 0) {
              imageContext ??= await this.getStoreWithOrgContext(
                existingProduct.store_id,
              );
              const uploadedImages = await this.handleImageUploads(
                image_urls.map((url, index) => ({
                  image_url: url,
                  is_main: index === 0,
                })),
                product.slug,
                imageContext.org,
                imageContext.store,
              );
              finalImages.push(
                ...uploadedImages.map((img) => ({
                  ...img,
                  product_id: id,
                })),
              );
            }

            // 3. Procesar images (structured with possible base64)
            if (images && images.length > 0) {
              imageContext ??= await this.getStoreWithOrgContext(
                existingProduct.store_id,
              );
              const uploadedImages = await this.handleImageUploads(
                images,
                product.slug,
                imageContext.org,
                imageContext.store,
              );
              finalImages.push(
                ...uploadedImages.map((img) => ({
                  ...img,
                  product_id: id,
                })),
              );
            }

            if (finalImages.length > 0) {
              // Asegurar que solo haya un is_main
              const mainExists = finalImages.some((img) => img.is_main);
              if (!mainExists) finalImages[0].is_main = true;

              await prisma.product_images.createMany({
                data: finalImages,
              });
            }

            // 4. Determinar qué keys de S3 ya no se usan y eliminarlas
            const newS3Keys = new Set(finalImages.map((img) => img.image_url));
            const keysToDelete = oldS3Keys.filter((key) => !newS3Keys.has(key));

            // Eliminar de S3 fuera del camino crítico (no bloquea la transacción)
            if (keysToDelete.length > 0) {
              Promise.allSettled(
                keysToDelete.flatMap((key) => {
                  const parts = key.split('/');
                  const fileName = parts.pop();
                  const thumbKey = [...parts, `thumb_${fileName}`].join('/');
                  return [
                    this.s3Service.deleteFile(key),
                    this.s3Service.deleteFile(thumbKey).catch(() => {}),
                  ];
                }),
              ).catch(() => {});
            }
          }

          // Sincronizar variantes si se proporcionan
          if (variants !== undefined) {
            // Recolectar IDs de variantes existentes en DB ANTES del upsert
            const allExistingVariants = await prisma.product_variants.findMany({
              where: { product_id: id },
              include: { product_images: { select: { image_url: true } } },
            });
            const existingVariantMap = new Map<
              number,
              (typeof allExistingVariants)[number]
            >(allExistingVariants.map((v) => [v.id, v]));

            // Detect simple → variant transition
            const isTransitionToVariants =
              allExistingVariants.length === 0 && variants.length > 0;

            // BLOCK: Actually CHANGING track_inventory value (not just echoing it) when
            // variants exist requires explicit stock_transfer_mode. Comparing against
            // existingProduct avoids false positives when the frontend always sends the
            // current value in the payload.
            if (
              sanitizedDto.track_inventory !== undefined &&
              sanitizedDto.track_inventory !==
                existingProduct.track_inventory &&
              allExistingVariants.length > 0
            ) {
              if (!sanitizedDto.stock_transfer_mode) {
                throw new VendixHttpException(
                  ErrorCodes.PROD_VALIDATE_001,
                  'Changing track_inventory with existing variants requires explicit stock_transfer_mode',
                );
              }
            }

            // If transitioning, transfer/distribute base stock to variants
            let inheritedLocationIds: number[] = [];
            if (isTransitionToVariants) {
              const tempVariantIds: number[] = [];
              for (const variantData of variants) {
                const {
                  variant_image_url,
                  id: variantDbId,
                  ...variantFields
                } = variantData as CreateVariantWithStockDto & { id?: number };

                let existingVariant = variantDbId
                  ? await prisma.product_variants.findFirst({
                      where: { id: variantDbId, product_id: id },
                    })
                  : null;

                if (!existingVariant) {
                  existingVariant = await prisma.product_variants.findFirst({
                    where: { product_id: id, sku: variantData.sku },
                  });
                }

                if (existingVariant) {
                  tempVariantIds.push(existingVariant.id);
                }
              }

              // BLOCK: Transitioning simple→variants with existing base stock requires
              // explicit stock_transfer_mode. 'reset' is forbidden (would wipe stock);
              // only 'first' or 'distribute' actually transfer the base stock to variants.
              const baseStockSum = await prisma.stock_levels.aggregate({
                where: { product_id: id, product_variant_id: null },
                _sum: { quantity_on_hand: true },
              });
              const baseStockTotal = baseStockSum._sum.quantity_on_hand ?? 0;
              if (baseStockTotal > 0) {
                if (!sanitizedDto.stock_transfer_mode) {
                  throw new VendixHttpException(
                    ErrorCodes.PROD_VALIDATE_001,
                    'El producto tiene stock base. Elige cómo distribuirlo entre las variantes (first | distribute).',
                  );
                }
                if (sanitizedDto.stock_transfer_mode === 'reset') {
                  throw new VendixHttpException(
                    ErrorCodes.PROD_VALIDATE_001,
                    "No puedes descartar stock al activar variantes. Usa 'first' o 'distribute' para transferirlo.",
                  );
                }
              }

              const transferMode =
                sanitizedDto.stock_transfer_mode || 'reset';
              inheritedLocationIds =
                await this.stockLevelManager.transferBaseStockToVariants(
                  id,
                  tempVariantIds.length > 0 ? tempVariantIds : [0],
                  user_id!,
                  transferMode,
                  prisma,
                );

              if (
                inheritedLocationIds.length > 0 &&
                tempVariantIds.length > 0
              ) {
                for (const vId of tempVariantIds) {
                  await this.stockLevelManager.initializeVariantStockAtLocations(
                    id,
                    vId,
                    inheritedLocationIds,
                    prisma,
                  );
                }
              }
            }

            // IDs de variantes que se mantienen (enviadas desde el frontend)
            const keptVariantIds = new Set<number>();

            for (const variantData of variants) {
              const {
                variant_image_url,
                id: variantDbId,
                ...variantFields
              } = variantData as CreateVariantWithStockDto & { id?: number };

              // Buscar variante existente: primero por ID, luego por SKU como fallback
              let existingVariant = variantDbId
                ? await prisma.product_variants.findFirst({
                    where: { id: variantDbId, product_id: id },
                  })
                : null;

              if (!existingVariant) {
                existingVariant = await prisma.product_variants.findFirst({
                  where: { product_id: id, sku: variantData.sku },
                });
              }

              let variantId: number;

              if (existingVariant) {
                // Actualizar variante existente
                await this.productVariantService.updateVariant(
                  existingVariant.id,
                  variantFields,
                  prisma,
                );
                variantId = existingVariant.id;
              } else {
                // Crear nueva variante
                const createdVariant =
                  await this.productVariantService.createVariant(
                    id,
                    {
                      ...variantFields,
                      stock_quantity: variantFields.stock_quantity || 0,
                    },
                    prisma,
                  );
                variantId = createdVariant.id;

                // If transitioning, inherit locations from base stock
                if (isTransitionToVariants && inheritedLocationIds.length > 0) {
                  await this.stockLevelManager.initializeVariantStockAtLocations(
                    id,
                    variantId,
                    inheritedLocationIds,
                    prisma,
                  );
                }
              }

              keptVariantIds.add(variantId);

              const previousVariantState = existingVariantMap.get(variantId);
              const previousImageId = previousVariantState?.image_id ?? null;
              const previousImageKey =
                previousVariantState?.product_images?.image_url ?? null;

              const deletePreviousVariantImage = async () => {
                if (!previousImageId) return;
                await prisma.product_variants.update({
                  where: { id: variantId },
                  data: { image_id: null },
                });
                await prisma.product_images
                  .delete({ where: { id: previousImageId } })
                  .catch(() => {});
                if (previousImageKey) {
                  const parts = previousImageKey.split('/');
                  const fileName = parts.pop();
                  const thumbKey = [...parts, `thumb_${fileName}`].join('/');
                  this.s3Service.deleteFile(previousImageKey).catch(() => {});
                  this.s3Service.deleteFile(thumbKey).catch(() => {});
                }
              };

              // Process variant image: null = clear, data:image = replace, otherwise preserve
              if (variant_image_url === null) {
                await deletePreviousVariantImage();
              } else if (
                typeof variant_image_url === 'string' &&
                variant_image_url.startsWith('data:image')
              ) {
                await deletePreviousVariantImage();
                const { org, store: storeCtx } =
                  await this.getStoreWithOrgContext(existingProduct.store_id);
                const basePath = this.s3PathHelper.buildProductPath(
                  org,
                  storeCtx,
                );
                const uploadResult = await this.s3Service.uploadBase64(
                  variant_image_url,
                  `${basePath}/${product.slug}-variant-${variantId}-${Date.now()}`,
                  undefined,
                  { generateThumbnail: true, context: ImageContext.PRODUCT },
                );
                const variantImage = await prisma.product_images.create({
                  data: {
                    product_id: id,
                    image_url: uploadResult.key,
                    is_main: false,
                  },
                });
                await prisma.product_variants.update({
                  where: { id: variantId },
                  data: { image_id: variantImage.id },
                });
              }
              // else: undefined or other string -> preserve existing image_id
            }

            // Before deleting variants: check for active reservations and stock
            const variantsToDelete = allExistingVariants.filter(
              (ev) => !keptVariantIds.has(ev.id),
            );
            if (variantsToDelete.length > 0 && allExistingVariants.length > 0) {
              // BLOCK: Deleting variants with stock requires explicit variant_removal_stock_mode
              for (const vt of variantsToDelete) {
                const variantStock = await prisma.stock_levels.aggregate({
                  where: { product_variant_id: vt.id },
                  _sum: { quantity_on_hand: true },
                });
                const hasStock = (variantStock._sum.quantity_on_hand ?? 0) > 0;

                // Check for active reservations
                const hasActiveReservations =
                  await prisma.stock_reservations.findFirst({
                    where: {
                      product_variant_id: vt.id,
                      status: 'active',
                    },
                  });

                if (
                  (hasStock || hasActiveReservations) &&
                  !sanitizedDto.variant_removal_stock_mode
                ) {
                  throw new VendixHttpException(
                    ErrorCodes.PROD_VALIDATE_001,
                    'Deleting variants with stock or active reservations requires explicit variant_removal_stock_mode',
                  );
                }
              }

              const allVariantsDeleting =
                variantsToDelete.length === allExistingVariants.length;
              if (allVariantsDeleting) {
                const allVariantIds = allExistingVariants.map((v) => v.id);
                await this.stockLevelManager.transferVariantStockToBase(
                  id,
                  allVariantIds,
                  user_id!,
                  prisma,
                );
              }
            }

            // Eliminar variantes que NO están en la lista enviada (por ID)
            for (const ev of allExistingVariants) {
              if (!keptVariantIds.has(ev.id)) {
                // Limpiar FK Restrict antes de borrar
                await prisma.order_items.updateMany({
                  where: { product_variant_id: ev.id },
                  data: { product_variant_id: null },
                });
                await prisma.invoice_items.updateMany({
                  where: { product_variant_id: ev.id },
                  data: { product_variant_id: null },
                });
                await prisma.quotation_items.updateMany({
                  where: { product_variant_id: ev.id },
                  data: { product_variant_id: null },
                });
                await prisma.layaway_items.updateMany({
                  where: { product_variant_id: ev.id },
                  data: { product_variant_id: null },
                });
                await prisma.dispatch_note_items.updateMany({
                  where: { product_variant_id: ev.id },
                  data: { product_variant_id: null },
                });
                await prisma.inventory_adjustments.updateMany({
                  where: { product_variant_id: ev.id },
                  data: { product_variant_id: null },
                });
                await prisma.inventory_transactions.updateMany({
                  where: { product_variant_id: ev.id },
                  data: { product_variant_id: null },
                });
                await prisma.stock_levels.deleteMany({
                  where: { product_variant_id: ev.id },
                });

                // Limpiar imagen de variante de S3
                if (ev.image_id && ev.product_images?.image_url) {
                  const key = ev.product_images.image_url;
                  const parts = key.split('/');
                  const fileName = parts.pop();
                  const thumbKey = [...parts, `thumb_${fileName}`].join('/');
                  this.s3Service.deleteFile(key).catch(() => {});
                  this.s3Service.deleteFile(thumbKey).catch(() => {});

                  // Limpiar image_id para poder borrar product_images
                  await prisma.product_variants.update({
                    where: { id: ev.id },
                    data: { image_id: null },
                  });
                  await prisma.product_images
                    .delete({
                      where: { id: ev.image_id },
                    })
                    .catch(() => {});
                }

                await prisma.product_variants.delete({
                  where: { id: ev.id },
                });
              }
            }

            // Enforce stock_levels mode: eliminar filas base huérfanas si hay variantes.
            // Invariante: producto con variantes no mantiene filas (product_variant_id IS NULL).
            await this.stockLevelManager.enforceStockLevelsMode(prisma, id);
          }

          // Guard: skip base stock updates when product has variants
          const currentVariantCount = await prisma.product_variants.count({
            where: { product_id: id },
          });

          if (currentVariantCount === 0) {
            // Actualizar stock levels para múltiples ubicaciones
            if (
              stock_by_location !== undefined &&
              stock_by_location.length > 0
            ) {
              // Actualizar stock en las ubicaciones especificadas
              for (const stockLocation of stock_by_location) {
                // Obtener stock actual en esta ubicación
                const currentStockLevel = await prisma.stock_levels.findUnique({
                  where: {
                    product_id_location_id_product_variant_id: {
                      product_id: id,
                      location_id: stockLocation.location_id,
                      product_variant_id: null,
                    },
                  },
                });

                const currentQuantity =
                  currentStockLevel?.quantity_available || 0;
                const quantityChange = stockLocation.quantity - currentQuantity;

                if (quantityChange !== 0) {
                  await this.stockLevelManager.updateStock(
                    {
                      product_id: id,
                      location_id: stockLocation.location_id,
                      quantity_change: quantityChange,
                      movement_type: 'adjustment',
                      reason: `Stock adjusted from product edit${stockLocation.notes ? ': ' + stockLocation.notes : ''}`,
                      user_id: user_id!, // Non-null assertion safe because we checked above
                      create_movement: true,
                      validate_availability: false,
                    },
                    prisma,
                  );
                }
              }
            } else if (stock_quantity !== undefined) {
              // Mantener compatibilidad con el campo stock_quantity (usa ubicación default)
              const stockDifference =
                stock_quantity - existingProduct.stock_quantity;

              if (stockDifference !== 0) {
                const defaultLocation =
                  await this.inventoryLocationsService.getDefaultLocation(
                    product.store_id,
                  );

                await this.stockLevelManager.updateStock(
                  {
                    product_id: id,
                    location_id: defaultLocation.id,
                    quantity_change: stockDifference,
                    movement_type: 'adjustment',
                    reason: 'Stock quantity updated from product edit (legacy)',
                    user_id: user_id!, // Non-null assertion safe because we checked above
                    create_movement: true,
                    validate_availability: false,
                  },
                  prisma,
                );
              }
            }
          }

          return product;
        },
        { timeout: 30000 },
      );

      // Retorno ligero: el consumidor en lote solo reporta identidad, así que
      // se sirve desde la fila ya devuelta por la transacción sin una lectura
      // extra.
      if (options?.lean) {
        return { id: result.id, name: result.name, sku: result.sku };
      }

      return await this.findOne(result.id);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === 'P2002') {
          throw new VendixHttpException(ErrorCodes.PROD_DUP_001);
        }
        if (error.code === 'P2003') {
          throw new VendixHttpException(ErrorCodes.PROD_VALIDATE_001);
        }
      }
      throw error;
    }
  }

  // Borrado lógico para roles normales
  async deactivate(id: number) {
    const existingProduct = await this.prisma.products.findFirst({
      where: {
        id,
        state: { not: ProductState.ARCHIVED },
      },
    });

    if (!existingProduct) {
      throw new VendixHttpException(ErrorCodes.PROD_FIND_001);
    }

    return await this.prisma.products.update({
      where: { id },
      data: {
        state: ProductState.INACTIVE,
        updated_at: new Date(),
      },
    });
  }

  // ===========================================================================
  // Archivado (CP-PURCHASE-TRANSPARENCY D.4 / D.8)
  // ===========================================================================

  /**
   * Fila mínima del producto para decidir un archivado. `findOne()` firma URLs
   * de S3 y carga media docena de relaciones: para esto sobra, y el archivado
   * masivo lo llamaba una vez por producto.
   *
   * MISMO predicado que `findOne()` (`state != archived` + alcance de tienda),
   * así que un id inexistente y uno ya archivado siguen siendo el mismo
   * `PROD_FIND_001` de siempre.
   */
  private async loadProductForArchive(id: number) {
    const context = RequestContextService.getContext();

    const product = await this.prisma.products.findFirst({
      where: {
        id,
        state: { not: ProductState.ARCHIVED },
        ...(!context?.is_super_admin && { store_id: context?.store_id }),
      },
      select: {
        id: true,
        name: true,
        sku: true,
        state: true,
        store_id: true,
        cost_price: true,
        stock_quantity: true,
        track_inventory: true,
      },
    });

    if (!product) {
      throw new VendixHttpException(ErrorCodes.PROD_FIND_001);
    }

    return product;
  }

  /**
   * Reservas activas del producto, variantes INCLUIDAS.
   *
   * Superconjunto deliberado del predicado de `update()` (que sí filtra
   * `product_variant_id: null`): archivar retira el producto ENTERO del
   * catálogo, así que una reserva sobre una variante quedaría apuntando a un
   * producto archivado. Es el mismo criterio que ya usa el preview masivo.
   *
   * D.7 — el rechazo es `PROD_HAS_RESERVATIONS_001` (409) en las tres puertas.
   */
  private async assertNoActiveReservationsForArchive(
    productId: number,
  ): Promise<void> {
    const reservation = await this.prisma.stock_reservations.findFirst({
      where: { product_id: productId, status: 'active' },
      select: { id: true },
    });

    if (reservation) {
      throw new VendixHttpException(
        ErrorCodes.PROD_HAS_RESERVATIONS_001,
        'El producto tiene reservas de stock activas. Libera las reservas antes de archivarlo.',
      );
    }
  }

  /**
   * Calcula, SIN ESCRIBIR NADA, qué va a destruir el archivado.
   *
   * Dos lecturas, y las dos importan:
   *
   * 1. `this.prisma.stock_levels` — cliente CON alcance de tienda. Define el
   *    universo que el castigo PUEDE tocar, porque es exactamente el mismo
   *    cliente con el que la transacción va a escribir: `stock_levels` está
   *    scopeado por `inventory_locations.store_id`
   *    (`store-prisma.service.ts:419`).
   * 2. `this.globalPrisma.stock_levels` — cliente SIN alcance, con el filtro de
   *    organización escrito a mano (patrón DB-22). Sirve para UNA cosa: saber
   *    si quedan existencias del producto FUERA de ese universo. Hoy eso
   *    significa la bodega central de la organización
   *    (`inventory_locations.store_id IS NULL`), que en desarrollo tiene 40
   *    filas y 1.386 unidades. No se destruyen: se reportan y bloquean.
   *
   * El costo unitario sale de la CADENA CANÓNICA, la misma que
   * `CostingService.consumeCostLayers` usa bajo promedio ponderado, para que la
   * cifra que se le enseña al operador sea la que el ajuste va a costear.
   */
  async buildArchiveWriteOffPlan(product: {
    id: number;
    store_id: number | null;
    cost_price: any;
  }): Promise<ArchiveWriteOffPlan> {
    const plans = await this.buildArchiveWriteOffPlans([product]);
    return plans.get(product.id) ?? this.emptyArchiveWriteOffPlan(product.id);
  }

  /**
   * La misma cuenta para N productos, en DOS consultas en total en vez de dos
   * por producto. Lo usa el preview del archivado masivo, que puede llegar con
   * 100 identificadores.
   */
  async buildArchiveWriteOffPlans(
    products: Array<{ id: number; store_id: number | null; cost_price: any }>,
  ): Promise<Map<number, ArchiveWriteOffPlan>> {
    const plans = new Map<number, ArchiveWriteOffPlan>();
    if (products.length === 0) return plans;

    const ids = products.map((product) => product.id);
    const organizationId = RequestContextService.getOrganizationId();

    const inScopeRows = await this.prisma.stock_levels.findMany({
      where: { product_id: { in: ids }, quantity_on_hand: { gt: 0 } },
      select: {
        product_id: true,
        location_id: true,
        product_variant_id: true,
        quantity_on_hand: true,
        cost_per_unit: true,
        inventory_locations: {
          select: { id: true, name: true, store_id: true },
        },
        product_variants: { select: { sku: true, cost_price: true } },
      },
    });

    const allOrgRows = organizationId
      ? await this.globalPrisma.stock_levels.findMany({
          where: {
            product_id: { in: ids },
            quantity_on_hand: { gt: 0 },
            // El aislamiento entre organizaciones lo da ESTE filtro, no el
            // cliente: `globalPrisma` no scopea nada.
            inventory_locations: { organization_id: organizationId },
          },
          select: {
            product_id: true,
            location_id: true,
            quantity_on_hand: true,
            inventory_locations: {
              select: { id: true, name: true, store_id: true },
            },
          },
        })
      : [];

    for (const product of products) {
      const productCost = Number(product.cost_price) || 0;

      const lines: ArchiveWriteOffLine[] = inScopeRows
        .filter((row) => row.product_id === product.id)
        .map((row) => {
          // Cadena canónica: `||` y no `??` A PROPÓSITO, para que un 0 espurio
          // caiga al siguiente eslabón en vez de fijar el costo en cero.
          const unitCost =
            Number(row.cost_per_unit) ||
            Number(row.product_variants?.cost_price) ||
            productCost ||
            0;
          const quantity = Number(row.quantity_on_hand) || 0;
          return {
            location_id: row.location_id,
            location_name:
              row.inventory_locations?.name ?? `#${row.location_id}`,
            product_variant_id: row.product_variant_id ?? null,
            variant_sku: row.product_variants?.sku ?? null,
            quantity_on_hand: quantity,
            unit_cost: unitCost,
            value: quantity * unitCost,
            has_known_cost: unitCost > 0,
          };
        });

      const inScopeLocationIds = new Set(lines.map((line) => line.location_id));
      const outOfScopeByLocation = new Map<number, ArchiveOutOfScopeStock>();

      for (const row of allOrgRows) {
        if (row.product_id !== product.id) continue;
        if (inScopeLocationIds.has(row.location_id)) continue;
        const quantity = Number(row.quantity_on_hand) || 0;
        const existing = outOfScopeByLocation.get(row.location_id);
        if (existing) {
          existing.quantity_on_hand += quantity;
          continue;
        }
        outOfScopeByLocation.set(row.location_id, {
          location_id: row.location_id,
          location_name: row.inventory_locations?.name ?? `#${row.location_id}`,
          store_id: row.inventory_locations?.store_id ?? null,
          quantity_on_hand: quantity,
        });
      }

      const outOfScope = [...outOfScopeByLocation.values()];
      const totalUnits = lines.reduce(
        (sum, line) => sum + line.quantity_on_hand,
        0,
      );

      plans.set(product.id, {
        product_id: product.id,
        requires_confirmation: totalUnits > 0,
        total_units: totalUnits,
        total_value: lines.reduce((sum, line) => sum + line.value, 0),
        zero_cost_units: lines.reduce(
          (sum, line) => sum + (line.has_known_cost ? 0 : line.quantity_on_hand),
          0,
        ),
        lines,
        out_of_scope_units: outOfScope.reduce(
          (sum, line) => sum + line.quantity_on_hand,
          0,
        ),
        out_of_scope: outOfScope,
      });
    }

    return plans;
  }

  /**
   * Planes de castigo por identificador, cargando los productos por su cuenta.
   * Entrada del preview del archivado masivo: los ids inexistentes o ya
   * archivados simplemente no aparecen en el mapa.
   */
  async getArchiveWriteOffPlansByIds(
    ids: number[],
  ): Promise<Map<number, ArchiveWriteOffPlan>> {
    if (ids.length === 0) return new Map();

    const products = await this.prisma.products.findMany({
      where: { id: { in: ids }, state: { not: ProductState.ARCHIVED } },
      select: { id: true, store_id: true, cost_price: true },
    });

    return this.buildArchiveWriteOffPlans(products);
  }

  private emptyArchiveWriteOffPlan(productId: number): ArchiveWriteOffPlan {
    return {
      product_id: productId,
      requires_confirmation: false,
      total_units: 0,
      total_value: 0,
      zero_cost_units: 0,
      lines: [],
      out_of_scope_units: 0,
      out_of_scope: [],
    };
  }

  /**
   * Vista previa pública del castigo (D.9). Estrictamente de solo lectura.
   */
  async previewArchiveWriteOff(id: number): Promise<ArchiveWriteOffPlan> {
    const product = await this.loadProductForArchive(id);
    return this.buildArchiveWriteOffPlan(product);
  }

  /**
   * Eliminación lógica: archiva el producto.
   *
   * QUÉ CAMBIÓ, Y POR QUÉ
   * ---------------------
   * Antes esto escribía `state='archived'` y nada más: ni tocaba el stock, ni
   * emitía evento, ni dejaba auditoría. Las existencias quedaban colgando
   * invisibles y seguían entrando en el promedio ponderado, así que volver a
   * comprar un producto «borrado» lo costeaba contra inventario fantasma (el
   * defecto que abrió este plan; ver D.2 en `costing.service.ts`).
   *
   * Ahora, con existencias:
   *   1. las reservas activas BLOQUEAN (`PROD_HAS_RESERVATIONS_001`, 409):
   *      no se destruye existencia comprometida con un pedido;
   *   2. las existencias fuera del alcance de la tienda BLOQUEAN
   *      (`PROD_VARIANT_HAS_STOCK_001`, 409): no se destruye inventario de la
   *      organización desde la pantalla de una tienda;
   *   3. sin confirmación explícita se RECHAZA (`PROD_VARIANT_HAS_STOCK_001`,
   *      409) devolviendo el plan completo en `details`, para que la interfaz
   *      pueda enseñar qué se va a destruir y ofrecer el botón;
   *   4. con confirmación, TODO ocurre en UNA transacción: un ajuste de tipo
   *      `loss` con `quantity_after = 0` por cada tripleta con existencias, el
   *      cambio de estado DESPUÉS de las bajas, y la fila de auditoría. Si la
   *      auditoría falla, la transacción entera revierte: sin rastro, el
   *      castigo no debe ocurrir.
   *
   * El evento contable se emite DESPUÉS del commit, nunca dentro: anunciar un
   * hecho que todavía puede revertirse es peor que no anunciarlo.
   */
  async remove(id: number, options: RemoveProductOptions = {}) {
    try {
      const product = await this.loadProductForArchive(id);

      await this.assertNoActiveReservationsForArchive(id);

      const plan = await this.buildArchiveWriteOffPlan(product);

      if (plan.out_of_scope_units > 0) {
        throw new VendixHttpException(
          ErrorCodes.PROD_VARIANT_HAS_STOCK_001,
          `El producto tiene ${plan.out_of_scope_units} unidades en ubicaciones fuera de esta tienda ` +
            `(${plan.out_of_scope.map((l) => l.location_name).join(', ')}). ` +
            'Transfiérelas o ajústalas desde Inventario antes de archivarlo.',
          { archive_write_off: plan } as any,
        );
      }

      if (plan.requires_confirmation && options.confirm_stock_write_off !== true) {
        throw new VendixHttpException(
          ErrorCodes.PROD_VARIANT_HAS_STOCK_001,
          `Archivar este producto dará de baja ${plan.total_units} unidades por un valor de ${plan.total_value}. ` +
            'Confirma la operación para continuar.',
          { archive_write_off: plan } as any,
        );
      }

      const actorUserId = RequestContextService.getUserId() ?? null;
      const organizationId = RequestContextService.getOrganizationId() ?? null;

      const { archived, adjustments } = await this.prisma.$transaction(
        async (tx) => {
          const results: AdjustmentTransactionResult[] = [];

          // Las bajas van ANTES del cambio de estado (DB-16): el costeo de la
          // baja lee el producto vivo, y ningún producto queda archivado con
          // existencias ni por un instante dentro de la transacción.
          for (const line of plan.lines) {
            const result =
              await this.inventoryAdjustments.createAdjustmentInTransaction(
                tx,
                {
                  product_id: id,
                  product_variant_id: line.product_variant_id ?? undefined,
                  location_id: line.location_id,
                  type: 'loss',
                  quantity_after: 0,
                  reason_code: 'product_archived',
                  description: `Baja de inventario por archivado del producto #${id} (${product.name})`,
                },
                { approvedByUserId: actorUserId ?? undefined },
              );
            results.push(result);
          }

          const updated = await tx.products.update({
            where: { id },
            data: { state: 'archived', updated_at: new Date() },
          });

          await this.writeArchiveAuditRow(tx, {
            product,
            plan,
            adjustments: results,
            userId: actorUserId,
            organizationId,
            options,
          });

          return { archived: updated, adjustments: results };
        },
        // El castigo puede recorrer varias ubicaciones y variantes, y cada
        // ajuste arrastra movimiento, espejo denormalizado y snapshot de
        // valoración. Los 5 s por defecto de Prisma no alcanzan.
        { timeout: 120_000, maxWait: 15_000 },
      );

      for (const result of adjustments) {
        this.inventoryAdjustments.emitInventoryAdjusted(
          result,
          organizationId ?? 0,
          actorUserId,
        );
      }

      return archived;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === 'P2025') {
          throw new VendixHttpException(ErrorCodes.PROD_FIND_001);
        }
      }
      throw error;
    }
  }

  /**
   * D.8 — la fila de auditoría del archivado, escrita DENTRO de la transacción.
   *
   * POR QUÉ NO `AuditService.log()`
   * -------------------------------
   * Porque hace justo lo contrario de lo que hace falta aquí: escribe por
   * `GlobalPrismaService` (otra conexión, así que no viaja en esta transacción)
   * y envuelve todo en un `try/catch` que traga el error con un `console.error`.
   * Con eso, un fallo de bitácora dejaría el castigo consumado y mudo.
   *
   * POR QUÉ NO EL INTERCEPTOR GLOBAL
   * --------------------------------
   * Porque no sirve para esto y está medido: descarta el query string donde
   * viajaría la confirmación, escribe `oldValues:{}` sin `metadata` en los
   * borrados, y en el archivado masivo no escribe NADA (17 productos
   * archivados en un lote → cero filas en `audit_logs`).
   *
   * AQUÍ NO HAY `try/catch`, Y ES DELIBERADO: si esta escritura falla, la
   * transacción entera revierte y el archivado no ocurre.
   */
  private async writeArchiveAuditRow(
    tx: any,
    payload: {
      product: {
        id: number;
        name: string;
        sku: string | null;
        state: string;
        store_id: number | null;
        stock_quantity: number | null;
      };
      plan: ArchiveWriteOffPlan;
      adjustments: AdjustmentTransactionResult[];
      userId: number | null;
      organizationId: number | null;
      options: RemoveProductOptions;
    },
  ): Promise<void> {
    const { product, plan, adjustments, userId, organizationId, options } =
      payload;

    if (product.store_id == null) {
      // `store_id` no nulo es parte del contrato de la fila: sin él la
      // auditoría no se puede leer por tienda.
      throw new VendixHttpException(
        ErrorCodes.PROD_VALIDATE_001,
        `El producto ${product.id} no tiene tienda asociada; no se puede auditar su archivado.`,
      );
    }

    const postedCostAmount = adjustments.reduce(
      (sum, entry) => sum + Math.abs(Number(entry.cost_amount) || 0),
      0,
    );

    await tx.audit_logs.create({
      data: {
        user_id: userId,
        store_id: product.store_id,
        organization_id: organizationId,
        action: 'PRODUCT_ARCHIVE',
        resource: 'products',
        resource_id: product.id,
        request_id: RequestContextService.getRequestId() ?? null,
        old_values: {
          state: product.state,
          stock_quantity: product.stock_quantity,
        },
        new_values: { state: 'archived' },
        metadata: {
          source: options.batch_id ? 'bulk' : 'individual',
          batch_id: options.batch_id ?? null,
          // A QUÉ CIFRA DIJO QUE SÍ EL OPERADOR. Es el punto de la fila: la
          // cifra que se le enseñó en pantalla no puede desaparecer al
          // confirmarla.
          confirmation: {
            confirmed: options.confirm_stock_write_off === true,
            required: plan.requires_confirmation,
            approved_units: plan.total_units,
            approved_value: plan.total_value,
          },
          write_off: {
            total_units: plan.total_units,
            total_value: plan.total_value,
            // Unidades destruidas sin costo conocido. NO producen asiento:
            // `InventoryAdjustmentsService.emitInventoryAdjusted` sólo emite
            // con `cost_amount > 0`, y un asiento por valor cero no es un
            // asiento. Queda escrito aquí para que la ausencia del asiento sea
            // un hecho documentado y no un silencio.
            zero_cost_units: plan.zero_cost_units,
            locations: plan.lines.length,
            lines: plan.lines,
          },
          adjustments: {
            ids: adjustments.map((entry) => entry.adjustment?.id),
            // Lo que los ajustes costearon DE VERDAD. Bajo promedio ponderado
            // coincide con `write_off.total_value`; bajo FIFO sale de las capas
            // y puede diferir. Guardar los dos permite ver la divergencia sin
            // recalcular nada.
            posted_cost_amount: postedCostAmount,
            /**
             * Los identificadores de asiento NO se pueden guardar aquí: el
             * asiento lo escribe el listener contable al recibir
             * `inventory.adjusted`, que se emite DESPUÉS del commit. Lo que sí
             * queda es cuántas líneas deberían haberlo producido, para poder
             * cruzarlo contra `journal_entries` por `adjustment_id`.
             */
            accounting_entries_expected: adjustments.filter(
              (entry) => Math.abs(Number(entry.cost_amount) || 0) > 0,
            ).length,
          },
        },
      },
    });
  }

  // Obtener productos por tienda (solo activos)
  async getProductsByStore(storeId: number) {
    const products = await this.prisma.products.findMany({
      where: {
        store_id: storeId,
        state: ProductState.ACTIVE,
      },
      include: {
        brands: true,
        product_images: {
          where: { is_main: true },
          take: 1,
        },
        stock_levels: {
          select: {
            quantity_available: true,
            quantity_reserved: true,
            inventory_locations: {
              select: {
                id: true,
                name: true,
                type: true,
              },
            },
          },
        },
        _count: {
          select: {
            product_variants: true,
            reviews: true,
          },
        },
      },
      orderBy: { created_at: 'desc' },
    });

    // Calcular stock totals y firmar imágenes
    const result = await Promise.all(
      products.map(async (product) => {
        const totalStockAvailable = product.stock_levels.reduce(
          (sum, stock) => sum + stock.quantity_available,
          0,
        );
        const totalStockReserved = product.stock_levels.reduce(
          (sum, stock) => sum + stock.quantity_reserved,
          0,
        );

        return {
          ...product,
          pricing_type: String(product.pricing_type),
          image_url: await this.signProductImage(product, true),
          // Mantener compatibilidad con el campo existente pero basado en stock_levels
          stock_quantity: totalStockAvailable,
          // Nuevos campos agregados para mayor claridad
          total_stock_available: totalStockAvailable,
          total_stock_reserved: totalStockReserved,
          stock_by_location: product.stock_levels.map((stock) => ({
            location_id: stock.inventory_locations.id,
            location_name: stock.inventory_locations.name,
            location_type: stock.inventory_locations.type,
            available: stock.quantity_available,
            reserved: stock.quantity_reserved,
          })),
        };
      }),
    );

    // QUI-727 (A.1) / ADR-10 — `cocina` no ve dinero: recorta los escalares de
    // precio/costo/margen de cada producto antes de devolver el listado.
    return this.isKitchenRole()
      ? result.map((p) => this.stripCocinaMoney(p))
      : result;
  }

  // Gestión de variantes

  // Gestión de imágenes
  async addImage(productId: number, imageDto: ProductImageDto) {
    // Verificar que el producto existe y está activo
    const product = await this.prisma.products.findFirst({
      where: {
        id: productId,
        state: ProductState.ACTIVE,
      },
    });

    if (!product) {
      throw new VendixHttpException(ErrorCodes.PROD_FIND_001);
    }

    // Si es imagen principal, quitar el flag de las demás
    if (imageDto.is_main) {
      await this.prisma.product_images.updateMany({
        where: { product_id: productId },
        data: { is_main: false },
      });
    }

    return await this.prisma.product_images.create({
      data: {
        product_id: productId,
        ...imageDto,
      },
    });
  }

  async removeImage(imageId: number) {
    const existingImage = await this.prisma.product_images.findUnique({
      where: { id: imageId },
    });

    if (!existingImage) {
      throw new VendixHttpException(ErrorCodes.PROD_FIND_001);
    }

    // Limpiar referencia en variantes que usen esta imagen
    await this.prisma.product_variants.updateMany({
      where: { image_id: imageId },
      data: { image_id: null },
    });

    // Eliminar de S3 (archivo + thumbnail)
    if (existingImage.image_url) {
      try {
        await this.s3Service.deleteFile(existingImage.image_url);
        // Intentar eliminar thumbnail (formato: thumb_{fileName})
        const parts = existingImage.image_url.split('/');
        const fileName = parts.pop();
        const thumbKey = [...parts, `thumb_${fileName}`].join('/');
        await this.s3Service.deleteFile(thumbKey).catch(() => {});
      } catch (error) {
        // Silent - DB image deletion proceeds anyway
      }
    }

    return await this.prisma.product_images.delete({
      where: { id: imageId },
    });
  }

  async getProductStats(storeId: number) {
    try {
      // Get all products for the store
      const products = await this.prisma.products.findMany({
        where: {
          store_id: storeId,
        },
        include: {
          product_images: true,
        },
      });

      const settings = await this.loadMergedSettings(storeId);

      // Calculate stats
      const active_products = products.filter(
        (p) => p.state === ProductState.ACTIVE,
      ).length;
      const inactive_products = products.filter(
        (p) => p.state === ProductState.INACTIVE,
      ).length;
      const total_products = active_products + inactive_products;
      const archived_products = products.filter(
        (p) => p.state === ProductState.ARCHIVED,
      ).length;

      /**
       * CP-PURCHASE-TRANSPARENCY D.3 — el universo de las cifras AGREGADAS.
       *
       * `total_products` ya sumaba sólo activos + inactivos, pero las cuatro
       * cifras de abajo barrían `products` entero: un producto archivado con
       * 20.000 unidades fantasma seguía aportando su valor al panel y contando
       * como «sin stock» o «bajo mínimo». D.2 ya lo sacó del motor de costeo;
       * esto cierra la otra mitad, la que el operador LEE.
       *
       * El criterio es de AGREGADO, no de visibilidad. Las lecturas de
       * DETALLE quedan intactas: `findAll({ state: 'archived' })` sigue
       * devolviendo el archivado con su existencia, y `previewArchiveWriteOff`
       * sigue detallando lo que el castigo destruye. `archived_products` los
       * sigue contando. Lo único que desaparece es su aporte a un total que
       * afirma cuánto inventario tiene el negocio.
       */
      const aggregate_universe = products.filter(
        (p) => p.state !== ProductState.ARCHIVED,
      );

      /**
       * D.3 — lo que sale del total, con nombre propio.
       *
       * Restar sin decir cuánto se restó es la otra forma de mentir: en
       * producción hay organizaciones donde lo archivado es el 95 % del valor
       * mostrado, y tres donde es el 100 %. Que el panel pase a cero de un día
       * para otro SIN una cifra que explique a dónde se fue se lee como
       * pérdida de inventario.
       *
       * Estos dos campos no los pinta nadie todavía; existen para que el
       * frontend pueda sacar la línea «Valor en productos archivados» en un
       * commit posterior sin volver a tocar el backend. Son ADITIVOS: ningún
       * consumidor actual los lee, así que no rompen nada.
       */
      const archived_universe = products.filter(
        (p) => p.state === ProductState.ARCHIVED,
      );
      const archived_stock_units = archived_universe.reduce(
        (sum, product) => sum + Number(product.stock_quantity ?? 0),
        0,
      );
      const archived_stock_value = archived_universe.reduce(
        (sum, product) =>
          sum + product.base_price * Number(product.stock_quantity ?? 0),
        0,
      );

      // Stock calculations (simplified - using stock_quantity field)
      const low_stock_products = aggregate_universe.filter((p) => {
        const stockQuantity = Number(p.stock_quantity ?? 0);
        return (
          p.stock_quantity !== null &&
          p.stock_quantity !== undefined &&
          stockQuantity > 0 &&
          stockQuantity <= resolveProductLowStockThreshold(settings, p)
        );
      }).length;

      const out_of_stock_products = aggregate_universe.filter(
        (p) =>
          p.stock_quantity !== null &&
          p.stock_quantity !== undefined &&
          p.stock_quantity === 0,
      ).length;

      // Products without images
      const products_without_images = aggregate_universe.filter(
        (p) => !p.product_images || p.product_images.length === 0,
      ).length;

      // Total value (sum of base_price * stock_quantity)
      const total_value = aggregate_universe.reduce((sum, product) => {
        const stock = product.stock_quantity || 0;
        return sum + product.base_price * stock;
      }, 0);

      // Count unique categories and brands
      const categories_count = await this.prisma.categories.count({
        where: {
          store_id: storeId,
        },
      });

      // Count brands that have products in this store
      const brands_count = await this.prisma.brands.count({
        where: {
          products: {
            some: {
              store_id: storeId,
            },
          },
        },
      });

      // CP-POLLO-ARABE-727 F.1 — ADR-10: `getProductStats` es alcanzable por
      // `cocina` vía `store:products:read` (products.controller.ts:554). Los
      // montos de inventario (`total_value`/`archived_stock_value`) no viajan a
      // ese rol: se anulan, se conservan las unidades y los conteos.
      const kitchenStats = this.isKitchenRole();
      return {
        total_products,
        active_products,
        inactive_products,
        archived_products,
        low_stock_products,
        out_of_stock_products,
        products_without_images,
        ...(kitchenStats
          ? { total_value: null }
          : { total_value }),
        categories_count,
        brands_count,
        /** D.3 — el valor que `total_value` ya NO incluye, para poder mostrarlo aparte. */
        ...(kitchenStats
          ? { archived_stock_value: null }
          : { archived_stock_value }),
        archived_stock_units,
      };
    } catch (error) {
      throw new BadRequestException(
        `Error calculating product stats: ${error.message}`,
      );
    }
  }

  async createVariant(
    productId: number,
    createVariantDto: CreateProductVariantDto,
  ) {
    return this.productVariantService.createVariant(
      productId,
      createVariantDto,
    );
  }

  async updateVariant(
    variantId: number,
    updateVariantDto: UpdateProductVariantDto,
  ) {
    return this.productVariantService.updateVariant(
      variantId,
      updateVariantDto,
    );
  }

  async removeVariant(variantId: number) {
    return this.productVariantService.removeVariant(variantId);
  }

  async generateOnlinePurchaseLink(id: number) {
    const product = await this.prisma.products.findFirst({
      where: {
        id,
        state: { not: ProductState.ARCHIVED },
      },
      select: {
        id: true,
        store_id: true,
        slug: true,
        state: true,
        available_for_ecommerce: true,
        online_purchase_url: true,
        online_purchase_qr_code: true,
        online_purchase_domain_id: true,
        online_purchase_generated_at: true,
      },
    });

    if (!product) {
      throw new VendixHttpException(ErrorCodes.PROD_FIND_001);
    }

    const status = await this.resolveOnlinePurchaseStatus(product.store_id);
    if (!status.ready) {
      throw new BadRequestException(status.message);
    }

    const onlinePurchaseData = await this.buildOnlinePurchaseData(
      product.store_id,
      product.slug,
    );

    if (!onlinePurchaseData) {
      throw new BadRequestException(
        'No se pudo generar el QR de compra online.',
      );
    }

    const updatedProduct = await this.prisma.products.update({
      where: { id },
      data: {
        ...onlinePurchaseData,
        updated_at: new Date(),
      },
      select: {
        id: true,
        slug: true,
        state: true,
        available_for_ecommerce: true,
        online_purchase_url: true,
        online_purchase_qr_code: true,
        online_purchase_domain_id: true,
        online_purchase_generated_at: true,
        online_purchase_domain: {
          select: {
            id: true,
            hostname: true,
          },
        },
      },
    });

    return {
      generated: true,
      product_id: updatedProduct.id,
      online_purchase_url: updatedProduct.online_purchase_url,
      online_purchase_qr_code: updatedProduct.online_purchase_qr_code,
      qr_data_url: updatedProduct.online_purchase_qr_code,
      online_purchase_domain_id: updatedProduct.online_purchase_domain_id,
      domain_hostname: updatedProduct.online_purchase_domain?.hostname ?? null,
      online_purchase_generated_at: updatedProduct.online_purchase_generated_at,
      online_purchase_ready: status.ready,
      online_purchase_status_reason: status.reason,
      online_purchase_status_message: this.getOnlinePurchaseStatusMessage(
        updatedProduct,
        status,
      ),
    };
  }

  private async buildOnlinePurchaseData(
    storeId: number,
    slug: string,
  ): Promise<OnlinePurchaseData | null> {
    const status = await this.resolveOnlinePurchaseStatus(storeId);

    if (!status.ready || !status.domain_id || !status.domain_hostname) {
      return null;
    }

    const onlinePurchaseUrl = this.buildOnlinePurchaseUrl(
      status.domain_hostname,
      slug,
    );
    const qrDataUrl = await this.qrService.generateDataUrl(
      onlinePurchaseUrl,
      320,
    );

    return {
      online_purchase_url: onlinePurchaseUrl,
      online_purchase_qr_code: qrDataUrl,
      online_purchase_domain_id: status.domain_id,
      online_purchase_generated_at: new Date(),
    };
  }

  private async resolveOnlinePurchaseStatus(
    storeId: number,
  ): Promise<OnlinePurchaseStatus> {
    const settingsRow = await this.prisma.store_settings.findFirst({
      where: { store_id: storeId },
      select: { settings: true },
    });
    const settings = mergeStoreSettingsWithDefaults(settingsRow?.settings);

    if (!settings.ecommerce || settings.ecommerce.enabled === false) {
      return {
        ready: false,
        reason: 'ecommerce_not_configured',
        message:
          'Configura y activa la tienda online antes de generar el QR de compra.',
        domain_id: null,
        domain_hostname: null,
      };
    }

    const ecommerceDomain = await this.prisma.domain_settings.findFirst({
      where: {
        store_id: storeId,
        app_type: 'STORE_ECOMMERCE',
        domain_type: 'ecommerce',
        status: 'active',
        is_primary: true,
      },
      orderBy: [{ updated_at: 'desc' }],
      select: {
        id: true,
        hostname: true,
      },
    });

    if (!ecommerceDomain?.hostname) {
      return {
        ready: false,
        reason: 'ecommerce_domain_not_active',
        message:
          'No hay un dominio principal de ecommerce activo para generar el QR de compra.',
        domain_id: null,
        domain_hostname: null,
      };
    }

    return {
      ready: true,
      reason: 'ready',
      message: 'La tienda online está lista para generar QR de compra.',
      domain_id: ecommerceDomain.id,
      domain_hostname: ecommerceDomain.hostname,
    };
  }

  private shouldRefreshOnlinePurchase(
    product: any,
    onlinePurchaseData: OnlinePurchaseData,
  ): boolean {
    return (
      !product.online_purchase_url ||
      !product.online_purchase_qr_code ||
      product.online_purchase_url !== onlinePurchaseData.online_purchase_url ||
      product.online_purchase_domain_id !==
        onlinePurchaseData.online_purchase_domain_id
    );
  }

  private buildOnlinePurchaseUrl(hostname: string, slug: string): string {
    const cleanHostname = hostname
      .trim()
      .replace(/^https?:\/\//i, '')
      .replace(/\/+$/, '');

    return `https://${cleanHostname}/products/${encodeURIComponent(slug)}`;
  }

  private getOnlinePurchaseStatusMessage(
    product: any,
    status: OnlinePurchaseStatus,
  ): string {
    if (!status.ready) {
      return status.message;
    }

    if (!product.online_purchase_url || !product.online_purchase_qr_code) {
      return 'Genera el link y QR de compra online para este producto.';
    }

    if (
      product.state !== ProductState.ACTIVE ||
      product.available_for_ecommerce === false
    ) {
      return 'El link y QR existen, pero el producto debe estar activo y disponible en ecommerce para que el cliente pueda comprar.';
    }

    return 'Link y QR de compra online listos.';
  }

  private async handleImageUploads(
    images: ProductImageDto[],
    productSlug: string,
    org: S3OrgContext,
    store: S3StoreContext,
  ): Promise<any[]> {
    const processedImages: any[] = [];
    const basePath = this.s3PathHelper.buildProductPath(org, store);

    for (const [index, image] of images.entries()) {
      let imageUrl = image.image_url;
      if (imageUrl.startsWith('data:image')) {
        // Upload base64 image - result.key is already a clean S3 key
        const result = await this.s3Service.uploadBase64(
          imageUrl,
          `${basePath}/${productSlug}-${Date.now()}-${index}`,
          undefined,
          { generateThumbnail: true, context: ImageContext.PRODUCT },
        );
        imageUrl = result.key;
      } else if (
        imageUrl.startsWith('http://') ||
        imageUrl.startsWith('https://')
      ) {
        const sanitizedKey = extractS3KeyFromUrl(imageUrl);

        if (sanitizedKey && sanitizedKey !== imageUrl) {
          imageUrl = sanitizedKey;
        } else {
          const remoteImage =
            await this.remoteImageService.fetchPreview(imageUrl);
          const result = await this.s3Service.uploadBase64(
            remoteImage.dataUrl,
            `${basePath}/${productSlug}-remote-${Date.now()}-${index}`,
            remoteImage.contentType,
            { generateThumbnail: true, context: ImageContext.PRODUCT },
          );
          imageUrl = result.key;
        }
      } else {
        // CRITICAL: Sanitize existing URLs to extract S3 key
        // This prevents storing signed URLs that expire after 24 hours
        const sanitizedKey = extractS3KeyFromUrl(imageUrl);
        imageUrl = sanitizedKey || imageUrl;
      }
      processedImages.push({
        image_url: imageUrl,
        is_main: image.is_main || false,
        alt_text: image.alt_text,
        sort_order: image.sort_order || index,
      });
    }
    return processedImages;
  }

  private parseVariantAttributes(
    attributes: any,
  ): Array<{ attribute_name: string; attribute_value: string }> {
    if (!attributes || typeof attributes !== 'object') return [];
    return Object.entries(attributes).map(([key, value]) => ({
      attribute_name: key,
      attribute_value: String(value),
    }));
  }

  private sumVariantStock(variant: any): number {
    if (
      Array.isArray(variant?.stock_levels) &&
      variant.stock_levels.length > 0
    ) {
      return variant.stock_levels.reduce(
        (sum: number, sl: any) => sum + (sl?.quantity_available ?? 0),
        0,
      );
    }
    return variant?.stock_quantity ?? 0;
  }

  private async signProductImage(
    product: any,
    useThumbnail = false,
  ): Promise<string | undefined> {
    const mainImage =
      product.product_images?.find((img) => img.is_main) ||
      product.product_images?.[0];
    return this.s3Service.signUrl(mainImage?.image_url, useThumbnail);
  }

  private async signProductImages(product: any): Promise<void> {
    if (product.product_images) {
      for (const img of product.product_images) {
        img.image_url = await this.s3Service.signUrl(img.image_url);
      }
    }

    if (product.product_variants) {
      for (const variant of product.product_variants) {
        if (variant.product_images) {
          variant.product_images.image_url = await this.s3Service.signUrl(
            variant.product_images.image_url,
          );
        }
      }
    }
  }

  /**
   * Helper to get store with organization context for S3 path building
   */
  private async getStoreWithOrgContext(
    storeId: number,
  ): Promise<{ org: S3OrgContext; store: S3StoreContext }> {
    const store = await this.prisma.stores.findUnique({
      where: { id: storeId },
      select: {
        id: true,
        slug: true,
        organizations: {
          select: { id: true, slug: true },
        },
      },
    });

    if (!store || !store.organizations) {
      throw new BadRequestException('Store or organization not found');
    }

    return {
      org: store.organizations,
      store: { id: store.id, slug: store.slug },
    };
  }

  /**
   * Batch-resolve active auto-apply promotions for a list of products. The
   * resulting map keys are product ids; values are the highest-priority
   * promotion eligible by scope=product or scope=category. POS cards display
   * the promotional price computed off the same tax-inclusive `final_price`
   * the rest of the listing uses, so the badge stays visually consistent.
   */
  private async resolveActivePromotionsForListing(
    products: any[],
  ): Promise<Map<number, ActiveProductPromotion>> {
    if (!Array.isArray(products) || products.length === 0) {
      return new Map();
    }

    const inputs: ActivePromotionProductInput[] = products
      .map((product) => {
        const productId = Number(product?.id);
        if (!Number.isFinite(productId)) return null;
        const unitPrice = this.calculateFinalPrice(product);
        if (!Number.isFinite(unitPrice) || unitPrice <= 0) return null;
        const categoryIds: number[] = (product.product_categories ?? [])
          .map((pc: any) => Number(pc?.categories?.id ?? pc?.category_id))
          .filter((id: number) => Number.isFinite(id));
        return {
          product_id: productId,
          category_ids: categoryIds,
          unit_price: unitPrice,
        } as ActivePromotionProductInput;
      })
      .filter((value): value is ActivePromotionProductInput => value !== null);

    if (inputs.length === 0) return new Map();

    try {
      return await this.promotionEngine.findActiveAutoPromotionsForProducts(
        inputs,
      );
    } catch {
      // Listing must never fail because of promotions; surface no badge
      // instead of erroring the whole catalog.
      return new Map();
    }
  }

  /**
   * Calculates the final price of a product including taxes and active offers.
   */
  private calculateFinalPrice(product: any): number {
    const basePrice =
      product.is_on_sale && product.sale_price
        ? Number(product.sale_price)
        : Number(product.base_price);

    let totalTaxRate = 0;

    if (product.product_tax_assignments) {
      for (const assignment of product.product_tax_assignments) {
        if (assignment.tax_categories?.tax_rates) {
          for (const tax of assignment.tax_categories.tax_rates) {
            totalTaxRate += Number(tax.rate);
          }
        }
      }
    }

    const finalPrice = basePrice * (1 + totalTaxRate);
    return Math.round(finalPrice * 100) / 100;
  }

  private async resolvePosScope(): Promise<ResolvedInventoryScope> {
    const [store, settings] = await Promise.all([
      this.loadStoreScopeRef(),
      this.loadMergedSettings(),
    ]);
    return resolvePosStockScope(store, settings);
  }

  // StorePrismaService exposes `stores` via the unscoped baseClient, so we
  // filter explicitly by the current store_id from RequestContext.
  private async loadStoreScopeRef(): Promise<{
    default_location_id: number | null;
  }> {
    const storeId = RequestContextService.getStoreId();
    if (!storeId) {
      return { default_location_id: null };
    }
    const store = await this.prisma.stores.findUnique({
      where: { id: storeId },
      select: { default_location_id: true },
    });
    return { default_location_id: store?.default_location_id ?? null };
  }

  private async loadMergedSettings(storeId?: number): Promise<StoreSettings> {
    const row = await this.prisma.store_settings.findFirst({
      ...(storeId && { where: { store_id: storeId } }),
      select: { settings: true },
    });
    return mergeStoreSettingsWithDefaults(row?.settings);
  }
}
