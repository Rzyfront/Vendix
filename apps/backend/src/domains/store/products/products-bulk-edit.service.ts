import { HttpException, Injectable, Logger } from '@nestjs/common';
import { StorePrismaService } from '../../../prisma/services/store-prisma.service';
import { RequestContextService } from '@common/context/request-context.service';
import { ProductsService } from './products.service';
import { ErrorCodes, VendixHttpException } from 'src/common/errors';
import { storeIndustriesSupportIngredients } from '@common/helpers/industry-capabilities.helper';
import {
  BulkArchivePreviewItemDto,
  BulkArchivePreviewResultDto,
  BulkArchiveProductsDto,
  BulkArchiveResultDto,
  BulkArchiveResultItemDto,
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

/** Fila mínima para clasificar un archivado: no hay diff que calcular. */
interface ArchiveProductRow {
  id: number;
  name: string;
  sku: string | null;
  state: string;
}

/**
 * Restricciones del archivado, resueltas en UNA pasada de 4 lecturas por lote en
 * vez de 4 por producto.
 */
interface ArchiveConstraints {
  /** BLOQUEA: el producto tiene reservas de stock activas. */
  reserved: Set<number>;
  /** BLOQUEA: el producto está en un pedido abierto. */
  inOpenOrder: Set<number>;
  /** AVISA: el producto es insumo de una receta activa. */
  recipeComponent: Set<number>;
  /** AVISA: el producto está en una promoción vigente. */
  inLivePromotion: Set<number>;
}

/**
 * Estados terminales de una orden. Réplica literal de la lista `terminalStates`
 * de `order-flow.service.ts:2314` — el único sitio del backend que nombra el
 * concepto "terminal" para órdenes — y del `where` de `orders.service.ts:378`.
 *
 * "Pedido abierto" = TODO lo demás (`draft`, `created`, `pending_payment`,
 * `processing`, `shipped`, `delivered`). Es la variante más conservadora de las
 * que existen en el repo: superconjunto de `ORDER_OPEN_STATES`
 * (`webhook-handler.service.ts:29`) y de la lista de "órdenes activas" que ya
 * bloquea el borrado de una tienda (`stores.service.ts:311`). Para una operación
 * destructiva se elige el superconjunto a propósito: sobre-bloquear es
 * recuperable (el usuario cierra o cancela el pedido), sub-bloquear deja líneas
 * de pedido apuntando a un producto archivado.
 */
const TERMINAL_ORDER_STATES = ['finished', 'cancelled', 'refunded'] as const;

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
  'price_unit_quantity',
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
  private readonly logger = new Logger(ProductsBulkEditService.name);

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
  // ARCHIVADO MASIVO (soft-delete)
  // ===========================================================================
  //
  // El soft-delete de productos es EXCLUSIVAMENTE `state = 'archived'`
  // (`products.service.ts:2779-2800`). No hay columna `deleted_at` en el modelo.
  //
  // ## Asimetría deliberada: toda la protección vive en el preview
  //
  // `ProductsService.remove()` NO VALIDA NADA: llama `findOne(id)` y escribe
  // `state:'archived'`. No comprueba reservas de stock, pedidos abiertos, recetas
  // donde el producto es insumo, ni promociones vigentes — y `products` tiene 31
  // relaciones entrantes. Por tanto las 4 comprobaciones de este bloque son la
  // ÚNICA barrera que existe.
  //
  // Consecuencia: `archive()` RE-VERIFICA los bloqueos antes de archivar, no se
  // fía del preview. El preview es informativo y el usuario puede confirmar
  // minutos después; entre ambos momentos puede haberse creado una reserva o un
  // pedido. Sin la re-verificación, `remove()` no lo detendría.
  //
  // Límite conocido: la re-verificación es un snapshot tomado al inicio de
  // `archive()`, no un lock. Una reserva creada DURANTE el bucle no se detecta.
  // Cerrar esa ventana exigiría `$transaction` + bloqueo de filas sobre 4 tablas
  // por producto; queda fuera de alcance y se documenta en vez de simularse.

  /**
   * Dry-run del archivado: clasifica cada producto sin escribir nada.
   *
   * ESTRICTAMENTE READ-ONLY. Ni `update`, ni `create`, ni `delete`, ni
   * `$transaction`.
   */
  async previewArchive(
    dto: BulkArchiveProductsDto,
  ): Promise<BulkArchivePreviewResultDto> {
    const ids = this.dedupeIds(dto.ids);

    const products = await this.loadArchiveRows(ids);
    const productById = new Map<number, ArchiveProductRow>(
      products.map((product) => [product.id, product]),
    );

    // Solo los archivables entran a las comprobaciones: preguntar por reservas de
    // un id inexistente o ya archivado es gasto sin respuesta útil.
    const archivableIds = products
      .filter((product) => product.state !== ProductState.ARCHIVED)
      .map((product) => product.id);

    const constraints = await this.loadArchiveConstraints(archivableIds);
    // D.6 / FB-10 — lo que cada fila va a perder. Dos consultas para todo el
    // lote, no dos por producto.
    const writeOffs =
      await this.productsService.getArchiveWriteOffPlansByIds(archivableIds);

    const items: BulkArchivePreviewItemDto[] = ids.map((id) => {
      const product = productById.get(id);
      const writeOff = writeOffs.get(id);
      const writeOffFields = {
        on_hand_units: writeOff?.total_units ?? 0,
        value_to_write_off: writeOff?.total_value ?? 0,
        zero_cost_units: writeOff?.zero_cost_units ?? 0,
        out_of_scope_units: writeOff?.out_of_scope_units ?? 0,
      };

      // `remove()` llama `findOne()`, que filtra `state != archived`
      // (`products.service.ts:1615-1623`): ausente o ya archivado ⇒ PROD_FIND_001.
      if (!product || product.state === ProductState.ARCHIVED) {
        return {
          id,
          name: product?.name ?? '',
          sku: product?.sku ?? null,
          status: 'error' as const,
          code: ErrorCodes.PROD_FIND_001.code,
          message: product
            ? 'El producto ya está archivado'
            : ErrorCodes.PROD_FIND_001.devMessage,
          ...writeOffFields,
        };
      }

      const base = {
        id: product.id,
        name: product.name,
        sku: product.sku ?? null,
        ...writeOffFields,
      };

      const blocker = this.detectArchiveBlocker(product.id, constraints);
      if (blocker) {
        return { ...base, status: 'error' as const, ...blocker };
      }

      // D.6 — existencias fuera del alcance de la tienda (bodega central de la
      // organización). `remove()` las rechaza, así que el preview lo dice antes
      // en vez de dejar que el lote falle fila a fila.
      if (writeOffFields.out_of_scope_units > 0) {
        return {
          ...base,
          status: 'error' as const,
          code: ErrorCodes.PROD_VARIANT_HAS_STOCK_001.code,
          message: `El producto tiene ${writeOffFields.out_of_scope_units} unidades en ubicaciones fuera de esta tienda. Transfiérelas o ajústalas antes de archivarlo.`,
        };
      }

      const warnings = this.detectArchiveWarnings(product.id, constraints);
      // D.6 — el castigo de inventario es un AVISO, no un bloqueo: se ejecuta
      // si el operador confirma. Va primero en el texto porque es lo único
      // irreversible de la lista.
      if (writeOffFields.on_hand_units > 0) {
        warnings.unshift(
          `Se darán de baja ${writeOffFields.on_hand_units} unidades por un valor de ${writeOffFields.value_to_write_off}.`,
        );
      }
      if (warnings.length > 0) {
        return {
          ...base,
          status: 'warning' as const,
          message: warnings.join(' '),
        };
      }

      return { ...base, status: 'ok' as const };
    });

    const totalUnits = items.reduce((sum, item) => sum + item.on_hand_units, 0);

    return {
      total: items.length,
      ok: items.filter((item) => item.status === 'ok').length,
      warnings: items.filter((item) => item.status === 'warning').length,
      errors: items.filter((item) => item.status === 'error').length,
      total_units_to_write_off: totalUnits,
      total_value_to_write_off: items.reduce(
        (sum, item) => sum + item.value_to_write_off,
        0,
      ),
      requires_confirmation: totalUnits > 0,
      items,
    };
  }

  /**
   * Archiva el lote. Delega en `ProductsService.remove()` producto por producto:
   * NO escribe `state:'archived'` con Prisma directamente. Misma razón que en
   * `apply()` — no duplicar la primitiva de soft-delete y no tener que replicar
   * su manejo de P2025.
   *
   * Un fallo NO aborta el lote: cada fila lleva su propio `try/catch`, igual que
   * `apply()`.
   */
  async archive(dto: BulkArchiveProductsDto): Promise<BulkArchiveResultDto> {
    const ids = this.dedupeIds(dto.ids);

    // Nombres por adelantado: si `remove()` lanza no hay fila devuelta de la que
    // sacar el nombre, y una fila de resultado sin nombre es inútil en la UI.
    const products = await this.loadArchiveRows(ids);
    const knownNames = new Map<number, string>(
      products.map((product) => [product.id, product.name]),
    );

    // Re-verificación de los bloqueos (ver el docblock de la sección): el preview
    // pudo haberse calculado hace minutos.
    const archivableIds = products
      .filter((product) => product.state !== ProductState.ARCHIVED)
      .map((product) => product.id);
    const constraints = await this.loadArchiveConstraints(archivableIds);

    // D.6 — el castigo se declara, no se asume. Ausente ⇒ `false`, y entonces
    // `remove()` rechaza cada producto con existencias exactamente igual que
    // por la ruta individual: un lote de un solo identificador no es un atajo.
    const confirmStockWriteOff = dto.confirm_stock_write_off === true;
    // Identificador del lote: la única manera de reconstruir después qué
    // productos se destruyeron bajo UNA misma confirmación.
    const batchId = `bulk-archive-${Date.now()}-${Math.random()
      .toString(36)
      .slice(2, 10)}`;

    // Lo que el operador estaba aprobando en el momento de pulsar. Se calcula
    // ANTES de tocar nada: después del castigo el stock ya es cero y la cifra
    // sería irrecuperable.
    const approvedPlans =
      await this.productsService.getArchiveWriteOffPlansByIds(archivableIds);

    const results: BulkArchiveResultItemDto[] = [];

    for (const id of ids) {
      // Los ids inexistentes o ya archivados no están en `constraints`: caen al
      // `remove()`, que lanza PROD_FIND_001 y se registra como fallo de la fila.
      const blocker = this.detectArchiveBlocker(id, constraints);
      if (blocker) {
        results.push({
          id,
          name: knownNames.get(id) ?? '',
          status: 'error',
          ...blocker,
          written_off_units: 0,
          written_off_value: 0,
        });
        continue;
      }

      const plan = approvedPlans.get(id);

      try {
        const archived = await this.productsService.remove(id, {
          confirm_stock_write_off: confirmStockWriteOff,
          batch_id: batchId,
        });
        results.push({
          id,
          name: archived?.name ?? knownNames.get(id) ?? '',
          status: 'ok',
          written_off_units: plan?.total_units ?? 0,
          written_off_value: plan?.total_value ?? 0,
          zero_cost_units: plan?.zero_cost_units ?? 0,
        });
      } catch (error) {
        const { code, message } = this.extractErrorInfo(error);
        results.push({
          id,
          name: knownNames.get(id) ?? '',
          status: 'error',
          ...(code && { code }),
          message,
          written_off_units: 0,
          written_off_value: 0,
        });
      }
    }

    const summary: BulkArchiveResultDto = {
      total: results.length,
      successful: results.filter((result) => result.status === 'ok').length,
      failed: results.filter((result) => result.status === 'error').length,
      written_off_units: results.reduce(
        (sum, result) => sum + (result.written_off_units ?? 0),
        0,
      ),
      written_off_value: results.reduce(
        (sum, result) => sum + (result.written_off_value ?? 0),
        0,
      ),
      results,
    };

    // D.8 — fila resumen del lote. Cada producto ya dejó la suya dentro de su
    // propia transacción; ésta es la que ata las N a una sola confirmación.
    // Medido antes de este paso: 17 productos archivados en un mismo lote
    // dejaron CERO filas en `audit_logs`, porque el interceptor global no
    // escribe nada en esta ruta.
    await this.writeBulkArchiveAuditRow(batchId, confirmStockWriteOff, summary);

    return summary;
  }

  /**
   * Fila resumen del archivado masivo.
   *
   * A DIFERENCIA de la fila por producto (que va DENTRO de la transacción del
   * castigo y aborta si falla), ésta se escribe después y su fallo NO revierte
   * nada: no habría nada que revertir, porque cada producto ya se commiteó por
   * separado y su propia fila ya quedó escrita. Perder este resumen degrada la
   * trazabilidad, no la destruye.
   */
  private async writeBulkArchiveAuditRow(
    batchId: string,
    confirmed: boolean,
    summary: BulkArchiveResultDto,
  ): Promise<void> {
    try {
      const storeId = RequestContextService.getStoreId();
      if (storeId == null) {
        // `store_id` no nulo es parte del contrato de la fila (D.8). Sin
        // contexto de tienda no hay fila que escribir, pero tampoco se calla:
        // el archivado masivo sólo se alcanza por una ruta con contexto, así
        // que llegar aquí es una anomalía que hay que poder ver.
        this.logger.warn(
          `Archivado masivo ${batchId} sin contexto de tienda: no se escribió la fila resumen de auditoría.`,
        );
        return;
      }

      await this.prisma.audit_logs.create({
        data: {
          user_id: RequestContextService.getUserId() ?? null,
          store_id: storeId,
          organization_id: RequestContextService.getOrganizationId() ?? null,
          action: 'PRODUCT_ARCHIVE_BULK',
          resource: 'products',
          resource_id: null,
          request_id: RequestContextService.getRequestId() ?? null,
          old_values: null,
          new_values: null,
          metadata: {
            batch_id: batchId,
            confirmation: { confirmed },
            total: summary.total,
            successful: summary.successful,
            failed: summary.failed,
            written_off_units: summary.written_off_units,
            written_off_value: summary.written_off_value,
            results: summary.results,
          },
        } as any,
      });
    } catch (error) {
      this.logger.error(
        `No se pudo escribir la auditoría resumen del archivado masivo ${batchId}: ${error?.message || error}`,
      );
    }
  }

  /**
   * Bloqueos del archivado, en orden de severidad operativa. Devuelve el primero
   * que aplique para que la UI muestre un motivo único y accionable.
   */
  private detectArchiveBlocker(
    productId: number,
    constraints: ArchiveConstraints,
  ): { code: string; message: string } | null {
    if (constraints.reserved.has(productId)) {
      // Mismo código que el bloqueo del servicio individual en `update()` y en
      // `remove()`. D.7 lo movió de `INV_STOCK_001` (400) a
      // `PROD_HAS_RESERVATIONS_001` (409): un mismo rechazo, un solo código.
      return {
        code: ErrorCodes.PROD_HAS_RESERVATIONS_001.code,
        message:
          'El producto tiene reservas de stock activas. Libera las reservas antes de archivarlo.',
      };
    }

    if (constraints.inOpenOrder.has(productId)) {
      // Se REUTILIZA PROD_VALIDATE_001 (400, "La validación del producto falló"):
      // el contrato prohíbe añadir códigos nuevos, y este preview ya lo reutiliza
      // para los bloqueos de consulta que el servicio individual lanza sin código
      // tipado (ver `detectConsultationFailure`).
      return {
        code: ErrorCodes.PROD_VALIDATE_001.code,
        message:
          'El producto está en pedidos abiertos. Finaliza o cancela esos pedidos antes de archivarlo.',
      };
    }

    return null;
  }

  /**
   * Avisos: el archivado SÍ se aplica. No llevan `code` — no son errores, y el
   * contrato prohíbe reutilizar códigos existentes con otra semántica.
   */
  private detectArchiveWarnings(
    productId: number,
    constraints: ArchiveConstraints,
  ): string[] {
    const warnings: string[] = [];

    if (constraints.recipeComponent.has(productId)) {
      warnings.push(
        'El producto es insumo de una receta activa: los platos que lo usan quedarán con un componente archivado.',
      );
    }

    if (constraints.inLivePromotion.has(productId)) {
      warnings.push(
        'El producto está en una promoción vigente: la promoción seguirá activa sin él.',
      );
    }

    return warnings;
  }

  // ===========================================================================
  // Lecturas auxiliares del archivado (read-only)
  // ===========================================================================

  private async loadArchiveRows(ids: number[]): Promise<ArchiveProductRow[]> {
    if (ids.length === 0) return [];
    // `products` es store-scoped en `StorePrismaService`, así que el filtro por
    // tienda es automático. No se filtra por `state`: hay que distinguir "no
    // existe" de "ya archivado" (ambos error, pero el archivado tiene nombre).
    return (await this.prisma.products.findMany({
      where: { id: { in: ids } },
      select: { id: true, name: true, sku: true, state: true },
    })) as ArchiveProductRow[];
  }

  private async loadArchiveConstraints(
    archivableIds: number[],
  ): Promise<ArchiveConstraints> {
    const empty: ArchiveConstraints = {
      reserved: new Set(),
      inOpenOrder: new Set(),
      recipeComponent: new Set(),
      inLivePromotion: new Set(),
    };
    if (archivableIds.length === 0) return empty;

    const [reserved, inOpenOrder, recipeComponent, inLivePromotion] =
      await Promise.all([
        this.loadArchiveBlockingReservationIds(archivableIds),
        this.loadProductIdsInOpenOrders(archivableIds),
        this.loadProductIdsUsedAsRecipeComponent(archivableIds),
        this.loadProductIdsInLivePromotions(archivableIds),
      ]);

    return { reserved, inOpenOrder, recipeComponent, inLivePromotion };
  }

  /**
   * Reservas de stock activas. Predicado tomado de
   * `products.service.ts:1924-1932`, con UNA desviación deliberada: NO se filtra
   * `product_variant_id: null`.
   *
   * Motivo: el predicado original responde "¿puedo editar un campo escalar del
   * producto base?", donde una reserva sobre una variante es irrelevante.
   * Archivar responde otra pregunta: el producto entero — variantes incluidas —
   * desaparece del catálogo. Una reserva activa sobre una variante quedaría
   * huérfana apuntando a un producto archivado. La decisión de producto dice
   * "el producto tiene reservas de stock activas", sin distinguir base de
   * variante.
   *
   * Es un superconjunto del predicado individual: bloquea todo lo que bloquea el
   * original, más las reservas de variante. Para revertir a fidelidad literal,
   * añadir `product_variant_id: null` al `where`.
   *
   * `stock_reservations` está scopeado relacionalmente por
   * `inventory_locations.store_id` en `StorePrismaService`, así que no hace falta
   * filtro de tienda manual.
   */
  private async loadArchiveBlockingReservationIds(
    archivableIds: number[],
  ): Promise<Set<number>> {
    const reservations = await this.prisma.stock_reservations.findMany({
      where: {
        product_id: { in: archivableIds },
        status: 'active',
      },
      select: { product_id: true },
    });
    return new Set(reservations.map((reservation) => reservation.product_id));
  }

  /**
   * Productos presentes en un pedido abierto. Se consulta `order_items` filtrando
   * por el estado de su orden con `TERMINAL_ORDER_STATES` (ver esa constante para
   * la procedencia del predicado).
   *
   * `order_items` está scopeado relacionalmente por `orders.store_id` en
   * `StorePrismaService`, así que el filtro de tienda es automático.
   *
   * Nota: `order_items.product_id` es nullable y existe además
   * `product_variant_id`. Los flujos de POS/ecommerce escriben `product_id`
   * también en las líneas de variante, así que filtrar por `product_id` cubre
   * ambos casos.
   */
  private async loadProductIdsInOpenOrders(
    archivableIds: number[],
  ): Promise<Set<number>> {
    const items = await this.prisma.order_items.findMany({
      where: {
        product_id: { in: archivableIds },
        orders: {
          state: { notIn: [...TERMINAL_ORDER_STATES] as any },
        },
      },
      select: { product_id: true },
    });
    return new Set(
      items
        .map((item) => item.product_id)
        .filter((productId): productId is number => productId !== null),
    );
  }

  /**
   * Productos usados como insumo (`component_product_id`) de una receta ACTIVA.
   *
   * Ojo con la dirección: `loadProductIdsWithActiveRecipe()` (usado por el
   * preview de edición) pregunta "¿este producto TIENE receta?" mirando
   * `recipes.product_id`. Aquí la pregunta es la inversa — "¿este producto ES
   * insumo de la receta de otro?" — así que se mira
   * `recipe_items.component_product_id` y se filtra por la receta padre.
   *
   * `is_active` en `recipes` es lo que marca una receta como activa
   * (`schema.prisma`, modelo `recipes`), igual que en
   * `loadProductIdsWithActiveRecipe()`. `recipe_items` está scopeado
   * relacionalmente por `recipe.store_id` en `StorePrismaService`.
   */
  private async loadProductIdsUsedAsRecipeComponent(
    archivableIds: number[],
  ): Promise<Set<number>> {
    const items = await this.prisma.recipe_items.findMany({
      where: {
        component_product_id: { in: archivableIds },
        recipe: { is_active: true },
      },
      select: { component_product_id: true },
    });
    return new Set(items.map((item) => item.component_product_id));
  }

  /**
   * Productos en una promoción vigente.
   *
   * La ventana de vigencia es la MISMA que usa el motor de promociones al cotizar
   * un carrito (`promotion-engine.service.ts:373-375`, `quoteDiscounts`), que es
   * la definición canónica del repo y está fijada por su propio test
   * (`promotion-engine.service.spec.ts:323-331`):
   *
   *   state ∈ {active, scheduled} AND start_date <= now
   *   AND (end_date IS NULL OR end_date >= now)
   *
   * `scheduled` entra a propósito: `start_date <= now` es lo que realmente abre la
   * ventana, así que una promoción `scheduled` cuya fecha de inicio ya pasó está
   * viva. `end_date` nulo significa sin caducidad, y el límite es inclusivo
   * (`gte`, no `gt`).
   *
   * `promotion_products` está scopeado relacionalmente por
   * `promotions.store_id` en `StorePrismaService`.
   */
  private async loadProductIdsInLivePromotions(
    archivableIds: number[],
  ): Promise<Set<number>> {
    const now = new Date();
    const rows = await this.prisma.promotion_products.findMany({
      where: {
        product_id: { in: archivableIds },
        promotions: {
          state: { in: ['active', 'scheduled'] as any },
          start_date: { lte: now },
          OR: [{ end_date: null }, { end_date: { gte: now } }],
        },
      },
      select: { product_id: true },
    });
    return new Set(rows.map((row) => row.product_id));
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
      // D.7 — espejo exacto del bloqueo individual de `update()`.
      return {
        code: ErrorCodes.PROD_HAS_RESERVATIONS_001.code,
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
