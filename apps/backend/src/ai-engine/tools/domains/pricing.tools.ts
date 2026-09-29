import { HttpException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { RegisteredTool, ToolPreview } from '../interfaces/tool.interface';
import { VendixHttpException } from '../../../common/errors';
import { PriceTiersService } from '../../../domains/store/price-tiers/price-tiers.service';
import { ProductsService } from '../../../domains/store/products/products.service';
import {
  CreatePriceTierDto,
  UpdatePriceTierDto,
  UpsertProductPriceTierOverrideDto,
} from '../../../domains/store/price-tiers/dto';

export interface PricingToolDeps {
  priceTiersService: PriceTiersService;
  productsService: ProductsService;
}

// ─────────────────────────────────────────────────────────────────────────────
// Doctrina de escritura (misma que `products.tools.ts`, copiada a propósito:
// este factory no puede importar sus helpers privados).
//
// - El `preview` es proyección, no transacción: el `handler` re-resuelve y
//   re-verifica sus precondiciones desde cero.
// - Un `preview` con `status: 'error'` no acuña token: la ejecución muere ahí.
// - Los handlers NO lanzan: devuelven `{error, next_step}` en español. Un
//   `throw` saldría como `AI_AGENT_003` opaco.
// - Toda escritura pasa por el servicio dueño. Cero `prisma.` en este archivo.
// - Multi-tarifa ⊕ variantes: presentación de venta (`sale_unit`) y variantes
//   son excluyentes; la tool lo pre-verifica igual que el servicio.
// - Nunca `final_price`: es un calculado de lectura, no un campo persistido.
// ─────────────────────────────────────────────────────────────────────────────

/** Resultado uniforme de una resolución previa a escribir. */
type WriteResolution<T> =
  | { ok: true; value: T }
  | { ok: false; label: string; message: string; nextStep?: string };

function writeFailure(
  label: string,
  message: string,
  nextStep?: string,
): { ok: false; label: string; message: string; nextStep?: string } {
  return { ok: false, label, message, nextStep };
}

/** `ToolPreview` de error: el registry aborta sin acuñar token. */
function writePreviewError(
  label: string,
  message: string,
  domain: string,
): ToolPreview {
  return { status: 'error', target: label, changes: [], message, domain };
}

/** Respuesta de fallo de un handler. Nunca se lanza: el modelo debe poder leerla. */
function writeToolError(message: string, nextStep?: string): string {
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
function toValidatedWriteDto<T extends object>(
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
function describeWriteError(error: unknown): { code?: string; message: string } {
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

function toWritePositiveInt(value: unknown): number | null {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) return null;
  return parsed;
}

function toWriteNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Texto limpio o `undefined`. Nunca cadena vacía: eso confunde a los DTOs. */
function cleanWriteString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : undefined;
}

/** Campos que una tarifa sabe escribir, con su etiqueta para la propuesta. */
const TIER_FIELD_LABELS: Record<string, string> = {
  name: 'Nombre',
  kind: 'Eje',
  code: 'Código',
  description: 'Descripción',
  discount_percentage: 'Descuento (%)',
  is_active: 'Activa',
  is_default: 'Predeterminada',
  is_package_unit: 'Vende por paquete',
  units_per_package: 'Unidades por paquete',
  sort_order: 'Orden',
};

/** Campos del override producto+tarifa, con su etiqueta para la propuesta. */
const OVERRIDE_FIELD_LABELS: Record<string, string> = {
  override_price: 'Precio del paquete',
  override_units_per_package: 'Empaque propio (unidades)',
  override_profit_margin: 'Margen de la presentación (%)',
  is_default: 'Presentación por defecto',
  barcode: 'Código de barras',
};

const TIER_KINDS = ['customer_tier', 'sale_unit'] as const;

function tierKindLabel(kind: string): string {
  return kind === 'sale_unit' ? 'presentación de venta' : 'nivel de cliente';
}

/**
 * O-12, O-13 — Escrituras de multi-tarifa.
 *
 * Cadena de validación: `get_product`/`get_product_pricing` (muestran las
 * tarifas y si el producto tiene variantes) → write. La tool re-verifica la
 * exclusión multi-tarifa ⊕ variantes en cada resolución porque el servicio
 * la rechaza en el punto de escritura.
 */
export function createPricingTools(deps: PricingToolDeps): RegisteredTool[] {
  const { priceTiersService, productsService } = deps;

  // ─── O-12 manage_price_tiers ──────────────────────────────────────────

  type TierAction = 'create' | 'update' | 'deactivate' | 'restore';

  interface TierChange {
    action: TierAction;
    label: string;
    tierId?: number;
    dto?: CreatePriceTierDto | UpdatePriceTierDto;
    changes: ToolPreview['changes'];
    message?: string;
  }

  async function loadTier(tierId: number): Promise<any | null> {
    try {
      return await priceTiersService.findOne(tierId);
    } catch {
      return null;
    }
  }

  async function resolveTierChange(
    args: Record<string, any>,
    storeId: number | undefined,
  ): Promise<WriteResolution<TierChange>> {
    const label = 'Tarifa de precios';

    if (!storeId) {
      return writeFailure(
        label,
        'Sin tienda en contexto: las tarifas se gestionan siempre dentro de una tienda.',
      );
    }

    const action = String(args.action ?? '');
    if (!['create', 'update', 'deactivate', 'restore'].includes(action)) {
      return writeFailure(
        label,
        `action "${action}" inválida. Usa create, update, deactivate o restore.`,
      );
    }
    const tierAction = action as TierAction;

    if (tierAction === 'create') {
      const name = cleanWriteString(args.name);
      if (!name) {
        return writeFailure(
          label,
          'name es obligatorio para crear una tarifa ("Bulto x50", "Mayorista").',
        );
      }

      const kind = cleanWriteString(args.kind);
      if (kind && !(TIER_KINDS as readonly string[]).includes(kind)) {
        return writeFailure(
          label,
          `kind "${kind}" no existe. Valores válidos: ${TIER_KINDS.join(', ')}.`,
        );
      }

      const dto: Record<string, unknown> = { name };
      if (kind) dto.kind = kind;
      const code = cleanWriteString(args.code);
      if (code) dto.code = code;
      const description = cleanWriteString(args.description);
      if (description) dto.description = description;
      if (toWriteNumber(args.discount_percentage) !== null)
        dto.discount_percentage = toWriteNumber(args.discount_percentage);
      if (typeof args.is_active === 'boolean') dto.is_active = args.is_active;
      if (typeof args.is_default === 'boolean')
        dto.is_default = args.is_default;
      if (typeof args.is_package_unit === 'boolean')
        dto.is_package_unit = args.is_package_unit;
      if (toWriteNumber(args.units_per_package) !== null)
        dto.units_per_package = Math.floor(
          toWriteNumber(args.units_per_package)!,
        );
      if (toWriteNumber(args.sort_order) !== null)
        dto.sort_order = Math.floor(toWriteNumber(args.sort_order)!);

      const checked = toValidatedWriteDto(CreatePriceTierDto, dto);
      if (!checked.ok) {
        return writeFailure(`Tarifa "${name}"`, checked.message);
      }

      const changes: ToolPreview['changes'] = Object.entries(checked.dto).map(
        ([field, to]) => ({
          field,
          label: TIER_FIELD_LABELS[field] ?? field,
          from: null,
          to: to as unknown,
        }),
      );

      return {
        ok: true,
        value: {
          action: tierAction,
          label: `Tarifa "${name}"`,
          dto: checked.dto,
          changes,
          message:
            'Al confirmar se crea la tarifa en la tienda; los productos la adoptan con set_product_tier_override.',
        },
      };
    }

    const tierId = toWritePositiveInt(args.price_tier_id);
    if (!tierId) {
      return writeFailure(
        label,
        'price_tier_id inválido: para update, deactivate y restore se necesita el id de la tarifa.',
      );
    }

    const tier = await loadTier(tierId);
    if (!tier) {
      return writeFailure(
        label,
        `No existe una tarifa con id ${tierId} en esta tienda.`,
      );
    }
    const targetLabel = `Tarifa "${tier.name}"`;

    if (tierAction === 'deactivate') {
      if (tier.is_active === false) {
        return writeFailure(
          targetLabel,
          'La tarifa ya está desactivada: no hay nada que cambiar.',
        );
      }
      return {
        ok: true,
        value: {
          action: tierAction,
          label: targetLabel,
          tierId,
          changes: [
            {
              field: 'is_active',
              label: 'Activa',
              from: true,
              to: false,
            },
          ],
          message:
            'Los productos que la tenían habilitada dejan de venderse en ella. Reversible con restore.',
        },
      };
    }

    if (tierAction === 'restore') {
      if (tier.is_active === true) {
        return writeFailure(
          targetLabel,
          'La tarifa ya está activa: no hay nada que restaurar.',
        );
      }
      return {
        ok: true,
        value: {
          action: tierAction,
          label: targetLabel,
          tierId,
          changes: [
            {
              field: 'is_active',
              label: 'Activa',
              from: false,
              to: true,
            },
          ],
        },
      };
    }

    // update: semántica PATCH, solo viajan los campos enviados.
    const dto: Record<string, unknown> = {};
    const name = cleanWriteString(args.name);
    if (name) dto.name = name;
    const kind = cleanWriteString(args.kind);
    if (kind) {
      if (!(TIER_KINDS as readonly string[]).includes(kind)) {
        return writeFailure(
          targetLabel,
          `kind "${kind}" no existe. Valores válidos: ${TIER_KINDS.join(', ')}.`,
        );
      }
      dto.kind = kind;
    }
    const code = cleanWriteString(args.code);
    if (code !== undefined) dto.code = code;
    const description = cleanWriteString(args.description);
    if (description !== undefined) dto.description = description;
    if (toWriteNumber(args.discount_percentage) !== null)
      dto.discount_percentage = toWriteNumber(args.discount_percentage);
    if (typeof args.is_active === 'boolean') dto.is_active = args.is_active;
    if (typeof args.is_default === 'boolean')
      dto.is_default = args.is_default;
    if (typeof args.is_package_unit === 'boolean')
      dto.is_package_unit = args.is_package_unit;
    if (toWriteNumber(args.units_per_package) !== null)
      dto.units_per_package = Math.floor(toWriteNumber(args.units_per_package)!);
    if (toWriteNumber(args.sort_order) !== null)
      dto.sort_order = Math.floor(toWriteNumber(args.sort_order)!);

    if (!Object.keys(dto).length) {
      return writeFailure(
        targetLabel,
        'No hay cambios: indica al menos un campo a editar (name, discount_percentage, units_per_package…).',
      );
    }

    const checked = toValidatedWriteDto(UpdatePriceTierDto, dto);
    if (!checked.ok) {
      return writeFailure(targetLabel, checked.message);
    }

    const current: Record<string, unknown> = {
      name: tier.name,
      kind: tier.kind,
      code: tier.code ?? null,
      description: tier.description ?? null,
      discount_percentage:
        tier.discount_percentage !== null &&
        tier.discount_percentage !== undefined
          ? Number(tier.discount_percentage)
          : null,
      is_active: tier.is_active === true,
      is_default: tier.is_default === true,
      is_package_unit: tier.is_package_unit === true,
      units_per_package: tier.units_per_package ?? null,
      sort_order: tier.sort_order ?? null,
    };

    const changes: ToolPreview['changes'] = Object.entries(checked.dto).map(
      ([field, to]) => ({
        field,
        label: TIER_FIELD_LABELS[field] ?? field,
        from: current[field] ?? null,
        to: to as unknown,
      }),
    );

    return { ok: true, value: { action: tierAction, label: targetLabel, tierId, dto: checked.dto, changes } };
  }

  // ─── O-13 set_product_tier_override ───────────────────────────────────

  type OverrideAction = 'set' | 'clear';

  interface TierOverrideChange {
    action: OverrideAction;
    label: string;
    productId: number;
    tierId: number;
    variantId: number | null;
    dto?: UpsertProductPriceTierOverrideDto;
    changes: ToolPreview['changes'];
    message?: string;
  }

  async function resolveTierOverrideChange(
    args: Record<string, any>,
    storeId: number | undefined,
  ): Promise<WriteResolution<TierOverrideChange>> {
    const label = 'Precio por tarifa';

    if (!storeId) {
      return writeFailure(
        label,
        'Sin tienda en contexto: los precios por tarifa se fijan siempre dentro de una tienda.',
      );
    }

    const rawAction =
      args.action === undefined ? 'set' : String(args.action);
    if (rawAction !== 'set' && rawAction !== 'clear') {
      return writeFailure(
        label,
        `action "${rawAction}" inválida. Usa set (fijar precio) o clear (volver a la regla general).`,
      );
    }
    const action = rawAction as OverrideAction;

    const productId = toWritePositiveInt(args.product_id);
    if (!productId) {
      return writeFailure(
        label,
        'product_id inválido.',
        'Usa find_product para obtener el product_id antes de fijar el precio.',
      );
    }

    const tierId = toWritePositiveInt(args.price_tier_id);
    if (!tierId) {
      return writeFailure(
        label,
        'price_tier_id inválido: indica la tarifa a la que aplica el precio.',
        'Llama a get_product_pricing para ver las tarifas del producto.',
      );
    }

    const tier = await loadTier(tierId);
    if (!tier) {
      return writeFailure(
        label,
        `No existe una tarifa con id ${tierId} en esta tienda.`,
      );
    }

    const variantContext =
      await productsService.findProductVariantWriteContextForAgent(productId);
    const product = variantContext?.product;
    if (!product) {
      return writeFailure(
        label,
        `No existe un producto con id ${productId} en esta tienda.`,
        'Usa find_product con el nombre o el SKU para obtener el product_id correcto.',
      );
    }

    const productLabel = product.sku
      ? `${product.name} (${product.sku})`
      : String(product.name);
    const targetLabel = `${productLabel} — ${tier.name}`;

    // Multi-tarifa ⊕ variantes: una presentación de venta sobre un producto
    // con variantes queda prohibida acá igual que en el servicio (el punto
    // de escritura la rechaza con PRODUCT_TIERS_VARIANTS_EXCLUSIVE).
    const variantCount = (variantContext?.variants ?? []).length;
    if (tier.kind === 'sale_unit' && variantCount > 0) {
      return writeFailure(
        targetLabel,
        `Este producto tiene ${variantCount} variante(s). Multi-tarifa y variantes son excluyentes: elimina las variantes para poder venderlo en la presentación "${tier.name}".`,
      );
    }

    let variantId: number | null = null;
    if (args.variant_id !== undefined) {
      const parsed = toWritePositiveInt(args.variant_id);
      if (!parsed) {
        return writeFailure(targetLabel, 'variant_id inválido.');
      }
      const belongs = (variantContext?.variants ?? []).some(
        (row: any) => row.id === parsed,
      );
      if (!belongs) {
        return writeFailure(
          targetLabel,
          `La variante ${parsed} no pertenece al producto ${productId}.`,
          'Llama a get_product para ver las variantes válidas y sus product_variant_id.',
        );
      }
      variantId = parsed;
    }

    const existingOverrides: any[] =
      await priceTiersService.findOverridesByProduct(productId);
    const existing = (existingOverrides ?? []).find(
      (row: any) =>
        Number(row.price_tier_id) === tierId &&
        (row.variant_id ?? null) === variantId,
    );

    if (action === 'clear') {
      if (!existing) {
        return writeFailure(
          targetLabel,
          'El producto no tiene precio propio en esta tarifa: no hay nada que quitar (ya rige la regla general).',
        );
      }
      return {
        ok: true,
        value: {
          action,
          label: targetLabel,
          productId,
          tierId,
          variantId,
          changes: [
            {
              field: 'override_price',
              label: 'Precio propio',
              from:
                existing.override_price !== null &&
                existing.override_price !== undefined
                  ? Number(existing.override_price)
                  : null,
              to: null,
            },
          ],
          message:
            'Al confirmar se quita el precio propio y vuelve a regir la regla general de la tarifa.',
        },
      };
    }

    // set: al menos un campo tiene que viajar.
    const dto: Record<string, unknown> = {};
    if (variantId !== null) dto.variant_id = variantId;
    if (toWriteNumber(args.override_price) !== null)
      dto.override_price = toWriteNumber(args.override_price);
    if (toWriteNumber(args.override_units_per_package) !== null)
      dto.override_units_per_package = Math.floor(
        toWriteNumber(args.override_units_per_package)!,
      );
    if (toWriteNumber(args.override_profit_margin) !== null)
      dto.override_profit_margin = toWriteNumber(args.override_profit_margin);
    if (typeof args.is_default === 'boolean') dto.is_default = args.is_default;
    if (args.barcode !== undefined) {
      // Cadena vacía = borrar el código (contrato del servicio).
      if (typeof args.barcode !== 'string') {
        return writeFailure(targetLabel, 'barcode debe ser texto.');
      }
      dto.barcode = args.barcode;
    }

    const sentFields = Object.keys(dto).filter(
      (field) => field !== 'variant_id',
    );
    if (!sentFields.length) {
      return writeFailure(
        targetLabel,
        'No hay cambios: indica al menos un campo (override_price, override_units_per_package, override_profit_margin, is_default, barcode).',
      );
    }

    // Réplica del servicio: solo una unidad de venta puede ser la
    // presentación por defecto (PRICE_TIER_DEFAULT_NOT_SALE_UNIT).
    if (dto.is_default === true && tier.kind !== 'sale_unit') {
      return writeFailure(
        targetLabel,
        `Solo una tarifa de tipo sale_unit puede ser presentación por defecto; "${tier.name}" es ${tierKindLabel(tier.kind)}.`,
      );
    }

    const checked = toValidatedWriteDto(UpsertProductPriceTierOverrideDto, dto);
    if (!checked.ok) {
      return writeFailure(targetLabel, checked.message);
    }

    const current: Record<string, unknown> = {
      override_price:
        existing?.override_price !== null &&
        existing?.override_price !== undefined
          ? Number(existing.override_price)
          : null,
      override_units_per_package:
        existing?.override_units_per_package ?? null,
      override_profit_margin:
        existing?.override_profit_margin !== null &&
        existing?.override_profit_margin !== undefined
          ? Number(existing.override_profit_margin)
          : null,
      is_default: existing?.is_default ?? false,
      barcode: existing?.barcode ?? null,
    };

    const changes: ToolPreview['changes'] = Object.entries(checked.dto)
      .filter(([field]) => field !== 'variant_id')
      .map(([field, to]) => ({
        field,
        label: OVERRIDE_FIELD_LABELS[field] ?? field,
        from: current[field] ?? null,
        to: to as unknown,
      }));

    return {
      ok: true,
      value: {
        action,
        label: targetLabel,
        productId,
        tierId,
        variantId,
        dto: checked.dto,
        changes,
        message:
          tier.is_active === false
            ? `Ojo: la tarifa "${tier.name}" está desactivada; el precio solo aplicará al reactivarla.`
            : checked.dto.override_price !== undefined &&
                checked.dto.override_profit_margin !== undefined
              ? 'Mandaste precio y margen juntos: gana el precio y el margen se recalcula solo.'
              : undefined,
      },
    };
  }

  return [
    // ─── Tool 1: manage_price_tiers (O-12, write) ────────────────────────
    {
      name: 'manage_price_tiers',
      version: '1',
      domain: 'pricing',
      requiresConfirmation: true,
      description:
        'Crea (create), edita (update), desactiva (deactivate) o reactiva (restore) tarifas de la tienda: presentaciones de venta como "Bulto x50" (kind sale_unit) o niveles por tipo de cliente como "Mayorista" (kind customer_tier). El precio es descuento porcentual sobre el base salvo que el producto tenga precio propio (eso se fija con set_product_tier_override). Nunca acepta final_price: ese es un calculado de lectura.',
      parameters: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: ['create', 'update', 'deactivate', 'restore'],
            description:
              'create: crear. update: editar. deactivate: desactivar. restore: reactivar.',
          },
          price_tier_id: {
            type: 'number',
            description:
              'ID de la tarifa. Obligatorio para update, deactivate y restore.',
          },
          name: {
            type: 'string',
            description:
              'Nombre visible de la tarifa: "Bulto x50", "Mayorista". Obligatorio para create.',
          },
          kind: {
            type: 'string',
            enum: ['customer_tier', 'sale_unit'],
            description:
              'sale_unit = EN QUÉ PRESENTACIÓN se vende (bulto, caja). customer_tier = A QUIÉN se le vende (mayorista).',
          },
          code: { type: 'string', description: 'Código corto interno.' },
          description: {
            type: 'string',
            description: 'Explicación de para qué sirve la tarifa.',
          },
          discount_percentage: {
            type: 'number',
            description:
              'Descuento 0-100 sobre el precio base. Regla general: solo aplica donde el producto no tenga precio propio.',
          },
          is_active: {
            type: 'boolean',
            description: 'Si la tarifa está activa (update).',
          },
          is_default: {
            type: 'boolean',
            description: 'Si es la tarifa preseleccionada de la tienda.',
          },
          is_package_unit: {
            type: 'boolean',
            description:
              'No hace falta mandarlo: el servidor lo deriva de units_per_package (verdadero con 2 o más).',
          },
          units_per_package: {
            type: 'number',
            description:
              'Cuántas unidades trae un paquete de esta presentación (mínimo 2). Vender 2 paquetes descuenta el doble de stock.',
          },
          sort_order: {
            type: 'number',
            description: 'Orden de aparición en las listas. Menor primero.',
          },
        },
        required: ['action'],
      },
      // Unión de los verbos que cubre (precedente manage_purchase_orders):
      // create→create, update/restore→update, deactivate→delete.
      requiredPermissions: [
        'store:price-tiers:create',
        'store:price-tiers:update',
        'store:price-tiers:delete',
      ],
      preview: async (args, context) => {
        const resolved = await resolveTierChange(args, context.store_id);
        if (!resolved.ok) {
          return writePreviewError(
            resolved.label,
            [resolved.message, resolved.nextStep].filter(Boolean).join(' '),
            'pricing',
          );
        }

        return {
          status: 'ok',
          target: resolved.value.label,
          changes: resolved.value.changes,
          ...(resolved.value.message && { message: resolved.value.message }),
          domain: 'pricing',
        };
      },
      handler: async (args, context) => {
        try {
          // Re-verificación: la tarifa pudo cambiar (u otro usuario pudo
          // tomar el mismo nombre) entre la propuesta y la confirmación.
          const resolved = await resolveTierChange(args, context.store_id);
          if (!resolved.ok) {
            return writeToolError(resolved.message, resolved.nextStep);
          }
          const change = resolved.value;

          if (change.action === 'create') {
            const created = await priceTiersService.create(change.dto as any);
            return JSON.stringify({
              summary: `${change.label}: tarifa creada.`,
              data: {
                price_tier_id: (created as any)?.id ?? null,
                name: (created as any)?.name ?? null,
              },
            });
          }

          if (change.action === 'update') {
            await priceTiersService.update(change.tierId!, change.dto as any);
            return JSON.stringify({
              summary: `${change.label}: ${change.changes.length} campo(s) actualizado(s).`,
              data: {
                price_tier_id: change.tierId,
                updated_fields: change.changes.map(
                  (entry) => entry.field,
                ),
              },
            });
          }

          if (change.action === 'deactivate') {
            await priceTiersService.softDelete(change.tierId!);
            return JSON.stringify({
              summary: `${change.label}: desactivada.`,
              data: { price_tier_id: change.tierId, is_active: false },
            });
          }

          await priceTiersService.restore(change.tierId!);
          return JSON.stringify({
            summary: `${change.label}: reactivada.`,
            data: { price_tier_id: change.tierId, is_active: true },
          });
        } catch (error) {
          const { code, message } = describeWriteError(error);
          return writeToolError(
            `No se pudo gestionar la tarifa${code ? ` (${code})` : ''}: ${message}`,
          );
        }
      },
    },

    // ─── Tool 2: set_product_tier_override (O-13, write) ─────────────────
    {
      name: 'set_product_tier_override',
      version: '1',
      domain: 'pricing',
      requiresConfirmation: true,
      description:
        'Fija para un producto el precio, el empaque, el margen, el código de barras o la presentación por defecto de una tarifa concreta (set), o quita el precio propio para volver a la regla general (clear). El precio es el del PAQUETE ENTERO, no el de la unidad suelta. Multi-tarifa y variantes son excluyentes: una presentación de venta (sale_unit) sobre un producto con variantes no procede. Requiere product_id (obtenlo con find_product) y price_tier_id (míralo en get_product_pricing). Nunca acepta final_price.',
      parameters: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: ['set', 'clear'],
            description:
              'set: fijar precio (por defecto). clear: quitar el precio propio y volver a la regla general.',
          },
          product_id: {
            type: 'number',
            description: 'ID del producto, obtenido con find_product.',
          },
          price_tier_id: {
            type: 'number',
            description:
              'ID de la tarifa (míralo en get_product_pricing).',
          },
          variant_id: {
            type: 'number',
            description:
              'Variante a la que aplica el precio. Si se omite, aplica al producto entero.',
          },
          override_price: {
            type: 'number',
            description:
              'Precio del PAQUETE ENTERO en esta presentación: un bulto de 50 kg a $100.000 lleva 100000. Gana sobre el descuento de la tarifa.',
          },
          override_units_per_package: {
            type: 'number',
            description:
              'Cuántas unidades trae el paquete PARA ESTE PRODUCTO, cuando difiere del empaque general de la tarifa (mínimo 2).',
          },
          override_profit_margin: {
            type: 'number',
            description:
              'Margen de la presentación en porcentaje sobre el costo del paquete. Si se manda junto con override_price, gana el precio.',
          },
          is_default: {
            type: 'boolean',
            description:
              'Deja esta presentación como la que rige por defecto para el producto. Solo vale para tarifas sale_unit.',
          },
          barcode: {
            type: 'string',
            description:
              'Código de barras de esta presentación. Cadena vacía para borrarlo.',
          },
        },
        required: ['product_id', 'price_tier_id'],
      },
      requiredPermissions: ['store:price-tiers:update'],
      preview: async (args, context) => {
        const resolved = await resolveTierOverrideChange(
          args,
          context.store_id,
        );
        if (!resolved.ok) {
          return writePreviewError(
            resolved.label,
            [resolved.message, resolved.nextStep].filter(Boolean).join(' '),
            'pricing',
          );
        }

        return {
          status: 'ok',
          target: resolved.value.label,
          changes: resolved.value.changes,
          ...(resolved.value.message && { message: resolved.value.message }),
          domain: 'pricing',
        };
      },
      handler: async (args, context) => {
        try {
          // Re-verificación: la tarifa, el producto o sus variantes pudieron
          // cambiar entre la propuesta y la confirmación.
          const resolved = await resolveTierOverrideChange(
            args,
            context.store_id,
          );
          if (!resolved.ok) {
            return writeToolError(resolved.message, resolved.nextStep);
          }
          const change = resolved.value;

          if (change.action === 'clear') {
            await priceTiersService.removeProductOverride(
              change.productId,
              change.tierId,
              change.variantId ?? undefined,
            );
            return JSON.stringify({
              summary: `${change.label}: precio propio eliminado, rige la regla general.`,
              data: {
                product_id: change.productId,
                price_tier_id: change.tierId,
                variant_id: change.variantId,
                cleared: true,
              },
            });
          }

          await priceTiersService.upsertProductOverride(
            change.productId,
            change.tierId,
            change.dto!,
          );
          return JSON.stringify({
            summary: `${change.label}: precio por tarifa guardado.`,
            data: {
              product_id: change.productId,
              price_tier_id: change.tierId,
              variant_id: change.variantId,
              updated_fields: change.changes.map((entry) => entry.field),
            },
          });
        } catch (error) {
          const { code, message } = describeWriteError(error);
          return writeToolError(
            `No se pudo guardar el precio por tarifa${code ? ` (${code})` : ''}: ${message}`,
          );
        }
      },
    },
  ];
}
