import { HttpException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { VendixHttpException } from '../../../common/errors';
import { RegisteredTool, ToolPreview } from '../interfaces/tool.interface';
import { ProductsService } from '../../../domains/store/products/products.service';
import {
  CreateProductVariantDto,
  UpdateProductVariantDto,
} from '../../../domains/store/products/dto';

export interface VariantToolDeps {
  productsService: ProductsService;
}

// ─────────────────────────────────────────────────────────────────────────────
// Doctrina de escritura (misma que `writes.tools.ts`, copiada a propósito:
// este factory no puede importar sus helpers privados y el barrel de writes
// no los exporta).
//
// - El `preview` es proyección, no transacción: el `handler` re-resuelve y
//   re-verifica sus precondiciones desde cero.
// - Un `preview` con `status: 'error'` no acuña token: la ejecución muere ahí.
// - Los handlers NO lanzan: devuelven `{error, next_step}` en español. Un
//   `throw` saldría como `AI_AGENT_003` opaco.
// - Toda escritura pasa por el servicio dueño. Cero `prisma.` en este archivo.
// ─────────────────────────────────────────────────────────────────────────────

/** Resultado uniforme de una resolución previa a escribir. */
type Resolution<T> =
  | { ok: true; value: T }
  | { ok: false; label: string; message: string; nextStep?: string };

function failure(
  label: string,
  message: string,
  nextStep?: string,
): { ok: false; label: string; message: string; nextStep?: string } {
  return { ok: false, label, message, nextStep };
}

/** `ToolPreview` de error: el registry aborta sin acuñar token. */
function previewError(
  label: string,
  message: string,
  domain: string,
): ToolPreview {
  return { status: 'error', target: label, changes: [], message, domain };
}

/** Respuesta de fallo de un handler. Nunca se lanza: el modelo debe poder leerla. */
function toolError(message: string, nextStep?: string): string {
  return JSON.stringify({
    error: message,
    ...(nextStep && { next_step: nextStep }),
  });
}

/**
 * Valida un DTO ya construido como lo haría el `ValidationPipe` global del
 * HTTP (`whitelist` + `forbidNonWhitelisted`): las tools llaman a los
 * servicios directo, sin pasar por el pipe.
 */
function toValidatedDto<T extends object>(
  DtoClass: new () => T,
  plain: Record<string, unknown>,
): { ok: true; dto: T } | { ok: false; message: string } {
  const dto = plainToInstance(DtoClass, plain, {
    enableImplicitConversion: true,
  });
  const errors = validateSync(dto, {
    whitelist: true,
    forbidNonWhitelisted: true,
  });
  if (!errors.length) return { ok: true, dto };
  const details = errors
    .flatMap((entry) => Object.values(entry.constraints ?? {}))
    .join('; ');
  return {
    ok: false,
    message: `Los datos no pasaron la validación: ${details || 'revisa los campos enviados'}.`,
  };
}

/** Traduce una excepción del dominio a texto que el modelo pueda narrar. */
function describeError(error: unknown): { code?: string; message: string } {
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
    if (typeof response === 'string') return { message: response };
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
  if (error instanceof Error) return { message: error.message };
  return { message: 'Error desconocido' };
}

function toPositiveInt(value: unknown): number | null {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) return null;
  return parsed;
}

function toNumberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Texto limpio o `undefined`. Nunca cadena vacía: eso confunde a los DTOs. */
function cleanString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : undefined;
}

/** Etiqueta humana de una variante (nombre, atributos o SKU). */
function variantLabel(variant: {
  name?: string | null;
  sku?: string | null;
  attributes?: unknown;
  id: number;
}): string {
  if (variant.name) return String(variant.name);
  const attributes = variant.attributes;
  if (attributes && typeof attributes === 'object') {
    const pairs = Object.entries(attributes as Record<string, unknown>)
      .map(([key, value]) => `${key}: ${String(value)}`)
      .join(', ');
    if (pairs) return pairs;
  }
  return String(variant.sku ?? `variante ${variant.id}`);
}

function productLabel(product: {
  name: string;
  sku?: string | null;
}): string {
  return product.sku ? `${product.name} (${product.sku})` : String(product.name);
}

/** Campos que `update_variant` sabe escribir, con su etiqueta para la propuesta. */
const VARIANT_FIELD_LABELS: Record<string, string> = {
  sku: 'SKU',
  name: 'Nombre',
  barcode: 'Código de barras',
  attributes: 'Atributos',
  price_override: 'Precio propio',
  cost_price: 'Costo',
  profit_margin: 'Margen (%)',
  is_on_sale: 'En oferta',
  sale_price: 'Precio de oferta',
  stock_quantity: 'Existencias',
  track_inventory_override: 'Control de inventario propio',
  service_duration_minutes: 'Duración del servicio (min)',
  service_pricing_type: 'Tipo de cobro del servicio',
  buffer_minutes: 'Tiempo entre citas (min)',
  preparation_time_minutes: 'Tiempo de preparación (min)',
};

const SERVICE_PRICING_TYPES = ['per_session', 'package', 'subscription'] as const;

function hasServiceFields(args: Record<string, any>): boolean {
  return (
    args.service_duration_minutes !== undefined ||
    args.service_pricing_type !== undefined ||
    args.buffer_minutes !== undefined ||
    args.preparation_time_minutes !== undefined
  );
}

/**
 * O-9..O-11 — Escrituras de variantes.
 *
 * Cadena de validación: `find_product`/`get_product` → write. El agente
 * resuelve el producto y la variante con los reads antes de proponer.
 */
export function createVariantTools(deps: VariantToolDeps): RegisteredTool[] {
  const { productsService } = deps;

  /** Datos ya validados para crear una variante. */
  interface NewVariant {
    dto: CreateProductVariantDto;
    productId: number;
    label: string;
    productName: string;
  }

  async function resolveNewVariant(
    args: Record<string, any>,
    storeId: number | undefined,
  ): Promise<Resolution<NewVariant>> {
    const label = 'Variante nueva';

    if (!storeId) {
      return failure(
        label,
        'Sin tienda en contexto: las variantes se crean siempre dentro de una tienda.',
      );
    }

    const productId = toPositiveInt(args.product_id);
    if (!productId) {
      return failure(
        label,
        'product_id inválido.',
        'Usa find_product para obtener el product_id antes de crear la variante.',
      );
    }

    const sku = cleanString(args.sku);
    if (!sku) {
      return failure(
        label,
        'El SKU de la variante es obligatorio y debe ser único dentro del producto.',
      );
    }

    const context =
      await productsService.findProductVariantWriteContextForAgent(productId);
    const product = context?.product;

    if (!product) {
      return failure(
        label,
        `No existe un producto con id ${productId} en esta tienda.`,
        'Usa find_product con el nombre o el SKU para obtener el product_id correcto.',
      );
    }

    const parentLabel = productLabel(product);

    // Réplica de `ProductVariantService.createVariant`: solo productos ACTIVOS
    // admiten variantes nuevas.
    if (product.state !== 'active') {
      return failure(
        parentLabel,
        `El producto está en estado "${product.state}": solo los productos activos admiten variantes nuevas.`,
      );
    }

    const existingSkus: any[] = context?.variants ?? [];
    if (
      existingSkus.some(
        (row) => String(row.sku).toLowerCase() === sku.toLowerCase(),
      )
    ) {
      return failure(
        parentLabel,
        `El SKU "${sku}" ya lo usa otra variante de "${product.name}".`,
        'Elige un SKU distinto para esta variante.',
      );
    }

    // Réplicas de las guardas de `createVariant`: insumo de receta y reservas
    // activas sobre la línea base. Mejor decirlo en la propuesta que fallar al
    // aplicar.
    if ((context?.recipeComponentCount ?? 0) > 0) {
      return failure(
        parentLabel,
        `Este producto se usa como insumo en ${context.recipeComponentCount} receta(s), así que no admite variantes.`,
        'Quítalo de esas recetas antes de variantizarlo.',
      );
    }

    if (context?.baseHasActiveReservations === true) {
      return failure(
        parentLabel,
        'El producto tiene reservas de stock activas (pedidos en curso apartando unidades) y el sistema bloquea agregarle variantes mientras existan.',
        'Despacha o cancela esos pedidos y vuelve a intentarlo.',
      );
    }

    const isService = product.product_type === 'service';
    if (!isService && hasServiceFields(args)) {
      return failure(
        parentLabel,
        'Los campos de servicio (duración, tipo de cobro, buffer, preparación) solo se aceptan en variantes de un producto de tipo servicio.',
      );
    }

    const servicePricingType = cleanString(args.service_pricing_type);
    if (
      servicePricingType &&
      !(SERVICE_PRICING_TYPES as readonly string[]).includes(servicePricingType)
    ) {
      return failure(
        parentLabel,
        `service_pricing_type "${servicePricingType}" no existe. Valores válidos: ${SERVICE_PRICING_TYPES.join(', ')}.`,
      );
    }

    const priceOverride = toNumberOrNull(args.price_override);
    if (priceOverride !== null && priceOverride <= 0) {
      return failure(
        parentLabel,
        'price_override debe ser mayor que cero: es el precio propio de la variante, sin impuestos.',
      );
    }

    const salePrice = toNumberOrNull(args.sale_price);
    const isOnSale = args.is_on_sale === true;
    if (isOnSale && (salePrice === null || salePrice <= 0)) {
      return failure(
        parentLabel,
        'La variante queda en oferta (is_on_sale) pero no trae un sale_price mayor que cero.',
      );
    }

    const stockQuantity = toNumberOrNull(args.stock_quantity) ?? 0;
    if (!Number.isInteger(stockQuantity) || stockQuantity < 0) {
      return failure(
        parentLabel,
        'stock_quantity debe ser un entero mayor o igual a cero.',
      );
    }

    const dto: Record<string, unknown> = {
      sku,
      ...(cleanString(args.name) && { name: cleanString(args.name) }),
      ...(cleanString(args.barcode) && { barcode: cleanString(args.barcode) }),
      ...(priceOverride !== null && { price_override: round2(priceOverride) }),
      ...(toNumberOrNull(args.cost_price) !== null && {
        cost_price: round2(toNumberOrNull(args.cost_price)!),
      }),
      ...(toNumberOrNull(args.profit_margin) !== null && {
        profit_margin: round2(toNumberOrNull(args.profit_margin)!),
      }),
      ...(typeof args.is_on_sale === 'boolean' && {
        is_on_sale: args.is_on_sale,
      }),
      ...(salePrice !== null && { sale_price: round2(salePrice) }),
      ...(stockQuantity > 0 && { stock_quantity: stockQuantity }),
      ...(args.attributes !== undefined &&
        typeof args.attributes === 'object' && {
          attributes: args.attributes,
        }),
      ...(typeof args.track_inventory_override === 'boolean' && {
        track_inventory_override: args.track_inventory_override,
      }),
      ...(toNumberOrNull(args.service_duration_minutes) !== null && {
        service_duration_minutes: Math.floor(
          toNumberOrNull(args.service_duration_minutes)!,
        ),
      }),
      ...(servicePricingType && { service_pricing_type: servicePricingType }),
      ...(toNumberOrNull(args.buffer_minutes) !== null && {
        buffer_minutes: Math.floor(toNumberOrNull(args.buffer_minutes)!),
      }),
      ...(toNumberOrNull(args.preparation_time_minutes) !== null && {
        preparation_time_minutes: Math.floor(
          toNumberOrNull(args.preparation_time_minutes)!,
        ),
      }),
    };

    const checked = toValidatedDto(CreateProductVariantDto, dto);
    if (!checked.ok) {
      return failure(parentLabel, checked.message);
    }

    const displayName =
      cleanString(args.name) ?? variantLabel({ sku, attributes: args.attributes, id: 0 });
    return {
      ok: true,
      value: {
        dto: checked.dto,
        productId,
        label: `${displayName} (SKU ${sku})`,
        productName: String(product.name),
      },
    };
  }

  /** Datos ya validados para editar una variante existente. */
  interface VariantEdit {
    dto: UpdateProductVariantDto;
    variantId: number;
    productId: number;
    label: string;
    changes: ToolPreview['changes'];
  }

  async function resolveVariantEdit(
    args: Record<string, any>,
    storeId: number | undefined,
  ): Promise<Resolution<VariantEdit>> {
    const label = 'Edición de variante';

    if (!storeId) {
      return failure(
        label,
        'Sin tienda en contexto: las variantes se editan siempre dentro de una tienda.',
      );
    }

    const variantId = toPositiveInt(args.product_variant_id);
    if (!variantId) {
      return failure(
        label,
        'product_variant_id inválido.',
        'Llama a get_product para ver las variantes válidas y sus product_variant_id.',
      );
    }

    const target =
      await productsService.findVariantWriteTargetForAgent(variantId);
    if (!target?.variant) {
      return failure(
        label,
        `No existe una variante con id ${variantId} en esta tienda.`,
        'Llama a get_product para ver las variantes válidas y sus product_variant_id.',
      );
    }

    const variant = target.variant;
    const product = target.product;
    const variantName = variantLabel(variant);
    const targetLabel = product
      ? `${productLabel(product)} — ${variantName}`
      : `${variantName} (SKU ${variant.sku})`;

    // Réplica de `ProductVariantService.updateVariant`: reservas activas sobre
    // la variante bloquean con `PROD_HAS_RESERVATIONS_001`.
    if (target.hasActiveReservations === true) {
      return failure(
        targetLabel,
        'La variante tiene reservas de stock activas (pedidos en curso apartando unidades) y el sistema bloquea editarla mientras existan.',
        'Despacha o cancela esos pedidos y vuelve a intentarlo.',
      );
    }

    const isService = product?.product_type === 'service';
    if (!isService && hasServiceFields(args)) {
      return failure(
        targetLabel,
        'Los campos de servicio (duración, tipo de cobro, buffer, preparación) solo se aceptan en variantes de un producto de tipo servicio.',
      );
    }

    const newSku = cleanString(args.sku);
    if (newSku) {
      const siblings: any[] = target.siblings ?? [];
      if (
        siblings.some(
          (row) => String(row.sku).toLowerCase() === newSku.toLowerCase(),
        )
      ) {
        return failure(
          targetLabel,
          `El SKU "${newSku}" ya lo usa otra variante de "${product?.name ?? 'este producto'}".`,
          'Elige un SKU distinto para esta variante.',
        );
      }
    }

    const servicePricingType = cleanString(args.service_pricing_type);
    if (
      servicePricingType &&
      !(SERVICE_PRICING_TYPES as readonly string[]).includes(servicePricingType)
    ) {
      return failure(
        targetLabel,
        `service_pricing_type "${servicePricingType}" no existe. Valores válidos: ${SERVICE_PRICING_TYPES.join(', ')}.`,
      );
    }

    const priceOverride = toNumberOrNull(args.price_override);
    if (priceOverride !== null && priceOverride <= 0) {
      return failure(
        targetLabel,
        'price_override debe ser mayor que cero: es el precio propio de la variante, sin impuestos.',
      );
    }

    // Se arma el DTO solo con los campos que viajaron: semántica PATCH.
    const dto: Record<string, unknown> = {};
    if (newSku) dto.sku = newSku;
    if (cleanString(args.name)) dto.name = cleanString(args.name);
    if (cleanString(args.barcode)) dto.barcode = cleanString(args.barcode);
    if (args.attributes !== undefined && typeof args.attributes === 'object')
      dto.attributes = args.attributes;
    if (priceOverride !== null) dto.price_override = round2(priceOverride);
    if (toNumberOrNull(args.cost_price) !== null)
      dto.cost_price = round2(toNumberOrNull(args.cost_price)!);
    if (toNumberOrNull(args.profit_margin) !== null)
      dto.profit_margin = round2(toNumberOrNull(args.profit_margin)!);
    if (typeof args.is_on_sale === 'boolean') dto.is_on_sale = args.is_on_sale;
    if (toNumberOrNull(args.sale_price) !== null)
      dto.sale_price = round2(toNumberOrNull(args.sale_price)!);
    if (toNumberOrNull(args.stock_quantity) !== null) {
      const quantity = toNumberOrNull(args.stock_quantity)!;
      if (!Number.isInteger(quantity) || quantity < 0) {
        return failure(
          targetLabel,
          'stock_quantity debe ser un entero mayor o igual a cero.',
        );
      }
      dto.stock_quantity = quantity;
    }
    if (
      args.track_inventory_override === null ||
      typeof args.track_inventory_override === 'boolean'
    ) {
      dto.track_inventory_override = args.track_inventory_override;
    }
    if (toNumberOrNull(args.service_duration_minutes) !== null)
      dto.service_duration_minutes = Math.floor(
        toNumberOrNull(args.service_duration_minutes)!,
      );
    if (servicePricingType) dto.service_pricing_type = servicePricingType;
    if (toNumberOrNull(args.buffer_minutes) !== null)
      dto.buffer_minutes = Math.floor(toNumberOrNull(args.buffer_minutes)!);
    if (toNumberOrNull(args.preparation_time_minutes) !== null)
      dto.preparation_time_minutes = Math.floor(
        toNumberOrNull(args.preparation_time_minutes)!,
      );

    if (!Object.keys(dto).length) {
      return failure(
        targetLabel,
        'No hay cambios: indica al menos un campo a editar (sku, name, price_override, sale_price, stock_quantity…).',
      );
    }

    const checked = toValidatedDto(UpdateProductVariantDto, dto);
    if (!checked.ok) {
      return failure(targetLabel, checked.message);
    }

    const current: Record<string, unknown> = {
      sku: variant.sku,
      name: variant.name ?? null,
      barcode: variant.barcode ?? null,
      attributes: variant.attributes ?? null,
      price_override:
        variant.price_override != null ? Number(variant.price_override) : null,
      cost_price: variant.cost_price != null ? Number(variant.cost_price) : null,
      profit_margin:
        variant.profit_margin != null ? Number(variant.profit_margin) : null,
      is_on_sale: variant.is_on_sale === true,
      sale_price: variant.sale_price != null ? Number(variant.sale_price) : null,
      stock_quantity: variant.stock_quantity ?? 0,
      track_inventory_override: variant.track_inventory_override ?? null,
      service_duration_minutes: variant.service_duration_minutes ?? null,
      service_pricing_type: variant.service_pricing_type ?? null,
      buffer_minutes: variant.buffer_minutes ?? null,
      preparation_time_minutes: variant.preparation_time_minutes ?? null,
    };

    const changes: ToolPreview['changes'] = Object.entries(checked.dto).map(
      ([field, to]) => ({
        field,
        label: VARIANT_FIELD_LABELS[field] ?? field,
        from: current[field] ?? null,
        to: to as unknown,
      }),
    );

    return {
      ok: true,
      value: {
        dto: checked.dto,
        variantId,
        productId: variant.product_id,
        label: targetLabel,
        changes,
      },
    };
  }

  /** Datos ya validados para eliminar una variante. */
  interface VariantRemoval {
    variantId: number;
    productId: number;
    label: string;
    sku: string;
  }

  async function resolveVariantRemoval(
    args: Record<string, any>,
    storeId: number | undefined,
  ): Promise<Resolution<VariantRemoval>> {
    const label = 'Eliminación de variante';

    if (!storeId) {
      return failure(
        label,
        'Sin tienda en contexto: las variantes se eliminan siempre dentro de una tienda.',
      );
    }

    const variantId = toPositiveInt(args.product_variant_id);
    if (!variantId) {
      return failure(
        label,
        'product_variant_id inválido.',
        'Llama a get_product para ver las variantes válidas y sus product_variant_id.',
      );
    }

    const target =
      await productsService.findVariantWriteTargetForAgent(variantId);
    if (!target?.variant) {
      return failure(
        label,
        `No existe una variante con id ${variantId} en esta tienda.`,
        'Llama a get_product para ver las variantes válidas y sus product_variant_id.',
      );
    }

    const variant = target.variant;
    const product = target.product;
    const targetLabel = product
      ? `${productLabel(product)} — ${variantLabel(variant)}`
      : `${variantLabel(variant)} (SKU ${variant.sku})`;

    // Réplica de `ProductVariantService.removeVariant`: reservas activas
    // bloquean la eliminación.
    if (target.hasActiveReservations === true) {
      return failure(
        targetLabel,
        'La variante tiene reservas de stock activas (pedidos en curso apartando unidades) y no se puede eliminar mientras existan.',
        'Despacha o cancela esos pedidos y vuelve a intentarlo.',
      );
    }

    // Réplica del bloqueo `PROD_VARIANT_HAS_STOCK_001` de `removeVariant`:
    // borrar una variante con existencias destruiría inventario sin ajuste ni
    // movimiento que lo explique. Se dice en la propuesta; el servicio lo
    // vuelve a exigir al aplicar.
    const onHand = target.onHandUnits ?? 0;
    if (onHand > 0) {
      return failure(
        targetLabel,
        `La variante tiene ${onHand} unidad(es) en existencia y no se puede eliminar: el borrado destruiría ese inventario sin dejar rastro (PROD_VARIANT_HAS_STOCK_001).`,
        'Ajusta su stock a 0 con adjust_stock y vuelve a intentarlo.',
      );
    }

    return {
      ok: true,
      value: {
        variantId,
        productId: variant.product_id,
        label: targetLabel,
        sku: String(variant.sku),
      },
    };
  }

  return [
    // ─── O-9: create_variant ──────────────────────────────────────────
    {
      name: 'create_variant',
      version: '1',
      domain: 'products',
      requiresConfirmation: true,
      description:
        'Crea una variante (presentación, talla, color, paquete) dentro de un producto existente. El SKU es obligatorio y único dentro del producto; el precio propio (price_override) es opcional: sin él la variante hereda el precio del producto. Requiere product_id: obtenlo con find_product. No sirve para productos que son insumo de una receta ni para productos con reservas activas.',
      parameters: {
        type: 'object',
        properties: {
          product_id: {
            type: 'number',
            description: 'ID del producto padre, obtenido con find_product.',
          },
          sku: {
            type: 'string',
            description:
              'SKU de la variante. Obligatorio y único dentro del producto.',
          },
          name: {
            type: 'string',
            description:
              'Nombre visible de la variante ("Talla M", "Caja x12"). Si se omite se muestra el SKU.',
          },
          barcode: { type: 'string', description: 'Código de barras.' },
          price_override: {
            type: 'number',
            description:
              'Precio propio SIN impuestos. Si se omite, la variante hereda el precio del producto.',
          },
          cost_price: {
            type: 'number',
            description: 'Costo unitario de la variante.',
          },
          profit_margin: {
            type: 'number',
            description: 'Margen de ganancia en porcentaje sobre el costo.',
          },
          is_on_sale: {
            type: 'boolean',
            description: 'Si la variante queda en promoción.',
          },
          sale_price: {
            type: 'number',
            description:
              'Precio de oferta SIN impuestos. Obligatorio si is_on_sale es true.',
          },
          stock_quantity: {
            type: 'number',
            description:
              'Existencias iniciales en la bodega por defecto. Entero mayor o igual a cero.',
          },
          attributes: {
            type: 'object',
            description:
              'Atributos libres de la variante (talla, color, presentación…).',
          },
          track_inventory_override: {
            type: 'boolean',
            description:
              'Control de inventario propio de la variante. Si se omite hereda el del producto.',
          },
          service_duration_minutes: {
            type: 'number',
            description:
              'Solo servicios: duración de esta opción en minutos (hereda del producto si se omite).',
          },
          service_pricing_type: {
            type: 'string',
            enum: [...SERVICE_PRICING_TYPES],
            description: 'Solo servicios: per_session, package o subscription.',
          },
          buffer_minutes: {
            type: 'number',
            description:
              'Solo servicios: tiempo entre citas en minutos (hereda del producto si se omite).',
          },
          preparation_time_minutes: {
            type: 'number',
            description:
              'Solo servicios: tiempo de preparación en minutos (hereda del producto si se omite).',
          },
        },
        required: ['product_id', 'sku'],
      },
      requiredPermissions: ['store:products:create'],
      preview: async (args, context) => {
        const resolved = await resolveNewVariant(args, context.store_id);
        if (!resolved.ok) {
          return previewError(
            resolved.label,
            [resolved.message, resolved.nextStep].filter(Boolean).join(' '),
            'products',
          );
        }

        const { dto, label, productName } = resolved.value;
        const changes: ToolPreview['changes'] = [
          { field: 'sku', label: 'SKU', from: null, to: dto.sku },
        ];
        if (dto.name) {
          changes.push({
            field: 'name',
            label: 'Nombre',
            from: null,
            to: dto.name,
          });
        }
        if (dto.price_override !== undefined) {
          changes.push({
            field: 'price_override',
            label: 'Precio propio (sin impuestos)',
            from: null,
            to: dto.price_override,
          });
        } else {
          changes.push({
            field: 'price_override',
            label: 'Precio propio (sin impuestos)',
            from: null,
            to: '(hereda el del producto)',
          });
        }
        if (dto.stock_quantity) {
          changes.push({
            field: 'stock_quantity',
            label: 'Existencias iniciales (bodega por defecto)',
            from: 0,
            to: dto.stock_quantity,
          });
        }

        return {
          status: 'ok',
          target: `${label} en ${productName}`,
          changes,
          message: `Se crea la variante dentro del producto "${productName}".`,
          domain: 'products',
        };
      },
      handler: async (args, context) => {
        try {
          // Re-verificación: otro usuario pudo crear el mismo SKU entre la
          // propuesta y la confirmación, o el producto pudo cambiar de estado.
          const resolved = await resolveNewVariant(args, context.store_id);
          if (!resolved.ok) {
            return toolError(resolved.message, resolved.nextStep);
          }

          const created: any = await productsService.createVariant(
            resolved.value.productId,
            resolved.value.dto,
          );

          return JSON.stringify({
            summary: `Variante "${resolved.value.label}" creada en "${resolved.value.productName}".`,
            data: {
              product_id: resolved.value.productId,
              product_variant_id: created?.id,
              sku: created?.sku ?? resolved.value.dto.sku,
              name: created?.name ?? null,
            },
            next_step:
              'Si la variante lleva stock en varias bodegas, muévelo con manage_stock_transfers.',
          });
        } catch (error) {
          const { code, message } = describeError(error);
          return toolError(
            `No se pudo crear la variante${code ? ` (${code})` : ''}: ${message}`,
          );
        }
      },
    },

    // ─── O-10: update_variant ─────────────────────────────────────────
    {
      name: 'update_variant',
      version: '1',
      domain: 'products',
      requiresConfirmation: true,
      description:
        'Edita una variante existente: SKU, nombre, precio propio, oferta, existencias, atributos u opciones de servicio. Solo se cambian los campos enviados (semántica PATCH). Requiere product_variant_id: obtenlo con get_product. No sirve para variantes con reservas activas; cambiar existencias de una variante repartida en varias bodegas se rechaza (hazlo desde ajustes o transferencias).',
      parameters: {
        type: 'object',
        properties: {
          product_variant_id: {
            type: 'number',
            description:
              'ID de la variante, obtenido con get_product.',
          },
          sku: {
            type: 'string',
            description: 'Nuevo SKU. Debe seguir siendo único en el producto.',
          },
          name: { type: 'string', description: 'Nuevo nombre visible.' },
          barcode: { type: 'string', description: 'Nuevo código de barras.' },
          attributes: {
            type: 'object',
            description: 'Nuevos atributos libres (talla, color…).',
          },
          price_override: {
            type: 'number',
            description: 'Nuevo precio propio SIN impuestos.',
          },
          cost_price: {
            type: 'number',
            description: 'Nuevo costo unitario.',
          },
          profit_margin: {
            type: 'number',
            description: 'Nuevo margen en porcentaje sobre el costo.',
          },
          is_on_sale: {
            type: 'boolean',
            description: 'Si la variante queda en promoción.',
          },
          sale_price: {
            type: 'number',
            description: 'Nuevo precio de oferta SIN impuestos.',
          },
          stock_quantity: {
            type: 'number',
            description:
              'Total físico que queda después del ajuste. Entero mayor o igual a cero; se rechaza si la variante tiene stock en varias bodegas.',
          },
          track_inventory_override: {
            type: 'boolean',
            description:
              'Control de inventario propio. null (o ausente) hereda el del producto.',
          },
          service_duration_minutes: {
            type: 'number',
            description: 'Solo servicios: duración de esta opción en minutos.',
          },
          service_pricing_type: {
            type: 'string',
            enum: [...SERVICE_PRICING_TYPES],
            description: 'Solo servicios: per_session, package o subscription.',
          },
          buffer_minutes: {
            type: 'number',
            description: 'Solo servicios: tiempo entre citas en minutos.',
          },
          preparation_time_minutes: {
            type: 'number',
            description: 'Solo servicios: tiempo de preparación en minutos.',
          },
        },
        required: ['product_variant_id'],
      },
      requiredPermissions: ['store:products:update'],
      preview: async (args, context) => {
        const resolved = await resolveVariantEdit(args, context.store_id);
        if (!resolved.ok) {
          return previewError(
            resolved.label,
            [resolved.message, resolved.nextStep].filter(Boolean).join(' '),
            'products',
          );
        }

        return {
          status: 'ok',
          target: resolved.value.label,
          changes: resolved.value.changes,
          domain: 'products',
        };
      },
      handler: async (args, context) => {
        try {
          // Re-verificación: la variante pudo cambiar (u otro usuario pudo
          // tomar el mismo SKU) entre la propuesta y la confirmación.
          const resolved = await resolveVariantEdit(args, context.store_id);
          if (!resolved.ok) {
            return toolError(resolved.message, resolved.nextStep);
          }

          await productsService.updateVariant(
            resolved.value.variantId,
            resolved.value.dto,
          );

          return JSON.stringify({
            summary: `${resolved.value.label}: ${resolved.value.changes.length} campo(s) actualizado(s).`,
            data: {
              product_id: resolved.value.productId,
              product_variant_id: resolved.value.variantId,
              updated_fields: resolved.value.changes.map(
                (change) => change.field,
              ),
            },
          });
        } catch (error) {
          const { code, message } = describeError(error);
          return toolError(
            `No se pudo editar la variante${code ? ` (${code})` : ''}: ${message}`,
          );
        }
      },
    },

    // ─── O-11: delete_variant ─────────────────────────────────────────
    {
      name: 'delete_variant',
      version: '1',
      domain: 'products',
      requiresConfirmation: true,
      description:
        'Elimina una variante de forma definitiva (no se puede deshacer). Solo procede si la variante NO tiene existencias ni reservas activas: con stock, la eliminación se bloquea (PROD_VARIANT_HAS_STOCK_001) y hay que ajustar a 0 primero con adjust_stock. Requiere product_variant_id: obtenlo con get_product.',
      parameters: {
        type: 'object',
        properties: {
          product_variant_id: {
            type: 'number',
            description: 'ID de la variante, obtenido con get_product.',
          },
        },
        required: ['product_variant_id'],
      },
      requiredPermissions: ['store:products:delete'],
      preview: async (args, context) => {
        const resolved = await resolveVariantRemoval(args, context.store_id);
        if (!resolved.ok) {
          return previewError(
            resolved.label,
            [resolved.message, resolved.nextStep].filter(Boolean).join(' '),
            'products',
          );
        }

        return {
          status: 'warning',
          target: resolved.value.label,
          changes: [
            {
              field: 'deleted',
              label: 'Variante a eliminar',
              from: `${resolved.value.label} (SKU ${resolved.value.sku})`,
              to: '(eliminada)',
            },
          ],
          message:
            'Esta acción no se puede deshacer: el histórico (pedidos, facturas, movimientos) se reasigna al producto base y la variante desaparece.',
          domain: 'products',
        };
      },
      handler: async (args, context) => {
        try {
          // Re-verificación: entre la propuesta y la confirmación la variante
          // pudo recibir stock o reservas; el servicio lo vuelve a exigir.
          const resolved = await resolveVariantRemoval(args, context.store_id);
          if (!resolved.ok) {
            return toolError(resolved.message, resolved.nextStep);
          }

          await productsService.removeVariant(resolved.value.variantId);

          return JSON.stringify({
            summary: `Variante "${resolved.value.label}" eliminada.`,
            data: {
              product_id: resolved.value.productId,
              product_variant_id: resolved.value.variantId,
              sku: resolved.value.sku,
            },
          });
        } catch (error) {
          const { code, message } = describeError(error);
          return toolError(
            `No se pudo eliminar la variante${code ? ` (${code})` : ''}: ${message}`,
            code === 'PROD_VARIANT_HAS_STOCK_001'
              ? 'Ajusta su stock a 0 con adjust_stock y vuelve a intentarlo.'
              : undefined,
          );
        }
      },
    },
  ];
}
