import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { StorePrismaService } from 'src/prisma/services/store-prisma.service';
import {
  CreateProductVariantDto,
  UpdateProductVariantDto,
  ProductState,
} from '../dto';
import { RequestContextService } from '@common/context/request-context.service';
import { Prisma } from '@prisma/client';
import { LocationsService } from '../../inventory/locations/locations.service';
import { StockLevelManager } from '../../inventory/shared/services/stock-level-manager.service';
import { S3Service } from '@common/services/s3.service';
import { VendixHttpException, ErrorCodes } from 'src/common/errors';
import { AutoEntryService } from '../../accounting/auto-entries/auto-entry.service';

@Injectable()
export class ProductVariantService {
  private readonly logger = new Logger(ProductVariantService.name);

  constructor(
    private readonly prisma: StorePrismaService,
    private readonly inventoryLocationsService: LocationsService,
    private readonly stockLevelManager: StockLevelManager,
    private readonly s3Service: S3Service,
    private readonly autoEntryService: AutoEntryService,
  ) {}

  /**
   * Subcuenta PUC de la variante: debe existir, estar activa y aceptar
   * movimientos en el `chart_of_accounts` de la organización.
   *
   * NO valida cuando llega una `tx`. Con transacción abierta quien llama es
   * `ProductsService`, que ya validó el LOTE completo (producto + todas sus
   * variantes) en una sola consulta antes de abrirla; repetirla aquí sería una
   * lectura por variante contra un pool ya comprometido — el patrón que agota
   * conexiones dentro de `$transaction`.
   *
   * PATCH-safe: `undefined` (el campo no viaja) no se valida, así que una
   * variante con un `account_code` histórico ya inválido se sigue pudiendo
   * editar en cualquier otro campo.
   */
  private async assertVariantAccountCodePostable(
    account_code: string | null | undefined,
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    if (tx) return;
    if (account_code === undefined) return;

    const organization_id = RequestContextService.getOrganizationId();
    if (!organization_id) return;

    await this.autoEntryService.validateProductAccountCodes(organization_id, [
      account_code,
    ]);
  }

  async findUniqueVariantBySlug(storeId: number, slug: string) {
    const variant = await this.prisma.product_variants.findFirst({
      where: {
        products: {
          store_id: storeId,
          slug: slug,
          state: 'active',
        },
      },
      include: {
        products: {
          include: {
            stores: true,
            brands: true,
            product_images: true,
            product_categories: {
              include: {
                categories: true,
              },
            },
          },
        },
        product_images: true,
      },
    });

    if (!variant) {
      throw new NotFoundException('Variante de producto no encontrada');
    }

    return variant;
  }
  async createVariant(
    product_id: number,
    createVariantDto: CreateProductVariantDto,
    tx?: Prisma.TransactionClient,
  ) {
    const context = RequestContextService.getContext();
    try {
      // Verify user context for audit
      const user_id = context?.user_id;
      if (
        !user_id &&
        createVariantDto.stock_quantity &&
        createVariantDto.stock_quantity > 0
      ) {
        throw new ForbiddenException(
          'User context required for stock operations',
        );
      }

      // Verificar que el producto existe y está activo
      const prisma = tx || this.prisma;
      const product = await prisma.products.findFirst({
        where: {
          id: product_id,
          state: ProductState.ACTIVE,
        },
      });

      if (!product) {
        throw new BadRequestException('Producto no encontrado o inactivo');
      }

      // Cross-validation: service-specific fields only for service products
      const isService = product.product_type === 'service';
      const hasServiceFields =
        createVariantDto.service_duration_minutes !== undefined ||
        createVariantDto.service_pricing_type !== undefined ||
        createVariantDto.buffer_minutes !== undefined ||
        createVariantDto.preparation_time_minutes !== undefined;

      if (!isService && hasServiceFields) {
        throw new VendixHttpException(
          ErrorCodes.PROD_VALIDATE_004,
          'Service-specific fields can only be set on service product variants',
        );
      }

      // BLOQUEO: un producto que ya es insumo de una receta no admite variantes.
      //
      // Cara opuesta de la guarda que vive en `recipes.service.ts#addItem`.
      // `recipe_items` sólo guarda `component_product_id`, sin columna de
      // variante, así que variantizar un insumo manda el consumo de producción
      // a la fila BASE de `stock_levels` — vacía en cuanto existen variantes.
      // La producción descontaría de un saldo inexistente y el inventario real
      // quedaría intacto, sin error. Bloquear sólo del lado de la receta dejaba
      // abierta esta puerta con el mismo resultado.
      const recipeUses = await prisma.recipe_items.count({
        where: { component_product_id: product_id },
      });
      if (recipeUses > 0) {
        throw new VendixHttpException(
          ErrorCodes.PRODUCT_VARIANT_BLOCKED_IS_RECIPE_COMPONENT,
          `Este producto se usa como insumo en ${recipeUses} receta(s), así que no admite variantes. Quítalo de esas recetas antes de variantizarlo.`,
        );
      }

      // BLOCK: Check for active stock reservations
      const hasActiveReservations = await prisma.stock_reservations.findFirst({
        where: {
          product_id: product_id,
          product_variant_id: null,
          status: 'active',
        },
      });
      if (hasActiveReservations) {
        // D.7 — mismo rechazo, mismo código: reservas activas es
        // `PROD_HAS_RESERVATIONS_001` (409), no `INV_STOCK_001` (400).
        throw new VendixHttpException(
          ErrorCodes.PROD_HAS_RESERVATIONS_001,
          'Cannot add variant to product with active stock reservations. Release reservations first.',
        );
      }

      // Verificar que el SKU no esté vacío
      if (!createVariantDto.sku || createVariantDto.sku.trim() === '') {
        throw new VendixHttpException(ErrorCodes.PROD_VALIDATE_003);
      }

      // Verificar que el SKU sea único dentro del producto
      const existingSku = await prisma.product_variants.findFirst({
        where: {
          sku: createVariantDto.sku,
          product_id: product_id,
        },
      });

      if (existingSku) {
        throw new ConflictException('El SKU de la variante ya está en uso');
      }

      // Subcuenta PUC de la variante — se valida ANTES de abrir la transacción.
      // No-op cuando `tx` viene dado: el lote ya lo validó `ProductsService`.
      await this.assertVariantAccountCodePostable(
        createVariantDto.account_code,
        tx,
      );

      if (tx) {
        return this.executeCreateVariant(
          tx,
          product,
          createVariantDto,
          user_id,
        );
      }

      return await this.prisma.$transaction(async (p) => {
        return this.executeCreateVariant(p, product, createVariantDto, user_id);
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === 'P2002') {
          throw new ConflictException('El SKU de la variante ya existe');
        }
      }
      throw error;
    }
  }

  private async executeCreateVariant(
    prisma: Prisma.TransactionClient,
    product: any,
    createVariantDto: CreateProductVariantDto,
    user_id?: number,
  ) {
    const priceOverride =
      createVariantDto.price_override ?? createVariantDto.price;

    // BLOCK: price_override must be null or > 0 (reject 0 as ambiguous)
    if (
      priceOverride !== null &&
      priceOverride !== undefined &&
      priceOverride <= 0
    ) {
      throw new VendixHttpException(
        ErrorCodes.PROD_VAR_PRICE_001,
        'price_override de variante debe ser null o mayor que 0',
      );
    }

    // BLOCK: is_on_sale=true requires sale_price > 0 and sale_price < base_price (or price_override for variant)
    if (createVariantDto.is_on_sale) {
      const basePrice = Number(product.base_price);
      const salePrice = createVariantDto.sale_price;
      const referencePrice = priceOverride ?? basePrice;

      if (salePrice == null || salePrice <= 0 || salePrice >= referencePrice) {
        throw new VendixHttpException(
          ErrorCodes.PROD_VAR_SALE_PRICE_001,
          'sale_price de variante inválido: debe ser > 0 y < precio de referencia',
        );
      }
    }

    // Crear variante usando scoped client
    const variant = await prisma.product_variants.create({
      data: {
        product_id: product.id,
        sku: createVariantDto.sku,
        barcode: createVariantDto.barcode?.trim() || null,
        name: createVariantDto.name,
        attributes: createVariantDto.attributes,
        price_override: priceOverride,
        cost_price: createVariantDto.cost_price,
        profit_margin: createVariantDto.profit_margin,
        is_on_sale: createVariantDto.is_on_sale,
        sale_price: createVariantDto.sale_price,
        image_id: createVariantDto.image_id,
        track_inventory_override: createVariantDto.track_inventory_override,
        service_duration_minutes: createVariantDto.service_duration_minutes,
        service_pricing_type: createVariantDto.service_pricing_type,
        buffer_minutes: createVariantDto.buffer_minutes,
        preparation_time_minutes: createVariantDto.preparation_time_minutes,
        // Cuenta PUC de ingreso de la variante. Se enumera campo por campo, así
        // que omitirla la DESCARTABA en silencio: el DTO la acepta, la
        // validación pasa, llega el 200 y el dato no queda —y el `as any` de
        // abajo impide que el compilador lo note—. `executeUpdateVariant` sí la
        // persistía (usa `...variantData`), de modo que el campo se guardaba al
        // editar una variante y se perdía al crearla: el peor de los dos, porque
        // funciona lo suficiente para que nadie sospeche.
        //
        // La variante manda sobre el producto al contabilizar
        // (`resolveInvoiceRevenueLines`), así que perderla no deja el ingreso
        // «sin cuenta»: lo manda a la del producto o a la de por defecto, y el
        // asiento cuadra igual contra la subcuenta equivocada.
        account_code: createVariantDto.account_code,
        created_at: new Date(),
        updated_at: new Date(),
      } as any,
    });

    // Inicializar stock levels para la variante si se proporciona stock
    if (
      createVariantDto.stock_quantity &&
      createVariantDto.stock_quantity > 0
    ) {
      const defaultLocation =
        await this.inventoryLocationsService.getDefaultLocation(
          product.store_id,
        );

      await this.stockLevelManager.updateStock(
        {
          product_id: product.id,
          variant_id: variant.id,
          location_id: defaultLocation.id,
          quantity_change: createVariantDto.stock_quantity || 0,
          movement_type: 'initial',
          reason: 'Initial stock on variant creation',
          user_id: user_id!, // Non-null assertion safe because we checked above
          create_movement: true,
          validate_availability: false,
        },
        prisma,
      );
    }

    return variant;
  }

  /**
   * Actualiza una variante existente.
   *
   * IMPORTANTE — contrato sobre `image_id` y `variant_image_url`:
   * Esta función NO modifica la imagen de la variante. Esos campos
   * (`image_id` y `variant_image_url` del DTO) son destructurados y
   * descartados deliberadamente: la gestión completa de la imagen
   * (subir base64, borrar el registro anterior, preservar, limpiar)
   * la hace el orquestador `ProductsService.update()` en su bloque
   * atómico propio (ver `products.service.ts` líneas ~1899-2011).
   *
   * Si llegas aquí con `image_id` o `variant_image_url` en el DTO, ambos
   * serán ignorados sin error. Esto es intencional y evita:
   *  - Sobrescrituras accidentales (`image_id: null` pisando FKs válidas)
   *  - Que el endpoint standalone `PATCH /variants/:variantId` parezca
   *    que acepta cambios de imagen cuando en realidad no los aplica.
   * Si un cliente externo necesita cambiar la imagen de una variante,
   * debe usar el endpoint de producto completo (`PATCH /products/:id`).
   */
  async updateVariant(
    variantId: number,
    updateVariantDto: UpdateProductVariantDto,
    tx?: Prisma.TransactionClient,
  ) {
    const context = RequestContextService.getContext();
    const user_id = context?.user_id;

    if (!user_id && updateVariantDto.stock_quantity !== undefined) {
      throw new ForbiddenException(
        'User context required for stock operations',
      );
    }

    try {
      const prisma = tx || this.prisma;
      const existingVariant = await prisma.product_variants.findUnique({
        where: { id: variantId },
        include: {
          products: true,
        },
      });

      if (!existingVariant) {
        throw new NotFoundException('Variante no encontrada');
      }

      // BLOCK: Check for active stock reservations on this variant
      const hasActiveReservations = await prisma.stock_reservations.findFirst({
        where: {
          product_id: existingVariant.product_id,
          product_variant_id: variantId,
          status: 'active',
        },
      });
      if (hasActiveReservations) {
        // D.7 — mismo rechazo, mismo código: reservas activas es
        // `PROD_HAS_RESERVATIONS_001` (409), no `INV_STOCK_001` (400).
        throw new VendixHttpException(
          ErrorCodes.PROD_HAS_RESERVATIONS_001,
          'Cannot modify variant with active stock reservations. Release reservations first.',
        );
      }

      if (updateVariantDto.sku && updateVariantDto.sku.trim() !== '') {
        const existingSku = await prisma.product_variants.findFirst({
          where: {
            sku: updateVariantDto.sku,
            product_id: existingVariant.product_id,
            NOT: { id: variantId },
          },
        });

        if (existingSku) {
          throw new ConflictException('El SKU ya está en uso');
        }
      }

      // Subcuenta PUC de la variante — semántica PATCH: sólo se valida si el
      // campo viaja en el payload. No-op bajo `tx` (ver el helper).
      await this.assertVariantAccountCodePostable(
        updateVariantDto.account_code,
        tx,
      );

      if (tx) {
        return this.executeUpdateVariant(
          tx,
          variantId,
          updateVariantDto,
          existingVariant,
          user_id,
        );
      }

      return await this.prisma.$transaction(async (p) => {
        return this.executeUpdateVariant(
          p,
          variantId,
          updateVariantDto,
          existingVariant,
          user_id,
        );
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === 'P2002') {
          throw new ConflictException('Conflicto de datos únicos');
        }
      }
      throw error;
    }
  }

  private async executeUpdateVariant(
    prisma: Prisma.TransactionClient,
    variantId: number,
    updateVariantDto: UpdateProductVariantDto,
    existingVariant: any,
    user_id?: number,
  ) {
    const {
      stock_quantity,
      price,
      available_for_ecommerce: _availableForEcommerce,
      variant_removal_stock_mode: _variantRemovalStockMode,
      stock_by_location: _stockByLocation,
      variant_image_url: _variantImageUrl,
      // ⚠️ NO sobrescribir image_id aquí. La gestión de la imagen de la
      // variante (subir / borrar / preservar) se hace en el orquestador
      // superior (products.service.ts) con su propio bloque atómico.
      // Si dejamos pasar image_id, este update() lo pisa con null cuando
      // el frontend envía `image_id: null` al subir una nueva imagen,
      // y eso puede romper la FK si la product_images referenciada fue
      // borrada por un flujo anterior de re-upload del producto.
      image_id: _imageId,
      ...variantData
    } = updateVariantDto as UpdateProductVariantDto & {
      stock_by_location?: unknown;
      variant_image_url?: string;
    };
    const priceOverride =
      variantData.price_override !== undefined
        ? variantData.price_override
        : price !== undefined
          ? price
          : undefined;

    const hasServiceFields =
      variantData.service_duration_minutes !== undefined ||
      variantData.service_pricing_type !== undefined ||
      variantData.buffer_minutes !== undefined ||
      variantData.preparation_time_minutes !== undefined;

    if (existingVariant.products?.product_type !== 'service' && hasServiceFields) {
      throw new VendixHttpException(
        ErrorCodes.PROD_VALIDATE_004,
        'Service-specific fields can only be set on service product variants',
      );
    }

    // BLOCK: price_override must be null or > 0 (reject 0 as ambiguous)
    if (
      priceOverride !== null &&
      priceOverride !== undefined &&
      priceOverride <= 0
    ) {
      throw new VendixHttpException(
        ErrorCodes.PROD_VAR_PRICE_001,
        'price_override de variante debe ser null o mayor que 0',
      );
    }

    // BLOCK: is_on_sale=true requires sale_price > 0 and sale_price < base_price (or price_override for variant)
    const nextIsOnSale = variantData.is_on_sale ?? existingVariant.is_on_sale;
    if (nextIsOnSale) {
      const basePrice = Number(existingVariant.products?.base_price || 0);
      const salePrice = variantData.sale_price ?? existingVariant.sale_price;
      const nextPriceOverride =
        priceOverride !== undefined ? priceOverride : existingVariant.price_override;
      const referencePrice =
        nextPriceOverride ?? basePrice;

      if (salePrice == null || salePrice <= 0 || salePrice >= referencePrice) {
        throw new VendixHttpException(
          ErrorCodes.PROD_VAR_SALE_PRICE_001,
          'sale_price de variante inválido: debe ser > 0 y < precio de referencia',
        );
      }
    }

    // Actualizar variante
    const variant = await prisma.product_variants.update({
      where: { id: variantId },
      data: {
        ...variantData,
        price_override: priceOverride,
        // PATCH semantics: solo normalizar barcode si el DTO lo trae. '' /
        // whitespace-only → null para mantener consistencia con la ruta de
        // creación y evitar colisiones con barcodes vacíos.
        ...(updateVariantDto.barcode !== undefined
          ? { barcode: updateVariantDto.barcode?.trim() || null }
          : {}),
        updated_at: new Date(),
      } as any,
    });

    // Si cambió el stock, actualizar stock levels
    if (stock_quantity !== undefined) {
      // El saldo se lee con SQL crudo a propósito: `prisma` viene acotado al
      // tenant en una petición, y `stock_levels` incluye ubicaciones de la
      // organización (`inventory_locations.store_id IS NULL`) que ese filtro
      // deja fuera. Comparar contra un saldo truncado producía la diferencia
      // equivocada: una variante con 10 en la bodega de la organización y 1 en
      // el showroom se leía como 1, y "dejarla en 0" bajaba stock real.
      const stockRows: Array<{
        location_id: number;
        total: bigint | number | null;
      }> = await prisma.$queryRaw`
        SELECT location_id, COALESCE(SUM(quantity_available), 0)::bigint AS total
        FROM stock_levels
        WHERE product_variant_id = ${variantId}
        GROUP BY location_id
        HAVING COALESCE(SUM(quantity_available), 0) > 0
      `;

      // Una cantidad sola no puede repartir stock entre varias ubicaciones. El
      // código aplicaba toda la diferencia en la ubicación por defecto, así que
      // fijar el total de una variante repartida vaciaba esa ubicación y dejaba
      // intactas las demás. Antes que adivinar el reparto, se rechaza y se
      // manda al flujo que sí sabe hacerlo.
      if (stockRows.length > 1) {
        throw new VendixHttpException(
          ErrorCodes.INV_STOCK_001,
          'Esta variante tiene existencias en varias ubicaciones. Ajusta el stock desde Ajustes de Stock o Transferencias, no desde el editor del producto.',
        );
      }

      const currentStockQuantity = stockRows.reduce(
        (sum, row) => sum + Number(row.total ?? 0),
        0,
      );
      const stockDifference = stock_quantity - currentStockQuantity;

      if (stockDifference !== 0) {
        // El ajuste cae donde vive el stock. Mandarlo siempre a la ubicación
        // por defecto convertía una baja en un recorte contra una fila vacía:
        // el saldo se descontaba hasta 0 ahí y las unidades reales, en otra
        // ubicación, quedaban intactas. La ubicación por defecto sólo sirve de
        // destino cuando la variante todavía no tiene existencias en ninguna.
        const targetLocationId =
          stockRows.length === 1
            ? Number(stockRows[0].location_id)
            : (
                await this.inventoryLocationsService.getDefaultLocation(
                  existingVariant.products.store_id,
                )
              ).id;

        await this.stockLevelManager.updateStock(
          {
            product_id: existingVariant.product_id,
            variant_id: variantId,
            location_id: targetLocationId,
            quantity_change: stockDifference,
            movement_type: 'adjustment',
            reason: 'Stock quantity updated from variant edit',
            user_id: user_id!,
            create_movement: true,
            validate_availability: false,
          },
          prisma,
        );
      }
    }

    return variant;
  }

  private async cleanupVariantForeignKeys(
    prisma: any,
    variantId: number,
  ): Promise<void> {
    await prisma.order_items.updateMany({
      where: { product_variant_id: variantId },
      data: { product_variant_id: null },
    });
    await prisma.invoice_items.updateMany({
      where: { product_variant_id: variantId },
      data: { product_variant_id: null },
    });
    await prisma.quotation_items.updateMany({
      where: { product_variant_id: variantId },
      data: { product_variant_id: null },
    });
    await prisma.layaway_items.updateMany({
      where: { product_variant_id: variantId },
      data: { product_variant_id: null },
    });
    await prisma.dispatch_note_items.updateMany({
      where: { product_variant_id: variantId },
      data: { product_variant_id: null },
    });
    await prisma.inventory_adjustments.updateMany({
      where: { product_variant_id: variantId },
      data: { product_variant_id: null },
    });
    await prisma.inventory_transactions.updateMany({
      where: { product_variant_id: variantId },
      data: { product_variant_id: null },
    });
    // `inventory_valuation_snapshots` faltaba en esta lista, así que borrar una
    // variante que apareciera en cualquier snapshot de valuación reventaba con
    // `inventory_valuation_snapshots_product_variant_id_fkey`. El try/catch del
    // controlador lo devolvía como un error genérico, así que el borrado de
    // variantes estaba roto sin que se notara: basta un ajuste de stock —que
    // genera snapshot— para inhabilitarlo.
    //
    // Se pone a NULL, no se borra: el snapshot es histórico de valuación y
    // eliminarlo alteraría cifras ya emitidas. La columna es nullable
    // precisamente para esto, y es el mismo patrón de las 8 tablas de arriba.
    await prisma.inventory_valuation_snapshots.updateMany({
      where: { product_variant_id: variantId },
      data: { product_variant_id: null },
    });
    await prisma.stock_levels.deleteMany({
      where: { product_variant_id: variantId },
    });
  }

  async removeVariant(variantId: number) {
    const existingVariant = await this.prisma.product_variants.findUnique({
      where: { id: variantId },
      include: { product_images: { select: { image_url: true } } },
    });

    if (!existingVariant) {
      throw new NotFoundException('Variante no encontrada');
    }

    // BLOCK: cannot delete variant with active stock reservations
    const activeReservationsCount = await this.prisma.stock_reservations.count({
      where: { product_variant_id: variantId, status: 'active' },
    });
    if (activeReservationsCount > 0) {
      throw new VendixHttpException(
        ErrorCodes.PROD_HAS_RESERVATIONS_001,
        'Operación bloqueada: existen reservas de stock activas',
      );
    }

    // BLOCK: tampoco se borra una variante que TIENE EXISTENCIAS.
    //
    // `cleanupVariantForeignKeys` reasigna el histórico al producto base y
    // elimina las filas de `stock_levels` de la variante. Con saldo vivo eso
    // destruye inventario sin dejar ajuste ni movimiento que lo explique: el
    // stock simplemente desaparece del sistema.
    //
    // La guarda de reservas de arriba NO cubre este caso: las reservas son un
    // subconjunto del saldo, así que una variante con 40 unidades y cero
    // reservas pasaba sin fricción. Se suma `quantity_on_hand` —no
    // `quantity_available`— porque lo que se destruiría es el físico, y el
    // disponible puede ser 0 mientras hay existencias comprometidas.
    const stockAggregate = await this.prisma.stock_levels.aggregate({
      where: { product_variant_id: variantId },
      _sum: { quantity_on_hand: true },
    });
    const onHandUnits = Number(stockAggregate._sum.quantity_on_hand ?? 0);
    if (onHandUnits > 0) {
      throw new VendixHttpException(
        ErrorCodes.PROD_VARIANT_HAS_STOCK_001,
        `Operación bloqueada: la variante #${variantId} tiene ${onHandUnits} unidad(es) en existencia. Ajusta el stock a 0 antes de eliminarla.`,
      );
    }

    const unscopedPrisma = this.prisma.withoutScope() as any;

    return await unscopedPrisma.$transaction(async (prisma: any) => {
      await this.cleanupVariantForeignKeys(prisma, variantId);

      // Limpiar imagen de variante (DB + S3)
      if (existingVariant.image_id) {
        if (existingVariant.product_images?.image_url) {
          const key = existingVariant.product_images.image_url;
          const parts = key.split('/');
          const fileName = parts.pop();
          const thumbKey = [...parts, `thumb_${fileName}`].join('/');
          this.s3Service
            .deleteFile(key)
            .catch((err) =>
              this.logger.warn('S3 delete failed', { key, err: err.message }),
            );
          this.s3Service
            .deleteFile(thumbKey)
            .catch((err) =>
              this.logger.warn('S3 delete failed', {
                key: thumbKey,
                err: err.message,
              }),
            );
        }

        await prisma.product_variants.update({
          where: { id: variantId },
          data: { image_id: null },
        });
        await prisma.product_images
          .delete({
            where: { id: existingVariant.image_id },
          })
          .catch((err) =>
            this.logger.warn('product_images delete failed', {
              image_id: existingVariant.image_id,
              err: err.message,
            }),
          );
      }

      return await prisma.product_variants.delete({
        where: { id: variantId },
      });
    });
  }
}
