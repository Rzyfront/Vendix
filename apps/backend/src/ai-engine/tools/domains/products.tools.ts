import { HttpException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { RegisteredTool, ToolPreview } from '../interfaces/tool.interface';
import { VendixHttpException } from '../../../common/errors';
import { ProductsService } from '../../../domains/store/products/products.service';
import { UpdateProductDto } from '../../../domains/store/products/dto';
import { PriceResolverService } from '../../../domains/store/products/services/price-resolver.service';
import { SettingsService } from '../../../domains/store/settings/settings.service';
import { resolvePricedUnits } from '../../../domains/store/products/services/tier-margin.util';

export interface ProductToolDeps {
  productsService: ProductsService;
  priceResolver: PriceResolverService;
  settingsService: SettingsService;
}

/**
 * Bound for the in-memory pass of `find_product`. It runs only when the SQL
 * pass came back empty and exists because Postgres `ILIKE` is case-insensitive
 * but not accent-insensitive: "cafe con leche" never matches "Café con leche".
 */
const FUZZY_SCAN_CAP = 800;

/** Hard ceiling on variants embedded per product, so a 200-variant catalog product cannot blow the context window. */
const MAX_VARIANTS_INLINE = 25;

function deburr(value: unknown): string {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function normalize(value: unknown): string {
  return deburr(value).toLowerCase().trim();
}

function clampLimit(raw: unknown, fallback: number, max: number): number {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(Math.floor(parsed), max);
}

/** Prisma `Decimal` → plain number. `null`/`undefined` collapse to `null`. */
function toNumberOrNull(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function toNumber(value: unknown): number {
  return toNumberOrNull(value) ?? 0;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function taxBreakdown(
  assignments: any[] | undefined | null,
): Array<{ name: string; rate_pct: number }> {
  const rows: Array<{ name: string; rate_pct: number }> = [];
  for (const assignment of assignments ?? []) {
    for (const tax of assignment?.tax_categories?.tax_rates ?? []) {
      rows.push({
        name: tax.name,
        rate_pct: round2(toNumber(tax.rate) * 100),
      });
    }
  }
  return rows;
}

/**
 * Effective inventory tracking for a product/variant pair.
 * `track_inventory_override` is authoritative when set; `null` inherits.
 * See `vendix-product-variants`: this is the ONLY input that decides whether
 * stock is meaningful for a variant. A variant is never hidden or downgraded
 * just because its stock is 0.
 */
function effectiveTracking(product: any, variant?: any): boolean {
  const override = variant?.track_inventory_override;
  return override === null || override === undefined
    ? product.track_inventory === true
    : override === true;
}

function parseAttributes(attributes: unknown): Record<string, string> | null {
  if (!attributes || typeof attributes !== 'object') return null;
  const entries = Object.entries(attributes as Record<string, unknown>).map(
    ([key, value]) => [key, String(value)] as const,
  );
  return entries.length ? Object.fromEntries(entries) : null;
}

/** Human label for a variant when it has no explicit name (falls back to its attributes, then its SKU). */
function variantLabel(variant: any): string {
  if (variant.name) return String(variant.name);
  const attributes = parseAttributes(variant.attributes);
  if (attributes) {
    return Object.entries(attributes)
      .map(([key, value]) => `${key}: ${value}`)
      .join(', ');
  }
  return String(variant.sku ?? `variante ${variant.id}`);
}

const PRODUCT_STATES = ['active', 'inactive', 'archived'] as const;
const PRODUCT_TYPES = ['physical', 'service', 'prepared'] as const;

// ─────────────────────────────────────────────────────────────────────────────
// Doctrina de escritura de O-1 `update_product` (misma que `writes.tools.ts`:
// el `preview` es proyección, no transacción; el `handler` re-verifica; los
// handlers NO lanzan, devuelven `{error, next_step}`; cero `prisma.` aquí).
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

/** Texto limpio o `undefined`. Nunca cadena vacía: eso confunde a los DTOs. */
function cleanWriteString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : undefined;
}

/** Campos que `update_product` sabe escribir, con su etiqueta para la propuesta. */
const PRODUCT_EDIT_FIELD_LABELS: Record<string, string> = {
  name: 'Nombre',
  description: 'Descripción',
  sku: 'SKU',
  barcode: 'Código de barras',
  base_price: 'Precio base (sin impuestos)',
  cost_price: 'Costo',
  profit_margin: 'Margen (%)',
  is_on_sale: 'En oferta',
  sale_price: 'Precio de oferta',
  track_inventory: 'Control de inventario',
  is_sellable: 'Vendible',
  available_for_ecommerce: 'Publicado en tienda en línea',
  is_featured: 'Destacado',
  allow_pos_price_override: 'Precio manual en POS',
  brand_id: 'Marca',
};

export function createProductTools(deps: ProductToolDeps): RegisteredTool[] {
  const { productsService, priceResolver, settingsService } = deps;

  async function storeCurrency(): Promise<string | undefined> {
    try {
      return await settingsService.getStoreCurrency();
    } catch {
      // Currency is decoration here; never fail a catalog answer over it.
      return undefined;
    }
  }

  /**
   * Full card for a bounded set of product ids, preserving the ranking order
   * the caller resolved. Everything the agent needs to either answer or chain
   * another tool: identity, price with tax, and stock that respects effective
   * tracking at the product AND variant level.
   */
  async function hydrateProductCards(orderedIds: number[]) {
    if (!orderedIds.length) return [];

    const rows: any[] =
      await productsService.findProductCardsForAgent(
        orderedIds,
        MAX_VARIANTS_INLINE,
      );

    const byId = new Map<number, any>(rows.map((row) => [row.id, row]));

    return orderedIds
      .map((id) => byId.get(id))
      .filter(Boolean)
      .map((product) => {
        const taxRate = productsService.getEffectiveTaxRate(product);
        const variantCount = product._count?.product_variants ?? 0;
        const hasVariants = variantCount > 0;

        const availableByVariant = new Map<number, number>();
        let baseAvailable = 0;
        for (const level of product.stock_levels ?? []) {
          const quantity = level.quantity_available ?? 0;
          if (level.product_variant_id == null) baseAvailable += quantity;
          else {
            availableByVariant.set(
              level.product_variant_id,
              (availableByVariant.get(level.product_variant_id) ?? 0) +
                quantity,
            );
          }
        }
        // With variants the product aggregate sums ONLY variant rows: a base
        // row on a variant product is orphan stock nobody can sell (QUI-486).
        const productAvailable = hasVariants
          ? Array.from(availableByVariant.values()).reduce((a, b) => a + b, 0)
          : baseAvailable;

        const netPrice =
          product.is_on_sale && toNumberOrNull(product.sale_price)
            ? toNumber(product.sale_price)
            : toNumber(product.base_price);

        const variants = (product.product_variants ?? []).map(
          (variant: any) => {
            const tracked = effectiveTracking(product, variant);
            const stock = availableByVariant.get(variant.id) ?? 0;
            const resolved = priceResolver.resolvePrice(
              {
                product: {
                  base_price: toNumber(product.base_price),
                  is_on_sale: product.is_on_sale === true,
                  sale_price: toNumberOrNull(product.sale_price),
                  track_inventory: product.track_inventory === true,
                },
                variant: {
                  price_override: toNumberOrNull(variant.price_override),
                  is_on_sale: variant.is_on_sale === true,
                  sale_price: toNumberOrNull(variant.sale_price),
                  track_inventory_override:
                    variant.track_inventory_override ?? null,
                },
              },
              taxRate,
            );

            return {
              product_variant_id: variant.id,
              label: variantLabel(variant),
              sku: variant.sku,
              barcode: variant.barcode ?? null,
              attributes: parseAttributes(variant.attributes),
              net_price: round2(resolved.unitPrice),
              unit_price: round2(resolved.unitPriceWithTax),
              inventory_tracked: tracked,
              // `null` means "this variant does not keep stock", which is NOT
              // the same as "0 units". Never treat it as unavailable.
              available_stock: tracked ? stock : null,
              is_available: !tracked || stock > 0,
            };
          },
        );

        return {
          product_id: product.id,
          name: product.name,
          sku: product.sku ?? null,
          barcode: product.barcode ?? null,
          brand: product.brands?.name ?? null,
          state: product.state,
          product_type: product.product_type,
          is_sellable: product.is_sellable,
          requires_booking: product.requires_booking === true,
          stock_unit: product.stock_unit ?? null,
          net_price: round2(netPrice),
          unit_price: round2(productsService.calculateFinalPrice(product)),
          tax_rate_pct: round2(taxRate * 100),
          inventory_tracked: product.track_inventory === true,
          available_stock:
            product.track_inventory === true ? productAvailable : null,
          has_variants: hasVariants,
          variant_count: variantCount,
          variants_truncated: variantCount > variants.length || undefined,
          requires_variant_selection: hasVariants,
          variants: hasVariants ? variants : undefined,
          has_multiple_price_tiers: product.has_multiple_price_tiers === true,
        };
      });
  }

  /** Datos ya validados para editar un producto existente (O-1). */
  interface ProductEdit {
    dto: UpdateProductDto;
    productId: number;
    label: string;
    changes: ToolPreview['changes'];
  }

  async function resolveProductEdit(
    args: Record<string, any>,
    storeId: number | undefined,
  ): Promise<WriteResolution<ProductEdit>> {
    const label = 'Edición de producto';

    if (!storeId) {
      return writeFailure(
        label,
        'Sin tienda en contexto: los productos se editan siempre dentro de una tienda.',
      );
    }

    const productId = toWritePositiveInt(args.product_id);
    if (!productId) {
      return writeFailure(
        label,
        'product_id inválido.',
        'Usa find_product para obtener el product_id antes de editar.',
      );
    }

    // `final_price` es un calculado de lectura (precio + impuestos asignados),
    // no un campo persistido: el DTO ni siquiera lo declara y el servicio lo
    // ignoraría en silencio. Se rechaza en voz alta para que el modelo corrija
    // el precio que sí se persiste (`base_price` o `sale_price`).
    if (args.final_price !== undefined) {
      return writeFailure(
        label,
        'final_price no se puede editar: es el precio calculado con impuestos que muestran las lecturas.',
        'Para cambiar lo que paga el cliente edita base_price (precio normal) o sale_price con is_on_sale (oferta).',
      );
    }

    let product: any;
    try {
      // `findOne` excluye archivados: un producto archivado cae al mismo error
      // guiado que uno inexistente.
      product = await productsService.findOne(productId);
    } catch {
      return writeFailure(
        label,
        `No existe un producto activo con id ${productId} en esta tienda (los archivados no se editan).`,
        'Usa find_product con el nombre o el SKU para obtener el product_id correcto.',
      );
    }

    const targetLabel = product.sku
      ? `${product.name} (${product.sku})`
      : String(product.name);

    // Se arma el DTO solo con los campos que viajaron: semántica PATCH.
    const dto: Record<string, unknown> = {};
    const name = cleanWriteString(args.name);
    if (name) {
      if (name.length < 2 || name.length > 255) {
        return writeFailure(
          targetLabel,
          'El nombre del producto debe tener entre 2 y 255 caracteres.',
        );
      }
      dto.name = name;
    }
    const description = cleanWriteString(args.description);
    if (description) dto.description = description;
    const sku = cleanWriteString(args.sku);
    if (sku) dto.sku = sku;
    const barcode = cleanWriteString(args.barcode);
    if (barcode) dto.barcode = barcode;
    if (toNumberOrNull(args.base_price) !== null) {
      const basePrice = toNumberOrNull(args.base_price)!;
      if (basePrice < 0) {
        return writeFailure(targetLabel, 'El precio base no puede ser negativo.');
      }
      dto.base_price = round2(basePrice);
    }
    if (toNumberOrNull(args.cost_price) !== null) {
      const costPrice = toNumberOrNull(args.cost_price)!;
      if (costPrice < 0) {
        return writeFailure(targetLabel, 'El costo no puede ser negativo.');
      }
      dto.cost_price = round2(costPrice);
    }
    if (toNumberOrNull(args.profit_margin) !== null) {
      const margin = toNumberOrNull(args.profit_margin)!;
      if (margin < 0) {
        return writeFailure(targetLabel, 'El margen no puede ser negativo.');
      }
      dto.profit_margin = round2(margin);
    }
    if (typeof args.is_on_sale === 'boolean') dto.is_on_sale = args.is_on_sale;
    if (toNumberOrNull(args.sale_price) !== null) {
      dto.sale_price = round2(toNumberOrNull(args.sale_price)!);
    }
    if (typeof args.track_inventory === 'boolean')
      dto.track_inventory = args.track_inventory;
    if (typeof args.is_sellable === 'boolean')
      dto.is_sellable = args.is_sellable;
    if (typeof args.available_for_ecommerce === 'boolean')
      dto.available_for_ecommerce = args.available_for_ecommerce;
    if (typeof args.is_featured === 'boolean')
      dto.is_featured = args.is_featured;
    if (typeof args.allow_pos_price_override === 'boolean')
      dto.allow_pos_price_override = args.allow_pos_price_override;
    if (args.brand_id !== undefined) {
      const brandId = toWritePositiveInt(args.brand_id);
      if (!brandId) {
        return writeFailure(targetLabel, 'brand_id inválido.');
      }
      dto.brand_id = brandId;
    }

    if (!Object.keys(dto).length) {
      return writeFailure(
        targetLabel,
        'No hay cambios: indica al menos un campo a editar (name, base_price, sale_price, sku…).',
      );
    }

    // Regla de `vendix-product-pricing`: la oferta solo tiene sentido por
    // debajo del precio normal y con un precio de oferta vigente.
    const effectiveOnSale =
      (dto.is_on_sale as boolean | undefined) ?? product.is_on_sale === true;
    const effectiveSale =
      (dto.sale_price as number | undefined) ??
      toNumberOrNull(product.sale_price);
    const effectiveBase =
      (dto.base_price as number | undefined) ?? toNumber(product.base_price);
    if (effectiveOnSale) {
      if (effectiveSale === null || effectiveSale <= 0) {
        return writeFailure(
          targetLabel,
          'El producto queda en oferta pero no tiene un sale_price mayor que cero.',
          'Envía sale_price junto con is_on_sale, o apaga la oferta.',
        );
      }
      if (effectiveBase > 0 && effectiveSale >= effectiveBase) {
        return writeFailure(
          targetLabel,
          `El precio de oferta (${effectiveSale}) debe ser menor que el precio normal (${effectiveBase}).`,
        );
      }
    }

    const checked = toValidatedWriteDto(UpdateProductDto, dto);
    if (!checked.ok) {
      return writeFailure(targetLabel, checked.message);
    }

    const current: Record<string, unknown> = {
      name: product.name,
      description: product.description ?? null,
      sku: product.sku ?? null,
      barcode: product.barcode ?? null,
      base_price: toNumberOrNull(product.base_price),
      cost_price: toNumberOrNull(product.cost_price),
      profit_margin: toNumberOrNull(product.profit_margin),
      is_on_sale: product.is_on_sale === true,
      sale_price: toNumberOrNull(product.sale_price),
      track_inventory: product.track_inventory === true,
      is_sellable: product.is_sellable,
      available_for_ecommerce: product.available_for_ecommerce,
      is_featured: product.is_featured,
      allow_pos_price_override: product.allow_pos_price_override,
      brand_id: product.brand_id ?? product.brand?.id ?? null,
    };

    const changes: ToolPreview['changes'] = Object.entries(checked.dto).map(
      ([field, to]) => ({
        field,
        label: PRODUCT_EDIT_FIELD_LABELS[field] ?? field,
        from: current[field] ?? null,
        to: to as unknown,
      }),
    );

    return {
      ok: true,
      value: { dto: checked.dto, productId, label: targetLabel, changes },
    };
  }

  return [
    // ─── Tool 1: find_product ────────────────────────────────────────
    {
      name: 'find_product',
      version: '1',
      domain: 'products',
      readOnly: true,
      description:
        'Resuelve UN producto del catálogo a partir de cómo lo nombraría una persona: "la coca cola de litro", un SKU, o un código de barras. Es el primer paso obligatorio de cualquier flujo que necesite un product_id (consultar stock, ajustar inventario, ver precios): ninguna otra herramienta adivina el producto por su nombre. Devuelve precio con impuestos, existencias y, si el producto maneja variantes, TODAS sus variantes con su product_variant_id — en ese caso hay que elegir variante antes de operar. Si hay varias coincidencias las devuelve todas para que preguntes al usuario cuál es; no elijas tú.',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description:
              'Nombre, marca, SKU o código de barras tal como lo dijo el usuario. Acepta texto parcial y sin tildes.',
          },
          limit: {
            type: 'number',
            description: 'Máximo de coincidencias. Por defecto 10, tope 25.',
          },
          include_archived: {
            type: 'boolean',
            description:
              'Incluir productos archivados. Por defecto false; úsalo solo si el usuario pregunta expresamente por uno dado de baja.',
          },
        },
        required: ['query'],
      },
      requiredPermissions: ['store:products:read'],
      handler: async (args, context) => {
        if (!context.store_id) {
          return JSON.stringify({
            error:
              'Sin tienda en contexto: el catálogo se resuelve siempre dentro de una tienda.',
          });
        }

        const rawQuery = String(args.query ?? '').trim();
        if (rawQuery.length < 2) {
          return JSON.stringify({
            error:
              'La búsqueda necesita al menos 2 caracteres. Pide al usuario el nombre, el SKU o el código de barras del producto.',
          });
        }

        const limit = clampLimit(args.limit, 10, 25);
        const includeArchived = args.include_archived === true;
        const base: any = includeArchived ? {} : { state: { not: 'archived' } };

        const compact = rawQuery.replace(/\s+/g, '');
        const codeLike = /^[0-9A-Za-z._-]{4,}$/.test(compact);

        // Ordered strategies: an exact code beats a name guess, always.
        const attempts: Array<{ matchedBy: string; where: any }> = [];

        if (codeLike) {
          attempts.push({
            matchedBy: 'codigo_de_barras',
            where: {
              ...base,
              OR: [
                { barcode: compact },
                { product_variants: { some: { barcode: compact } } },
              ],
            },
          });
          attempts.push({
            matchedBy: 'sku',
            where: {
              ...base,
              OR: [
                { sku: { equals: compact, mode: 'insensitive' } },
                {
                  product_variants: {
                    some: { sku: { equals: compact, mode: 'insensitive' } },
                  },
                },
              ],
            },
          });
        }

        // AND of per-token ORs: "coca cola litro" demands the three words, each
        // free to land on the name, the SKU, the brand or a variant.
        const tokens = rawQuery
          .split(/\s+/)
          .map((token) => token.trim())
          .filter((token) => token.length >= 2)
          .slice(0, 6);

        const tokenConditions = (tokens.length ? tokens : [rawQuery]).map(
          (token) => {
            const variants = Array.from(new Set([token, deburr(token)]));
            return {
              OR: variants.flatMap((value) => [
                { name: { contains: value, mode: 'insensitive' } },
                { sku: { contains: value, mode: 'insensitive' } },
                { brands: { name: { contains: value, mode: 'insensitive' } } },
                {
                  product_variants: {
                    some: {
                      OR: [
                        { name: { contains: value, mode: 'insensitive' } },
                        { sku: { contains: value, mode: 'insensitive' } },
                      ],
                    },
                  },
                },
              ]),
            };
          },
        );

        attempts.push({
          matchedBy: 'nombre',
          where: { ...base, AND: tokenConditions },
        });

        let matchedBy = 'nombre';
        let matches: any[] = [];

        for (const attempt of attempts) {
          const found: any[] = await productsService.findProductIdsForAgent(
            attempt.where,
            limit + 1,
          );
          if (found.length) {
            matchedBy = attempt.matchedBy;
            matches = found;
            break;
          }
        }

        let usedFuzzyPass = false;
        let scanCapReached = false;

        if (!matches.length) {
          usedFuzzyPass = true;
          const pool: any[] = await productsService.findProductFuzzyPoolForAgent(
            base,
            FUZZY_SCAN_CAP,
          );
          scanCapReached = pool.length === FUZZY_SCAN_CAP;

          const normalizedTokens = normalize(rawQuery)
            .split(/\s+/)
            .filter(Boolean);

          matches = pool
            .filter((product) => {
              const haystack = normalize(
                [product.name, product.sku, product.barcode]
                  .filter(Boolean)
                  .join(' '),
              );
              return normalizedTokens.every((token) =>
                haystack.includes(token),
              );
            })
            .slice(0, limit + 1);
        }

        const truncated = matches.length > limit;
        const ids = matches.slice(0, limit).map((row) => row.id);
        const products = await hydrateProductCards(ids);

        if (!products.length) {
          return JSON.stringify({
            query: rawQuery,
            match_count: 0,
            products: [],
            scanned_cap_reached: scanCapReached || undefined,
            next_step:
              'Ningún producto coincide. Si tienes semantic_search disponible y el usuario lo describió de forma indirecta, pruébala; si no, pídele el SKU o el código de barras. No inventes un product_id.',
          });
        }

        const needsVariantPick = products.some(
          (product) => product.requires_variant_selection,
        );

        return JSON.stringify({
          query: rawQuery,
          matched_by: usedFuzzyPass ? `${matchedBy}_aproximado` : matchedBy,
          match_count: products.length,
          truncated: truncated || undefined,
          scanned_cap_reached: scanCapReached || undefined,
          ambiguous: products.length > 1,
          currency: await storeCurrency(),
          products,
          next_step:
            products.length > 1
              ? 'Hay más de un producto posible. Muéstraselos al usuario (nombre + SKU + precio + existencias) y pídele que confirme cuál antes de seguir.'
              : needsVariantPick
                ? 'El producto maneja variantes: pide al usuario cuál (presentación, talla, color…) y usa su product_variant_id en las siguientes herramientas.'
                : 'Ya tienes el product_id para encadenar get_product, get_product_pricing, check_stock_availability o create_stock_adjustment.',
          notes: [
            'available_stock en null significa que ese producto o variante NO lleva control de inventario; no es lo mismo que cero unidades y no impide venderlo.',
          ],
        });
      },
    },

    // ─── Tool 2: get_product ─────────────────────────────────────────
    {
      name: 'get_product',
      version: '1',
      domain: 'products',
      readOnly: true,
      description:
        'Ficha completa de UN producto ya identificado: precios, impuestos, categorías, marca, existencias por bodega/local, variantes y configuración (control de inventario, seriales, reserva de servicios, unidades de medida). Úsala cuando el usuario pida el detalle de un producto concreto. Requiere product_id: si solo tienes el nombre, llama primero a find_product.',
      parameters: {
        type: 'object',
        properties: {
          product_id: {
            type: 'number',
            description: 'ID del producto, obtenido con find_product.',
          },
        },
        required: ['product_id'],
      },
      requiredPermissions: ['store:products:read'],
      handler: async (args, context) => {
        if (!context.store_id) {
          return JSON.stringify({
            error:
              'Sin tienda en contexto: la ficha de producto se lee siempre dentro de una tienda.',
          });
        }

        const productId = Number(args.product_id);
        if (!Number.isInteger(productId) || productId <= 0) {
          return JSON.stringify({
            error:
              'product_id inválido. Resuelve el producto con find_product antes de pedir su ficha.',
          });
        }

        let product: any;
        try {
          product = await productsService.findOne(productId);
        } catch {
          return JSON.stringify({
            error: `No existe un producto activo con id ${productId} en esta tienda (los archivados no se devuelven).`,
            next_step:
              'Usa find_product con el nombre o el SKU para obtener el product_id correcto.',
          });
        }

        const taxRate = productsService.getEffectiveTaxRate(product);
        const allVariants = product.product_variants ?? [];
        const hasVariants = allVariants.length > 0;

        const availableByVariant = new Map<number, number>();
        for (const level of product.stock_levels ?? []) {
          if (level.product_variant_id == null) continue;
          availableByVariant.set(
            level.product_variant_id,
            (availableByVariant.get(level.product_variant_id) ?? 0) +
              (level.quantity_available ?? 0),
          );
        }

        const variants = allVariants
          .slice(0, MAX_VARIANTS_INLINE)
          .map((variant: any) => {
            const tracked = effectiveTracking(product, variant);
            const stock = availableByVariant.get(variant.id) ?? 0;
            const resolved = priceResolver.resolvePrice(
              {
                product: {
                  base_price: toNumber(product.base_price),
                  is_on_sale: product.is_on_sale === true,
                  sale_price: toNumberOrNull(product.sale_price),
                  track_inventory: product.track_inventory === true,
                },
                variant: {
                  price_override: toNumberOrNull(variant.price_override),
                  is_on_sale: variant.is_on_sale === true,
                  sale_price: toNumberOrNull(variant.sale_price),
                  track_inventory_override:
                    variant.track_inventory_override ?? null,
                },
              },
              taxRate,
            );

            return {
              product_variant_id: variant.id,
              label: variantLabel(variant),
              sku: variant.sku,
              barcode: variant.barcode ?? null,
              attributes: parseAttributes(variant.attributes),
              net_price: round2(resolved.unitPrice),
              unit_price: round2(resolved.unitPriceWithTax),
              price_source: resolved.source,
              inventory_tracked: tracked,
              available_stock: tracked ? stock : null,
              is_available: !tracked || stock > 0,
              service_duration_minutes:
                variant.service_duration_minutes ?? undefined,
              buffer_minutes: variant.buffer_minutes ?? undefined,
              preparation_time_minutes:
                variant.preparation_time_minutes ?? undefined,
            };
          });

        const isService = product.product_type === 'service';

        return JSON.stringify({
          product: {
            product_id: product.id,
            name: product.name,
            sku: product.sku ?? null,
            barcode: product.barcode ?? null,
            description: product.description ?? null,
            brand: product.brand?.name ?? null,
            categories: (product.categories ?? [])
              .map((category: any) => category?.name)
              .filter(Boolean),
            state: product.state,
            product_type: product.product_type,
            is_sellable: product.is_sellable,
            is_ingredient: product.is_ingredient,
            is_combo: product.is_combo,
            is_batch_produced: product.is_batch_produced,
            available_for_ecommerce: product.available_for_ecommerce,
            is_featured: product.is_featured,
          },
          pricing: {
            currency: await storeCurrency(),
            cost_price: toNumberOrNull(product.cost_price),
            base_price: toNumber(product.base_price),
            is_on_sale: product.is_on_sale === true,
            sale_price: toNumberOrNull(product.sale_price),
            profit_margin_pct: toNumberOrNull(product.profit_margin),
            tax_rate_pct: round2(taxRate * 100),
            taxes: taxBreakdown(product.product_tax_assignments),
            unit_price: round2(toNumber(product.final_price)),
            has_multiple_price_tiers: product.has_multiple_price_tiers === true,
            note: 'unit_price incluye impuestos. Para tarifas por volumen/empaque usa get_product_pricing.',
          },
          inventory: {
            tracked: product.track_inventory === true,
            stock_unit: product.stock_unit ?? null,
            purchase_unit: product.purchase_unit ?? null,
            purchase_to_stock_factor: product.purchase_to_stock_factor ?? null,
            available:
              product.track_inventory === true
                ? (product.total_stock_available ?? 0)
                : null,
            reserved:
              product.track_inventory === true
                ? (product.total_stock_reserved ?? 0)
                : null,
            reorder_point: product.reorder_point ?? null,
            low_stock_threshold: product.low_stock_threshold ?? null,
            requires_serial_numbers: product.requires_serial_numbers === true,
            by_location: (product.stock_by_location ?? []).map(
              (location: any) => ({
                location_id: location.location_id,
                location: location.location_name,
                type: location.location_type,
                available: location.available,
                reserved: location.reserved,
              }),
            ),
            note:
              product.track_inventory === true
                ? undefined
                : 'Este producto no lleva control de inventario: no hay existencias que consultar y se puede vender siempre.',
          },
          variants: {
            has_variants: hasVariants,
            count: allVariants.length,
            truncated: allVariants.length > variants.length || undefined,
            requires_variant_selection: hasVariants,
            items: variants,
          },
          service: isService
            ? {
                requires_booking: product.requires_booking === true,
                booking_mode: product.booking_mode ?? null,
                duration_minutes: product.service_duration_minutes ?? null,
                buffer_minutes: product.buffer_minutes ?? null,
                modality: product.service_modality ?? null,
                pricing_type: product.service_pricing_type ?? null,
              }
            : undefined,
        });
      },
    },

    // ─── Tool 3: list_products ───────────────────────────────────────
    {
      name: 'list_products',
      version: '1',
      domain: 'products',
      readOnly: true,
      description:
        'Recorre el catálogo con filtros: texto, categoría, marca, tipo (físico/servicio/preparado), estado y si lleva control de inventario. Úsala para preguntas de conjunto ("qué servicios ofrezco", "cuántos productos tengo inactivos", "muéstrame lo de la categoría bebidas"). Para encontrar UN producto concreto usa find_product, y para saber qué está por agotarse usa get_low_stock_alerts. Devuelve páginas cortas e informa el total real.',
      parameters: {
        type: 'object',
        properties: {
          search: {
            type: 'string',
            description: 'Texto libre sobre nombre, descripción o SKU.',
          },
          category_id: {
            type: 'number',
            description: 'Filtrar por categoría.',
          },
          brand_id: { type: 'number', description: 'Filtrar por marca.' },
          product_type: {
            type: 'string',
            enum: PRODUCT_TYPES,
            description:
              'physical: producto físico. service: servicio. prepared: plato o preparación de cocina.',
          },
          state: {
            type: 'string',
            enum: PRODUCT_STATES,
            description:
              'Por defecto se excluyen los archivados y se muestran activos e inactivos.',
          },
          track_inventory: {
            type: 'boolean',
            description: 'Solo productos que llevan (o no llevan) inventario.',
          },
          is_sellable: {
            type: 'boolean',
            description:
              'Solo vendibles (true) o solo insumos internos (false). Útil en restaurantes.',
          },
          include_variants: {
            type: 'boolean',
            description:
              'Detallar las variantes de cada producto. Por defecto false para no saturar la respuesta; el conteo de variantes siempre viene.',
          },
          page: { type: 'number', description: 'Página. Por defecto 1.' },
          limit: {
            type: 'number',
            description: 'Productos por página. Por defecto 10, tope 25.',
          },
        },
      },
      requiredPermissions: ['store:products:read'],
      handler: async (args, context) => {
        if (!context.store_id) {
          return JSON.stringify({
            error:
              'Sin tienda en contexto: el catálogo se lista siempre dentro de una tienda.',
          });
        }

        const limit = clampLimit(args.limit, 10, 25);
        const page = Math.max(1, Math.floor(Number(args.page) || 1));
        const includeVariantDetail = args.include_variants === true;

        const query: any = {
          page,
          limit,
          // Always requested so `has_variants` is trustworthy: a downstream
          // tool must know a variant is mandatory before it acts.
          include_variants: true,
          include_stock: true,
        };
        if (args.search) query.search = String(args.search);
        if (args.category_id) query.category_id = Number(args.category_id);
        if (args.brand_id) query.brand_id = Number(args.brand_id);
        if (args.product_type) query.product_type = args.product_type;
        if (args.state) query.state = args.state;
        if (typeof args.track_inventory === 'boolean')
          query.track_inventory = args.track_inventory;
        if (typeof args.is_sellable === 'boolean')
          query.is_sellable = args.is_sellable;

        const result = await productsService.findAll(query);

        const products = (result.data ?? []).map((product: any) => {
          const tracked = product.track_inventory === true;
          const variants = product.product_variants ?? [];
          return {
            product_id: product.id,
            name: product.name,
            sku: product.sku ?? null,
            brand: product.brand?.name ?? null,
            state: product.state,
            product_type: product.product_type,
            net_price: round2(toNumber(product.base_price)),
            unit_price: round2(toNumber(product.final_price)),
            inventory_tracked: tracked,
            available_stock: tracked ? (product.stock_quantity ?? 0) : null,
            has_variants: variants.length > 0,
            variant_count: variants.length,
            requires_variant_selection: variants.length > 0,
            variants: includeVariantDetail
              ? variants.slice(0, MAX_VARIANTS_INLINE).map((variant: any) => ({
                  product_variant_id: variant.id,
                  label: variantLabel(variant),
                  sku: variant.sku,
                  attributes: parseAttributes(variant.attributes),
                  net_price:
                    toNumberOrNull(variant.price_override) ??
                    round2(toNumber(product.base_price)),
                  inventory_tracked: variant.effective_track_inventory === true,
                  available_stock:
                    variant.effective_track_inventory === true
                      ? (variant.stock_quantity ?? 0)
                      : null,
                }))
              : undefined,
          };
        });

        const total = result.meta?.total ?? products.length;
        const totalPages = result.meta?.totalPages ?? 1;

        return JSON.stringify({
          currency: await storeCurrency(),
          page,
          limit,
          returned: products.length,
          total,
          total_pages: totalPages,
          has_more: page < totalPages,
          products,
          note: 'Esto es una página del catálogo, no el catálogo completo: total dice cuántos hay en realidad. available_stock en null significa que el producto no lleva control de inventario.',
        });
      },
    },

    // ─── Tool 4: get_product_pricing ─────────────────────────────────
    {
      name: 'get_product_pricing',
      version: '1',
      domain: 'products',
      readOnly: true,
      description:
        'Desglose de precio de un producto o de una variante concreta: costo, precio base, oferta vigente, margen, impuestos y precio final al público. Si el producto tiene tarifas por volumen o empaque (caja, bulto), devuelve el precio resuelto de cada tarifa. Úsala para "a cuánto vendo esto", "cuánto gano con este producto", "cuánto sale la caja". Requiere product_id: obtenlo con find_product.',
      parameters: {
        type: 'object',
        properties: {
          product_id: {
            type: 'number',
            description: 'ID del producto, obtenido con find_product.',
          },
          product_variant_id: {
            type: 'number',
            description:
              'ID de la variante cuando el producto maneja variantes. Si se omite en un producto con variantes, se devuelve el precio de cada una.',
          },
        },
        required: ['product_id'],
      },
      requiredPermissions: ['store:products:read'],
      handler: async (args, context) => {
        if (!context.store_id) {
          return JSON.stringify({
            error:
              'Sin tienda en contexto: los precios se resuelven siempre dentro de una tienda.',
          });
        }

        const productId = Number(args.product_id);
        if (!Number.isInteger(productId) || productId <= 0) {
          return JSON.stringify({
            error:
              'product_id inválido. Resuelve el producto con find_product antes de pedir sus precios.',
          });
        }

        const variantId = args.product_variant_id
          ? Number(args.product_variant_id)
          : null;

        const product: any =
          await productsService.findProductPricingForAgent(productId);

        if (!product) {
          return JSON.stringify({
            error: `No existe un producto con id ${productId} en esta tienda.`,
            next_step:
              'Usa find_product con el nombre o el SKU para obtener el product_id correcto.',
          });
        }

        const variantCount = product._count?.product_variants ?? 0;
        const selectedVariant =
          variantId != null
            ? (product.product_variants ?? []).find(
                (variant: any) => variant.id === variantId,
              )
            : undefined;

        if (variantId != null && !selectedVariant) {
          return JSON.stringify({
            error: `La variante ${variantId} no pertenece al producto ${productId} (o quedó fuera de las primeras ${MAX_VARIANTS_INLINE}).`,
            next_step:
              'Llama a get_product para ver las variantes válidas y sus product_variant_id.',
          });
        }

        const taxRate = productsService.getEffectiveTaxRate(product);
        const productInput = {
          base_price: toNumber(product.base_price),
          is_on_sale: product.is_on_sale === true,
          sale_price: toNumberOrNull(product.sale_price),
          track_inventory: product.track_inventory === true,
          has_multiple_price_tiers: product.has_multiple_price_tiers === true,
        };

        const toVariantInput = (variant: any) => ({
          // `id` lo usa resolveWithTier para elegir la fila de override de esta
          // variante; sin él caería a la fila base del producto.
          id: variant.id,
          price_override: toNumberOrNull(variant.price_override),
          is_on_sale: variant.is_on_sale === true,
          sale_price: toNumberOrNull(variant.sale_price),
          track_inventory_override: variant.track_inventory_override ?? null,
        });

        /**
         * QUI-648 — ESCALAS. `products.cost_price` (y `product_variants.
         * cost_price`) viven en la unidad MÍNIMA de stock: los escribe
         * `CostingService` como valor / quantity_on_hand. `resolved.unitPrice`
         * sale de `base_price`, que cubre `price_unit_quantity` de esas
         * unidades. Un cable con el stock en milímetros guarda $3 el milímetro
         * y $5.000 el metro: restarlos tal cual le hacía reportar a Vexi un
         * margen del 166.566% sobre un negocio que gana 40%, y el comerciante
         * recibía ese número por chat como si fuera un dato.
         *
         * Se sube el COSTO a la escala del precio —el mismo criterio y el mismo
         * resolutor (`resolvePricedUnits`) que usan el editor de producto y la
         * analítica—, así `cost_price`, `margin_amount` y `net_price` quedan
         * los tres expresados en la unidad en la que se publica el precio.
         *
         * `packSize` va en `null`: las presentaciones tienen su propio precio
         * en `price_tiers` y este bloque no reporta su margen.
         *
         * Con `price_unit_quantity` ausente, nulo o 1 devuelve 1 y el costo sale
         * intacto: cero cambio para el catálogo histórico.
         */
        const pricedUnits = resolvePricedUnits(
          null,
          product.price_unit_quantity,
        );

        const describe = (
          resolved: {
            unitPrice: number;
            unitPriceWithTax: number;
            compareAtPrice: number | null;
            isOnSale: boolean;
            source: string;
            reason: string;
          },
          unitCost: number | null,
        ) => {
          // Con escala 1 el costo sale por identidad (sin redondear), que es
          // exactamente lo que devolvía antes; solo el camino escalado redondea
          // para no arrastrar ruido de coma flotante al multiplicar por N.
          const cost =
            unitCost == null
              ? null
              : pricedUnits > 1
                ? round2(unitCost * pricedUnits)
                : unitCost;
          return {
            net_price: round2(resolved.unitPrice),
            unit_price: round2(resolved.unitPriceWithTax),
            compare_at_price:
              resolved.compareAtPrice != null
                ? round2(resolved.compareAtPrice)
                : null,
            is_on_sale: resolved.isOnSale,
            price_source: resolved.source,
            reason: resolved.reason,
            cost_price: cost,
            // Solo viaja cuando hay escala, para no ensuciar la respuesta del
            // 99% del catálogo. Le dice al modelo en qué unidad está leyendo el
            // precio y el costo, que si no los narra como si fueran por unidad.
            price_unit_quantity: pricedUnits > 1 ? pricedUnits : undefined,
            margin_amount:
              cost != null ? round2(resolved.unitPrice - cost) : null,
            margin_pct:
              cost != null && cost > 0
                ? round2(((resolved.unitPrice - cost) / cost) * 100)
                : null,
          };
        };

        // ── Price tiers (multi-tarifa / venta por empaque) ────────────
        let tiers: any[] | undefined;
        if (product.has_multiple_price_tiers) {
          const { tiers: tierRows, overrides: overrideRows } =
            await productsService.findProductPriceTiersForAgent(productId);

          if (tierRows.length) {
            tiers = tierRows.map((tier) => {
              // Filtrado por tarifa. `resolveWithTier` ya compara el
              // `variant_id` real contra `variant.id`, así que el pre-filtro por
              // variante dejó de ser obligatorio; se mantiene por eficiencia
              // (menos filas que recorrer por tarifa).
              const relevantOverrides = overrideRows
                .filter(
                  (row) =>
                    row.price_tier_id === tier.id &&
                    (row.variant_id === null ||
                      (selectedVariant != null &&
                        row.variant_id === selectedVariant.id)),
                )
                .map((row) => ({
                  variant_id: row.variant_id,
                  override_price: toNumberOrNull(row.override_price),
                  override_units_per_package:
                    row.override_units_per_package ?? null,
                }));

              const resolved = priceResolver.resolveWithTier({
                product: productInput,
                variant: selectedVariant
                  ? toVariantInput(selectedVariant)
                  : undefined,
                priceTier: {
                  id: tier.id,
                  name: tier.name,
                  discount_percentage: toNumber(tier.discount_percentage),
                  is_package_unit: tier.is_package_unit === true,
                  units_per_package: tier.units_per_package ?? null,
                },
                tierOverrides: relevantOverrides,
                taxRate,
              });

              return {
                price_tier_id: tier.id,
                name: tier.name,
                discount_pct: toNumber(tier.discount_percentage),
                sells_by_package: resolved.isPackageUnit === true,
                units_per_package: resolved.unitsPerPackage ?? null,
                net_price: round2(resolved.unitPrice),
                price_with_tax: round2(resolved.unitPriceWithTax),
                price_source: resolved.source,
                reason: resolved.reason,
              };
            });
          }
        }

        const baseCost = toNumberOrNull(product.cost_price);

        // Explicit variant asked for → answer for that one only.
        if (selectedVariant) {
          const resolved = priceResolver.resolvePrice(
            { product: productInput, variant: toVariantInput(selectedVariant) },
            taxRate,
          );
          return JSON.stringify({
            product: {
              product_id: product.id,
              name: product.name,
              sku: product.sku ?? null,
              state: product.state,
            },
            variant: {
              product_variant_id: selectedVariant.id,
              label: variantLabel(selectedVariant),
              sku: selectedVariant.sku,
              attributes: parseAttributes(selectedVariant.attributes),
            },
            currency: await storeCurrency(),
            tax_rate_pct: round2(taxRate * 100),
            taxes: taxBreakdown(product.product_tax_assignments),
            price: describe(
              resolved,
              toNumberOrNull(selectedVariant.cost_price) ?? baseCost,
            ),
            price_tiers: tiers,
            note: 'unit_price es el precio final al público (impuestos incluidos); net_price es sin impuestos.',
          });
        }

        const baseResolved = priceResolver.resolvePrice(
          { product: productInput },
          taxRate,
        );

        const variantPrices =
          variantCount > 0
            ? (product.product_variants ?? []).map((variant: any) => {
                const resolved = priceResolver.resolvePrice(
                  { product: productInput, variant: toVariantInput(variant) },
                  taxRate,
                );
                return {
                  product_variant_id: variant.id,
                  label: variantLabel(variant),
                  sku: variant.sku,
                  attributes: parseAttributes(variant.attributes),
                  ...describe(
                    resolved,
                    toNumberOrNull(variant.cost_price) ?? baseCost,
                  ),
                };
              })
            : undefined;

        return JSON.stringify({
          product: {
            product_id: product.id,
            name: product.name,
            sku: product.sku ?? null,
            state: product.state,
          },
          currency: await storeCurrency(),
          tax_rate_pct: round2(taxRate * 100),
          taxes: taxBreakdown(product.product_tax_assignments),
          price: describe(baseResolved, baseCost),
          has_variants: variantCount > 0,
          variant_count: variantCount,
          variants_truncated:
            variantCount > (variantPrices?.length ?? 0) || undefined,
          variant_prices: variantPrices,
          price_tiers: tiers,
          note:
            variantCount > 0
              ? 'Un producto con variantes no tiene un precio único: price es el del producto base y variant_prices trae el de cada variante. Al vender hay que elegir variante.'
              : 'unit_price es el precio final al público (impuestos incluidos); net_price es sin impuestos.',
        });
      },
    },

    // ─── Tool 5: update_product (O-1, write) ────────────────────────────
    {
      name: 'update_product',
      version: '1',
      domain: 'products',
      requiresConfirmation: true,
      description:
        'Edita un producto existente del catálogo: nombre, descripción, SKU, código de barras, precio base, costo, margen, oferta, control de inventario y banderas de venta. Solo se cambian los campos enviados (semántica PATCH). Requiere product_id: obtenlo con find_product. Nunca acepta final_price: ese es un calculado de lectura (precio + impuestos); para cambiar lo que paga el cliente edita base_price o sale_price. No edita stock (eso es adjust_stock), ni variantes (create/update/delete_variant), ni archiva (eso se hace en el módulo de productos).',
      parameters: {
        type: 'object',
        properties: {
          product_id: {
            type: 'number',
            description: 'ID del producto, obtenido con find_product.',
          },
          name: {
            type: 'string',
            description: 'Nuevo nombre comercial (2 a 255 caracteres).',
          },
          description: { type: 'string', description: 'Nueva descripción.' },
          sku: {
            type: 'string',
            description:
              'Nuevo SKU. Debe seguir siendo único en la tienda.',
          },
          barcode: { type: 'string', description: 'Nuevo código de barras.' },
          base_price: {
            type: 'number',
            description: 'Nuevo precio de venta SIN impuestos.',
          },
          cost_price: {
            type: 'number',
            description: 'Nuevo costo unitario.',
          },
          profit_margin: {
            type: 'number',
            description: 'Nuevo margen de ganancia en porcentaje sobre el costo.',
          },
          is_on_sale: {
            type: 'boolean',
            description: 'Si el producto queda en promoción.',
          },
          sale_price: {
            type: 'number',
            description:
              'Nuevo precio de oferta SIN impuestos. Debe ser menor que el precio normal.',
          },
          track_inventory: {
            type: 'boolean',
            description: 'Si el producto lleva control de existencias.',
          },
          is_sellable: {
            type: 'boolean',
            description: 'Si se puede vender directamente.',
          },
          available_for_ecommerce: {
            type: 'boolean',
            description: 'Si se publica en la tienda en línea.',
          },
          is_featured: {
            type: 'boolean',
            description: 'Si se marca como destacado.',
          },
          allow_pos_price_override: {
            type: 'boolean',
            description:
              'Si el cajero puede cambiarle el precio a mano en el POS.',
          },
          brand_id: { type: 'number', description: 'Nueva marca.' },
        },
        required: ['product_id'],
      },
      requiredPermissions: ['store:products:update'],
      preview: async (args, context) => {
        const resolved = await resolveProductEdit(args, context.store_id);
        if (!resolved.ok) {
          return writePreviewError(
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
          // Re-verificación: el producto pudo cambiar (u otro usuario pudo
          // tomar el mismo SKU) entre la propuesta y la confirmación.
          const resolved = await resolveProductEdit(args, context.store_id);
          if (!resolved.ok) {
            return writeToolError(resolved.message, resolved.nextStep);
          }

          await productsService.update(
            resolved.value.productId,
            resolved.value.dto,
            { lean: true },
          );

          return JSON.stringify({
            summary: `${resolved.value.label}: ${resolved.value.changes.length} campo(s) actualizado(s).`,
            data: {
              product_id: resolved.value.productId,
              updated_fields: resolved.value.changes.map(
                (change) => change.field,
              ),
            },
          });
        } catch (error) {
          const { code, message } = describeWriteError(error);
          return writeToolError(
            `No se pudo editar el producto${code ? ` (${code})` : ''}: ${message}`,
          );
        }
      },
    },
  ];
}
