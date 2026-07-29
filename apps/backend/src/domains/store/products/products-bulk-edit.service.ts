import { HttpException, Injectable } from '@nestjs/common';
import { StorePrismaService } from '../../../prisma/services/store-prisma.service';
import { ProductsService } from './products.service';
import { ErrorCodes, VendixHttpException } from 'src/common/errors';
import { storeIndustriesSupportIngredients } from '@common/helpers/industry-capabilities.helper';
import {
  BulkEditFieldDiffDto,
  BulkEditPreviewItemDto,
  BulkEditPreviewResultDto,
  BulkEditProductsDto,
  BulkEditResultDto,
  BulkEditResultItemDto,
  BulkEditableChangesDto,
  UpdateProductDto,
} from './dto';
// Los enums SIEMPRE desde el módulo hoja: importarlos desde `./dto` (barrel con
// `export *`) los recibiría `undefined` por el ciclo que swc iza al inicio del
// módulo compilado. Ver la cabecera de `dto/product-enums.ts`.
import { ProductState, ProductType } from './dto/product-enums';

/** Fila de `products` leída para el preview. Genérica a propósito: el diff
 *  recorre `BULK_EDITABLE_FIELDS` contra las columnas homónimas de la fila. */
type ProductRow = Record<string, any> & {
  id: number;
  name: string;
  sku: string | null;
  store_id: number;
};

/** Payload efectivo tras replicar las neutralizaciones de `ProductsService`. */
interface EffectiveChanges {
  payload: Record<string, any>;
  /** `true` si el sanitizer de insumo puro llegó a disparar. */
  neutralized: boolean;
}

/**
 * Las 34 claves escalares de `BulkEditableChangesDto`, en el orden del DTO.
 *
 * El diff se calcula EXCLUSIVAMENTE sobre esta lista, no sobre las claves del
 * payload efectivo, porque `sanitizeIngredientPayload()` inyecta dos campos que
 * no son columnas escalares comparables:
 *
 * - `enabled_price_tier_ids: []`: es relacional (`product_price_tier_assignments`).
 *   `products.service.ts:2159-2173` borra TODAS las asignaciones de tramo cuando
 *   llega definido, así que el efecto se anuncia en el mensaje del warning en vez
 *   de en el diff.
 * - `online_purchase_url: null`: `products.service.ts:2093-2099,3209-3220` puede
 *   sobreescribirlo regenerando link + QR (`shouldRefreshOnlinePurchase`), lo cual
 *   depende de la disponibilidad del dominio ecommerce y escribe en S3. En lectura
 *   no se puede afirmar el valor final, así que tampoco entra al diff.
 */
const BULK_EDITABLE_FIELDS: readonly string[] = [
  'product_type',
  'state',
  'pricing_type',
  'is_sellable',
  'is_ingredient',
  'is_combo',
  'is_batch_produced',
  'track_inventory',
  'requires_serial_numbers',
  'base_price',
  'cost_price',
  'profit_margin',
  'is_on_sale',
  'sale_price',
  'allow_pos_price_override',
  'has_multiple_price_tiers',
  'available_for_ecommerce',
  'is_featured',
  'weight',
  'dimensions',
  'stock_uom_id',
  'purchase_uom_id',
  'service_duration_minutes',
  'service_modality',
  'service_pricing_type',
  'requires_booking',
  'booking_mode',
  'is_recurring',
  'service_instructions',
  'preparation_time_minutes',
  'is_consultation',
  'send_preconsultation',
  'consultation_template_id',
  'preconsultation_template_id',
];

/**
 * Edición masiva de productos: preview read-only + aplicación fila por fila.
 *
 * ## Por qué el preview NO es un dry-run transaccional
 *
 * `ProductsService.update()` tiene dos efectos que una transacción de Prisma NO
 * revierte:
 *
 * 1. Borra objetos de S3 en fire-and-forget FUERA de la transacción.
 * 2. Puede regenerar el link y el QR de compra online
 *    (`shouldRefreshOnlinePurchase`), lo que también escribe en S3.
 *
 * Un `$transaction` + rollback dejaría S3 corrupto de forma irreversible. Por eso
 * `preview()` REPLICA las precondiciones en lectura: no ejecuta ninguna escritura,
 * ni dentro ni fuera de transacción. Toda regla replicada aquí lleva la línea de
 * origen en `products.service.ts` para poder auditar la deriva.
 *
 * ## Por qué `apply()` delega íntegramente en `update()`
 *
 * Las reglas de negocio de producto (stock, UoM, categorías, impuestos, tramos,
 * imágenes, QR) viven en `update()`. Duplicarlas aquí garantizaría deriva, así
 * que `apply()` no escribe Prisma: itera y llama `update(id, changes, { lean: true })`
 * capturando el fallo de cada fila para no abortar el lote.
 */
@Injectable()
export class ProductsBulkEditService {
  constructor(
    private readonly prisma: StorePrismaService,
    private readonly productsService: ProductsService,
  ) {}

  // ===========================================================================
  // PREVIEW (read-only)
  // ===========================================================================

  async preview(dto: BulkEditProductsDto): Promise<BulkEditPreviewResultDto> {
    const ids = this.dedupeIds(dto.ids);

    // Paso batch, réplica de `products.service.ts:1891-1894`: el sanitizer de
    // insumo puro y la normalización por tipo corren UNA vez sobre el payload
    // compartido, antes de mirar ningún producto. `validateByProductType()`
    // lanza (PROD_SVC_001) si el payload es inválido en sí mismo: eso haría
    // fallar TODAS las filas por igual, así que se propaga como fallo de lote
    // en vez de repetirse N veces.
    const batch = this.sanitizeIngredientPayload(this.cloneChanges(dto.changes));
    this.validateByProductType(batch.payload);

    // --- Lecturas ---------------------------------------------------------
    // `products` está en la lista store-scoped de StorePrismaService, así que el
    // filtro por tienda es automático. No se filtra por `state` aquí: hay que
    // distinguir "no existe" de "archivado" (ambos error, pero el archivado sí
    // tiene nombre que mostrar).
    const products = (await this.prisma.products.findMany({
      where: { id: { in: ids } },
    })) as ProductRow[];
    const productById = new Map<number, ProductRow>(
      products.map((product) => [product.id, product]),
    );

    const editableIds = products
      .filter((product) => product.state !== ProductState.ARCHIVED)
      .map((product) => product.id);

    const reservedProductIds = await this.loadActiveReservationProductIds(editableIds);
    const variantProductIds = await this.loadProductIdsWithVariants(
      batch.payload,
      editableIds,
    );
    const activeRecipeProductIds = await this.loadProductIdsWithActiveRecipe(
      batch.payload,
      editableIds,
    );
    const ingredientCapableStores = await this.loadIngredientCapableStores(
      batch.payload,
      products,
    );

    // --- Clasificación ----------------------------------------------------
    const items: BulkEditPreviewItemDto[] = ids.map((id) => {
      const product = productById.get(id);

      // `products.service.ts:1897-1906`: findFirst con `state != archived`;
      // ausente o archivado ⇒ PROD_FIND_001.
      if (!product || product.state === ProductState.ARCHIVED) {
        return {
          id,
          // Sin fila no hay nombre real; el backend no fabrica uno. El `id` ya
          // viaja en la respuesta para que la UI identifique la fila.
          name: product?.name ?? '',
          sku: product?.sku ?? null,
          status: 'error',
          changes: [],
          code: ErrorCodes.PROD_FIND_001.code,
          message: product
            ? 'El producto está archivado y no se puede editar'
            : ErrorCodes.PROD_FIND_001.devMessage,
        };
      }

      const effective = this.resolveEffectiveChanges(
        batch,
        product,
        ingredientCapableStores,
      );
      const changes = this.buildDiff(product, effective.payload);
      const base = {
        id: product.id,
        name: product.name,
        sku: product.sku ?? null,
        changes,
      };

      const failure = this.detectFailure(
        product,
        effective.payload,
        reservedProductIds,
        variantProductIds,
      );
      if (failure) {
        return { ...base, status: 'error', ...failure };
      }

      const warnings = this.detectWarnings(
        product,
        effective,
        batch,
        ingredientCapableStores,
        activeRecipeProductIds,
      );
      if (warnings.length > 0) {
        return { ...base, status: 'warning', message: warnings.join(' ') };
      }

      return { ...base, status: 'ok' };
    });

    return {
      total: items.length,
      ok: items.filter((item) => item.status === 'ok').length,
      warnings: items.filter((item) => item.status === 'warning').length,
      errors: items.filter((item) => item.status === 'error').length,
      items,
    };
  }

  // ===========================================================================
  // APPLY
  // ===========================================================================

  async apply(dto: BulkEditProductsDto): Promise<BulkEditResultDto> {
    const ids = this.dedupeIds(dto.ids);

    // Nombres por adelantado: si `update()` lanza no hay fila devuelta de la
    // que sacar el nombre, y una fila de resultado sin nombre es inútil en la
    // UI. Lectura barata y read-only.
    const knownNames = new Map<number, string>();
    const rows = await this.prisma.products.findMany({
      where: { id: { in: ids } },
      select: { id: true, name: true },
    });
    for (const row of rows) {
      knownNames.set(row.id, row.name);
    }

    const results: BulkEditResultItemDto[] = [];

    // En serie y con try/catch por producto: el fallo de una fila NO aborta las
    // siguientes. Delegación íntegra en `update()` (ver docblock de la clase).
    for (const id of ids) {
      try {
        const updated = await this.productsService.update(
          id,
          dto.changes as UpdateProductDto,
          { lean: true },
        );
        results.push({
          id,
          name: updated?.name ?? knownNames.get(id) ?? '',
          status: 'ok',
        });
      } catch (error) {
        const { code, message } = this.extractErrorInfo(error);
        results.push({
          id,
          name: knownNames.get(id) ?? '',
          status: 'error',
          ...(code && { code }),
          message,
        });
      }
    }

    return {
      total: results.length,
      successful: results.filter((result) => result.status === 'ok').length,
      failed: results.filter((result) => result.status === 'error').length,
      results,
    };
  }

  // ===========================================================================
  // Réplicas de las reglas de ProductsService (read-only)
  // ===========================================================================

  /**
   * Réplica de `ProductsService.sanitizeIngredientPayload()`
   * (`products.service.ts:338-367`).
   *
   * Nota de fidelidad: `isPure` se evalúa contra los valores del DTO, NO contra
   * los efectivos del producto. Un producto que YA tiene `is_sellable=false` y
   * al que solo se le manda `is_ingredient=true` no dispara el sanitizer, porque
   * `dto.is_sellable` es `undefined`. Se replica tal cual: cambiarlo aquí crearía
   * deriva contra el servicio individual.
   */
  private sanitizeIngredientPayload(
    payload: Record<string, any>,
  ): EffectiveChanges {
    const isPure = !!payload.is_ingredient && payload.is_sellable === false;
    if (!isPure) return { payload, neutralized: false };
    return {
      payload: {
        ...payload,
        base_price: 0,
        sale_price: 0,
        is_on_sale: false,
        allow_pos_price_override: false,
        has_multiple_price_tiers: false,
        enabled_price_tier_ids: [],
        available_for_ecommerce: false,
        is_featured: false,
        online_purchase_url: null,
      },
      neutralized: true,
    };
  }

  /**
   * Réplica de `ProductsService.enforceIngredientCapability()`
   * (`products.service.ts:382-399`). Solo actúa si el payload pide
   * `is_ingredient=true`; devuelve el flag forzado a `false` cuando las
   * industrias de la tienda no soportan insumos.
   */
  private enforceIngredientCapability(
    payload: Record<string, any>,
    storeId: number | null | undefined,
    ingredientCapableStores: Map<number, boolean>,
  ): Record<string, any> {
    if (payload.is_ingredient !== true) {
      return payload;
    }
    if (!storeId) {
      return { ...payload, is_ingredient: false };
    }
    if (!ingredientCapableStores.get(storeId)) {
      return { ...payload, is_ingredient: false };
    }
    return payload;
  }

  /**
   * Réplica de `ProductsService.validateByProductType()`
   * (`products.service.ts:422-444`). MUTA el payload recibido, igual que el
   * original — de ahí el clon previo en `preview()`.
   *
   * Solo se replican los campos que existen en `BulkEditableChangesDto`: los de
   * stock (`stock_quantity`, `min_stock_level`, `reorder_point`, …) y
   * `requires_batch_tracking` están excluidos del contrato de edición masiva, así
   * que forzarlos aquí no cambiaría nada.
   */
  private validateByProductType(payload: Record<string, any>): void {
    if (payload.product_type !== ProductType.SERVICE) return;

    if (payload.weight && payload.weight > 0) {
      throw new VendixHttpException(ErrorCodes.PROD_SVC_001);
    }
    if (payload.requires_serial_numbers || payload.requires_batch_tracking) {
      throw new VendixHttpException(ErrorCodes.PROD_SVC_001);
    }

    // Inventario forzado a off para servicios. `track_inventory: false` se
    // PERSISTE aunque el usuario no lo haya pedido, así que entra al diff.
    payload.track_inventory = false;
    payload.weight = undefined;
    payload.dimensions = undefined;
    payload.requires_serial_numbers = undefined;
  }

  /**
   * Secuencia por producto de `products.service.ts:1911-1915`:
   * gate de capacidad de insumo contra la tienda del producto, y RE-sanitize
   * para que las neutralizaciones queden coherentes si el flag se apagó.
   */
  private resolveEffectiveChanges(
    batch: EffectiveChanges,
    product: ProductRow,
    ingredientCapableStores: Map<number, boolean>,
  ): EffectiveChanges {
    const gated = this.enforceIngredientCapability(
      batch.payload,
      product.store_id,
      ingredientCapableStores,
    );
    const resanitized = this.sanitizeIngredientPayload(gated);
    // El sanitizer de lote ya pudo haber neutralizado precios ANTES del gate, y
    // el gate no revierte esa neutralización: se persiste igual. Se propaga el
    // flag para no perder el warning en ese caso.
    return {
      payload: resanitized.payload,
      neutralized: batch.neutralized || resanitized.neutralized,
    };
  }

  /**
   * Bloqueos de `update()` que harían fallar la fila, en el MISMO orden en que
   * el servicio individual los evalúa, para que el código reportado sea el que
   * realmente se lanzaría primero.
   */
  private detectFailure(
    product: ProductRow,
    effective: Record<string, any>,
    reservedProductIds: Set<number>,
    variantProductIds: Set<number>,
  ): { code: string; message: string } | null {
    // 1. `products.service.ts:1917-1931` — reservas de stock activas del propio
    //    producto (`product_variant_id: null`, `status: 'active'`).
    if (reservedProductIds.has(product.id)) {
      return {
        code: ErrorCodes.INV_STOCK_001.code,
        message:
          'Cannot modify product with active stock reservations. Release reservations first.',
      };
    }

    // 2. `products.service.ts:1996-2010` — no se puede pasar a SERVICE un
    //    producto que ya tiene variantes. Solo aplica si HOY no es servicio.
    if (
      effective.product_type === ProductType.SERVICE &&
      product.product_type !== ProductType.SERVICE &&
      variantProductIds.has(product.id)
    ) {
      return {
        code: ErrorCodes.PROD_SVC_HAS_VARIANTS_001.code,
        message:
          'No se puede cambiar a SERVICE un producto con variantes existentes',
      };
    }

    // 3. `products.service.ts:2025-2063` — reglas de consulta sobre el valor
    //    EFECTIVO (payload ?? producto). Solo se evalúan cuando el payload pide
    //    explícitamente `is_consultation === true`, igual que el original.
    const consultationError = this.detectConsultationFailure(product, effective);
    if (consultationError) return consultationError;

    return null;
  }

  private detectConsultationFailure(
    product: ProductRow,
    effective: Record<string, any>,
  ): { code: string; message: string } | null {
    if (effective.is_consultation !== true) return null;

    // El servicio individual lanza `BadRequestException` pelada en este bloque,
    // sin `error_code`. Se reutiliza PROD_VALIDATE_001 (400, "La validación del
    // producto falló") conservando el mensaje literal del original, para no
    // introducir códigos nuevos.
    const code = ErrorCodes.PROD_VALIDATE_001.code;

    const effectiveProductType =
      effective.product_type ?? product.product_type;
    if (effectiveProductType !== ProductType.SERVICE) {
      return { code, message: 'Solo los servicios pueden ser consultas' };
    }

    const effectiveRequiresBooking =
      effective.requires_booking ?? product.requires_booking;
    if (!effectiveRequiresBooking) {
      return { code, message: 'Las consultas requieren reserva previa' };
    }

    const effectiveTemplateId =
      effective.consultation_template_id ?? product.consultation_template_id;
    if (!effectiveTemplateId) {
      return {
        code,
        message: 'Las consultas requieren una plantilla de consulta',
      };
    }

    const effectiveSendPreconsultation =
      effective.send_preconsultation ?? product.send_preconsultation;
    const effectivePreconsultationTemplateId =
      effective.preconsultation_template_id ??
      product.preconsultation_template_id;
    if (effectiveSendPreconsultation && !effectivePreconsultationTemplateId) {
      return {
        code,
        message:
          'Si se envía preconsulta, se requiere una plantilla de preconsulta',
      };
    }

    return null;
  }

  /**
   * Neutralizaciones silenciosas: el cambio SÍ se aplica, pero no como el
   * usuario lo pidió. No llevan `code` — no son errores, y el contrato prohíbe
   * inventar códigos nuevos para reutilizarlos con otra semántica.
   */
  private detectWarnings(
    product: ProductRow,
    effective: EffectiveChanges,
    batch: EffectiveChanges,
    ingredientCapableStores: Map<number, boolean>,
    activeRecipeProductIds: Set<number>,
  ): string[] {
    const warnings: string[] = [];

    // `enforceIngredientCapability()` apagará el flag en silencio.
    if (
      batch.payload.is_ingredient === true &&
      effective.payload.is_ingredient !== true
    ) {
      warnings.push(
        'Las industrias de esta tienda no admiten insumos: "is_ingredient" se guardará como falso.',
      );
    }

    // `sanitizeIngredientPayload()` ya anuló precios y flags de venta.
    if (effective.neutralized) {
      warnings.push(
        'Insumo puro (is_ingredient + no vendible): se anularán precio base, precio de oferta, "en oferta", ' +
          'override de precio en POS, tramos de precio (incluidas sus asignaciones), disponibilidad en ecommerce, ' +
          'destacado y el link de compra online.',
      );
    }

    // Plato sin receta activa: se guardará como `prepared` pero sin BOM que
    // explotar, así que no descontará insumos al enviar a cocina.
    if (
      effective.payload.product_type === ProductType.PREPARED &&
      !activeRecipeProductIds.has(product.id)
    ) {
      warnings.push(
        'El producto no tiene receta activa: quedará como preparado sin lista de materiales.',
      );
    }

    return warnings;
  }

  // ===========================================================================
  // Lecturas auxiliares
  // ===========================================================================

  private async loadActiveReservationProductIds(
    editableIds: number[],
  ): Promise<Set<number>> {
    if (editableIds.length === 0) return new Set();
    const reservations = await this.prisma.stock_reservations.findMany({
      where: {
        product_id: { in: editableIds },
        product_variant_id: null,
        status: 'active',
      },
      select: { product_id: true },
    });
    return new Set(
      reservations.map((reservation) => reservation.product_id),
    );
  }

  private async loadProductIdsWithVariants(
    payload: Record<string, any>,
    editableIds: number[],
  ): Promise<Set<number>> {
    if (payload.product_type !== ProductType.SERVICE) return new Set();
    if (editableIds.length === 0) return new Set();
    const variants = await this.prisma.product_variants.findMany({
      where: { product_id: { in: editableIds } },
      select: { product_id: true },
    });
    return new Set(variants.map((variant) => variant.product_id));
  }

  private async loadProductIdsWithActiveRecipe(
    payload: Record<string, any>,
    editableIds: number[],
  ): Promise<Set<number>> {
    if (payload.product_type !== ProductType.PREPARED) return new Set();
    if (editableIds.length === 0) return new Set();
    const recipes = await this.prisma.recipes.findMany({
      where: { product_id: { in: editableIds }, is_active: true },
      select: { product_id: true },
    });
    return new Set(recipes.map((recipe) => recipe.product_id));
  }

  /**
   * Capacidad de insumo por tienda. Solo consulta cuando el payload realmente
   * pide `is_ingredient=true`, igual que el original (el camino retail queda sin
   * query).
   *
   * `StorePrismaService.stores` devuelve el `baseClient` (requiere scoping
   * manual). Aquí es seguro: los `store_id` provienen de filas de `products` que
   * YA salieron del cliente scoped por tienda.
   */
  private async loadIngredientCapableStores(
    payload: Record<string, any>,
    products: ProductRow[],
  ): Promise<Map<number, boolean>> {
    const capability = new Map<number, boolean>();
    if (payload.is_ingredient !== true) return capability;

    const storeIds = [...new Set(products.map((product) => product.store_id))];
    if (storeIds.length === 0) return capability;

    const stores = await this.prisma.stores.findMany({
      where: { id: { in: storeIds } },
      select: { id: true, industries: true },
    });
    for (const store of stores) {
      capability.set(
        store.id,
        storeIndustriesSupportIngredients(store.industries),
      );
    }
    return capability;
  }

  // ===========================================================================
  // Utilidades
  // ===========================================================================

  private dedupeIds(ids: number[]): number[] {
    return [...new Set(ids)];
  }

  private cloneChanges(changes: BulkEditableChangesDto): Record<string, any> {
    return { ...(changes as Record<string, any>) };
  }

  /**
   * Diff real: solo los campos cuyo valor efectivo difiere del actual. Un campo
   * pedido con el valor que ya tiene NO entra. Los `undefined` se ignoran porque
   * Prisma los trata como "no tocar".
   */
  private buildDiff(
    product: ProductRow,
    effective: Record<string, any>,
  ): BulkEditFieldDiffDto[] {
    const diff: BulkEditFieldDiffDto[] = [];
    for (const field of BULK_EDITABLE_FIELDS) {
      if (!(field in effective)) continue;
      const next = effective[field];
      if (next === undefined) continue;
      const current = product[field];
      if (!this.hasChanged(current, next)) continue;
      diff.push({ field, current: this.toComparable(current), next });
    }
    return diff;
  }

  /**
   * Normaliza para comparar. Los precios/peso llegan como `Decimal` de Prisma,
   * que nunca es `===` a un `number`: sin esto todo campo monetario produciría
   * un diff falso. `null` y `undefined` se tratan como el mismo "vacío".
   */
  private toComparable(value: unknown): unknown {
    if (value === null || value === undefined) return null;
    if (
      typeof value === 'object' &&
      typeof (value as { toNumber?: unknown }).toNumber === 'function'
    ) {
      return (value as { toNumber: () => number }).toNumber();
    }
    return value;
  }

  private hasChanged(current: unknown, next: unknown): boolean {
    const a = this.toComparable(current);
    const b = this.toComparable(next);
    const isObject = (value: unknown) =>
      typeof value === 'object' && value !== null;
    if (isObject(a) || isObject(b)) {
      return JSON.stringify(a) !== JSON.stringify(b);
    }
    return a !== b;
  }

  /**
   * Extrae `error_code` + mensaje de la excepción de una fila. `VendixHttpException`
   * primero: extiende `HttpException`, así que el orden importa.
   */
  private extractErrorInfo(error: unknown): {
    code?: string;
    message: string;
  } {
    if (error instanceof VendixHttpException) {
      const response = error.getResponse() as { message?: string } | string;
      const message =
        typeof response === 'string'
          ? response
          : (response?.message ?? error.message);
      return { code: error.errorCode, message };
    }
    if (error instanceof HttpException) {
      const response = error.getResponse() as
        | { message?: unknown; error_code?: string }
        | string;
      if (typeof response === 'string') {
        return { message: response };
      }
      const raw = response?.message;
      const message = Array.isArray(raw)
        ? raw.join('; ')
        : typeof raw === 'string'
          ? raw
          : error.message;
      return {
        ...(response?.error_code && { code: response.error_code }),
        message,
      };
    }
    if (error instanceof Error) {
      return { message: error.message };
    }
    return { message: 'Error desconocido al actualizar el producto' };
  }
}
