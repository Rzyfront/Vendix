import { HttpException } from '@nestjs/common';
import { order_state_enum } from '@prisma/client';
import { generateSlug } from '@common/utils/slug.util';
import {
  DOCUMENT_TYPE_CODES,
  DOCUMENT_TYPE_RULES,
  DocumentTypeCode,
} from '@common/constants/document-types';
import { VendixHttpException } from '../../../common/errors';
import { RegisteredTool, ToolPreview } from '../interfaces/tool.interface';
import { StorePrismaService } from '../../../prisma/services/store-prisma.service';
import { InventoryAdjustmentsService } from '../../../domains/store/inventory/adjustments/inventory-adjustments.service';
import {
  AdjustmentType,
  CreateAdjustmentDto,
} from '../../../domains/store/inventory/adjustments/interfaces/inventory-adjustment.interface';
import { ProductsService } from '../../../domains/store/products/products.service';
import {
  CreateProductDto,
  UpdateProductDto,
  UpdateProductVariantDto,
} from '../../../domains/store/products/dto';
import { ProductType } from '../../../domains/store/products/dto/product-enums';
import { CustomersService } from '../../../domains/store/customers/customers.service';
import { CreateCustomerDto } from '../../../domains/store/customers/dto/create-customer.dto';
import { UpdateCustomerDto } from '../../../domains/store/customers/dto/update-customer.dto';
import {
  OrderFlowService,
  VALID_TRANSITIONS,
} from '../../../domains/store/orders/order-flow/order-flow.service';
import { DispatchNotesService } from '../../../domains/store/dispatch-notes/dispatch-notes.service';

/**
 * Las escrituras TIPADAS de Vexi: los seis dominios donde vale la pena una
 * herramienta a mano en vez del puente genérico.
 *
 * ## Esto ya NO es una lista de veto
 *
 * Este bloque declaraba que Vexi no podía tocar fiscal, nómina, suscripción,
 * cierres de caja, movimientos de dinero ni archivados, y que ante una petición de
 * esas familias debía negarse. **Eso dejó de ser cierto.** El puente genérico
 * (`api-bridge.tools.ts`) alcanza cualquier ruta que el catálogo de permisos
 * autorice al usuario, incluidas todas esas, y el registro de capacidades
 * (`capability-registry.service.ts`) las publica como capacidades reales. Un
 * comentario que afirme lo contrario es peor que ninguno: el próximo desarrollador
 * lo lee, cree que existe un veto que el código no aplica, y diseña sobre una
 * garantía inexistente.
 *
 * Lo que protege esos dominios hoy no es una lista de prohibiciones, son tres
 * mecanismos que aplican a TODA escritura, tipada o no:
 *
 *  1. **Aprobación explícita, una por cambio.** Todo `requiresConfirmation` acuña
 *     un token de un solo uso ligado a (usuario, herramienta, argumentos). Nada se
 *     aplica sin que la persona haya visto ese diff exacto y dicho sí.
 *  2. **Permisos reales del usuario.** El puente replica el token del llamante
 *     sobre HTTP interno, así que atraviesa los mismos guards que el navegador. Si
 *     la persona no puede liquidar nómina, Vexi tampoco.
 *  3. **Advertencia de irreversibilidad.** `IRREVERSIBLE_DOMAINS` inyecta en la
 *     tarjeta la frase que explica qué no se deshace —una emisión ante la DIAN, un
 *     cierre de caja, un pago aplicado— antes de pedir el sí.
 *
 * La razón para escribir una herramienta tipada aquí sigue siendo válida, pero es
 * otra: mejor `preview`, mejores mensajes de error y validación de dominio que el
 * puente genérico no puede derivar del DTO. No es un permiso que el puente no tenga.
 *
 * ## Por qué cada herramienta tiene `preview` y `requiresConfirmation`
 *
 * `AIToolRegistry.executeTool()` intercepta toda herramienta con
 * `requiresConfirmation: true` que llegue sin token: corre este `preview`,
 * acuña un token ligado a (usuario, herramienta, argumentos) y lanza
 * `AI_AGENT_005` con el diff dentro. **El rechazo ES la propuesta.** Por eso
 * aquí no hay ningún plumbing de propose/confirm: basta con que el `preview`
 * describa fielmente el cambio.
 *
 * Un `preview` que devuelve `status: 'error'` no acuña token: la ejecución
 * muere ahí. Se usa para lo imposible (producto inexistente, orden ya
 * remisionada, transición vetada), nunca para lo meramente arriesgado — eso es
 * `warning`, que sí deja aprobar.
 *
 * ## Doctrina: el `handler` NO confía en el `preview`
 *
 * Entre la propuesta y la aprobación pasa tiempo real: alguien vendió, otro
 * ajustó el precio, la orden cambió de estado. Cada `handler` vuelve a leer y
 * a validar sus propias precondiciones desde cero — misma doctrina que
 * `products-bulk-edit.service.ts:137-150`, donde el preview replica las
 * precondiciones en lectura y el apply delega íntegramente en el servicio de
 * dominio.
 *
 * ## Doctrina: los handlers NO lanzan
 *
 * Un `throw` sale del handler y el registry lo convierte en `AI_AGENT_003`, un
 * error opaco que el modelo no puede explicarle al usuario ni corregir. Todo
 * handler captura y devuelve `JSON.stringify({ error, next_step })` en español.
 * (El registry sí lanza para el gate de confirmación: eso es otra cosa y está
 * bien.)
 *
 * ## Reparto del registro (decisión)
 *
 * Este archivo exporta CUATRO fábricas en vez de una, y cada módulo de dominio
 * registra la suya desde su propio `onModuleInit`:
 *
 *  | Fábrica                     | Módulo que la registra | Servicios que inyecta            |
 *  | --------------------------- | ---------------------- | -------------------------------- |
 *  | `createInventoryWriteTools` | `InventoryModule`      | `InventoryAdjustmentsService`    |
 *  | `createProductWriteTools`   | `ProductsModule`       | `ProductsService`                |
 *  | `createCustomerWriteTools`  | `CustomersModule`      | `CustomersService`               |
 *  | `createOrderWriteTools`     | `OrdersModule`         | `OrderFlowService`, `DispatchNotesService` |
 *
 * La alternativa —un solo módulo registrando las seis— obligaría a ese módulo a
 * importar los otros tres para inyectar sus servicios, creando aristas
 * cruzadas entre dominios que hoy no existen (Inventario no conoce Clientes, y
 * Productos no conoce Órdenes). Cada dominio ya inyecta el servicio que su
 * escritura necesita, así que este reparto no cuesta un import nuevo en ningún
 * módulo. `AIToolRegistry` viene del `AIEngineModule` `@Global()`: se inyecta
 * SIN importar ese módulo, que es justo lo que evita el ciclo.
 *
 * ## Doctrina: se reutiliza el servicio de dominio, nunca Prisma crudo
 *
 * Prisma aquí es solo para LEER (previsualizar y re-verificar). Toda escritura
 * pasa por el servicio dueño de la regla, porque ahí viven efectos que un
 * `prisma.update` se saltaría en silencio:
 *
 *  - `InventoryAdjustmentsService.createAdjustment` → `StockLevelManager`
 *    (costeo CPP/FIFO, `inventory_transactions`, `syncProductStock`) + evento
 *    `inventory.adjusted`, que es lo que produce el asiento contable.
 *  - `ProductsService.update/create` → unicidad de slug/SKU/código de barras,
 *    UoM, categorías, impuestos, tramos, guardas de reserva activa.
 *  - `CustomersService.create/update` → rol `customer`, `store_users`,
 *    normalización de documento, unicidad por organización, `customer.created`.
 *  - `OrderFlowService.forceOrderState` → único escritor de `orders.state`;
 *    libera o consume reservas y emite `order.shipped` (QUI-557).
 *  - `DispatchNotesService.createFromOrder` → numeración, snapshot de
 *    dirección, `dispatch_fulfillment` y el evento `dispatch_note.confirmed`.
 *
 * ## Multi-tenant
 *
 * Siempre `StorePrismaService`. Dos trampas ya documentadas en el repo:
 * `stores` y `users` devuelven el cliente SIN scope (`vendix-prisma-scopes`),
 * así que toda consulta a esas dos tablas lleva su filtro de tienda escrito a
 * mano. `$transaction` también sale del `baseClient`, pero aquí no abrimos
 * ninguna: las transacciones viven dentro de los servicios de dominio.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Utilidades compartidas
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
 * Traduce una excepción del dominio a texto que el modelo pueda narrar.
 * Mismo criterio que `ProductsBulkEditService.extractErrorInfo`.
 */
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

function fullName(user: {
  first_name?: string | null;
  last_name?: string | null;
}): string {
  return [user.first_name, user.last_name].filter(Boolean).join(' ').trim();
}

/**
 * Suma de todas las tarifas de todas las categorías de impuesto asignadas.
 * Idéntica a `ProductsService.calculateFinalPrice`: el precio que Vexi cita
 * tiene que ser el mismo que muestra el catálogo, no una segunda opinión.
 */
function totalTaxRate(assignments: any[] | undefined | null): number {
  let rate = 0;
  for (const assignment of assignments ?? []) {
    for (const tax of assignment?.tax_categories?.tax_rates ?? []) {
      rate += Number(tax.rate ?? 0);
    }
  }
  return rate;
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. INVENTARIO — adjust_stock
// ─────────────────────────────────────────────────────────────────────────────

export interface InventoryWriteToolDeps {
  adjustmentsService: InventoryAdjustmentsService;
  /**
   * Siempre `StorePrismaService`: `products`, `product_variants` y
   * `stock_levels` son datos de tienda y el cliente scopeado inyecta el filtro.
   */
  prisma: StorePrismaService;
}

const ADJUSTMENT_TYPES: readonly AdjustmentType[] = [
  'damage',
  'loss',
  'theft',
  'expiration',
  'count_variance',
  'manual_correction',
];

interface StockTarget {
  productId: number;
  productName: string;
  variantId: number | null;
  variantLabel: string | null;
  locationId: number;
  locationName: string;
  quantityBefore: number;
  quantityReserved: number;
  quantityAfter: number;
  delta: number;
  adjustmentType: AdjustmentType;
  label: string;
}

export function createInventoryWriteTools(
  deps: InventoryWriteToolDeps,
): RegisteredTool[] {
  const { adjustmentsService, prisma } = deps;

  /**
   * Resuelve producto + variante + bodega + cantidades contra la base.
   *
   * La corre el `preview` para proponer y la vuelve a correr el `handler` para
   * aplicar: son dos lecturas distintas del mundo, a propósito.
   */
  async function resolveStockTarget(
    args: Record<string, any>,
    storeId: number | undefined,
  ): Promise<Resolution<StockTarget>> {
    const label = 'Ajuste de inventario';

    if (!storeId) {
      return failure(
        label,
        'Sin tienda en contexto: el inventario se ajusta siempre dentro de una tienda.',
      );
    }

    const productId = toPositiveInt(args.product_id);
    if (!productId) {
      return failure(
        label,
        'product_id inválido.',
        'Usa find_product para obtener el product_id antes de ajustar existencias.',
      );
    }

    const quantityAfter = toNumberOrNull(args.quantity_after);
    if (
      quantityAfter === null ||
      !Number.isInteger(quantityAfter) ||
      quantityAfter < 0
    ) {
      return failure(
        label,
        'quantity_after debe ser un número entero mayor o igual a cero: es el total físico que queda en la bodega después del ajuste, no la diferencia.',
      );
    }

    const rawType = cleanString(args.adjustment_type) ?? 'manual_correction';
    if (!ADJUSTMENT_TYPES.includes(rawType as AdjustmentType)) {
      return failure(
        label,
        `adjustment_type "${rawType}" no existe. Valores válidos: ${ADJUSTMENT_TYPES.join(', ')}.`,
      );
    }
    const adjustmentType = rawType as AdjustmentType;

    const product: any = await prisma.products.findFirst({
      where: { id: productId },
      select: {
        id: true,
        name: true,
        sku: true,
        state: true,
        track_inventory: true,
        product_variants: {
          orderBy: { id: 'asc' },
          take: 100,
          select: { id: true, name: true, sku: true },
        },
      },
    });

    if (!product) {
      return failure(
        label,
        `No existe un producto con id ${productId} en esta tienda.`,
        'Usa find_product con el nombre, el SKU o el código de barras.',
      );
    }

    const productLabel = product.sku
      ? `${product.name} (${product.sku})`
      : String(product.name);

    if (product.state === 'archived') {
      return failure(
        productLabel,
        'El producto está archivado: no se le puede ajustar el inventario.',
        'Reactívalo desde el módulo de productos si el ajuste es necesario.',
      );
    }

    if (product.track_inventory !== true) {
      return failure(
        productLabel,
        'Este producto no lleva control de inventario, así que no tiene existencias que ajustar.',
        'Actívale el control de inventario desde el módulo de productos si quieres llevarle stock.',
      );
    }

    const variants: any[] = product.product_variants ?? [];
    const requestedVariantId = args.product_variant_id
      ? toPositiveInt(args.product_variant_id)
      : null;

    if (args.product_variant_id && !requestedVariantId) {
      return failure(productLabel, 'product_variant_id inválido.');
    }

    // QUI-486: escribir stock con `variant_id` nulo en un producto CON
    // variantes crea una fila base huérfana que nadie puede vender y que el
    // siguiente `enforceStockLevelsMode()` destruye. Se rechaza antes de
    // llegar al manager, que no puede distinguir el caso accidental.
    if (variants.length > 0 && !requestedVariantId) {
      const options = variants
        .slice(0, 10)
        .map(
          (variant) =>
            `${variant.name ?? variant.sku ?? variant.id} (id ${variant.id})`,
        )
        .join('; ');
      return failure(
        productLabel,
        `"${product.name}" maneja ${variants.length} variante(s): el ajuste va sobre una variante concreta, no sobre el producto. Opciones: ${options}.`,
        'Pregunta al usuario cuál variante y repite el ajuste con su product_variant_id.',
      );
    }

    const variant =
      requestedVariantId != null
        ? variants.find((row) => row.id === requestedVariantId)
        : undefined;

    if (requestedVariantId != null && !variant) {
      return failure(
        productLabel,
        `La variante ${requestedVariantId} no pertenece a "${product.name}".`,
        'Llama a get_product para ver las variantes válidas y sus product_variant_id.',
      );
    }

    const variantLabel = variant
      ? String(variant.name ?? variant.sku ?? `variante ${variant.id}`)
      : null;
    const targetLabel = variantLabel
      ? `${productLabel} — ${variantLabel}`
      : productLabel;

    const requestedLocationId = args.location_id
      ? toPositiveInt(args.location_id)
      : null;
    if (args.location_id && !requestedLocationId) {
      return failure(targetLabel, 'location_id inválido.');
    }

    const levels: any[] = await prisma.stock_levels.findMany({
      where: {
        product_id: productId,
        product_variant_id: variant ? variant.id : null,
        ...(requestedLocationId ? { location_id: requestedLocationId } : {}),
      },
      select: {
        location_id: true,
        quantity_on_hand: true,
        quantity_reserved: true,
        inventory_locations: { select: { name: true, is_active: true } },
      },
    });

    if (!levels.length) {
      return failure(
        targetLabel,
        requestedLocationId
          ? `"${targetLabel}" no tiene una ficha de existencias en la bodega ${requestedLocationId}: no hay nada que ajustar ahí.`
          : `"${targetLabel}" no tiene ninguna ficha de existencias registrada.`,
        'Usa get_inventory_locations para ver las bodegas y get_stock_levels para ver dónde sí tiene existencias. Si el producto nunca ha entrado a bodega, la primera entrada se hace por compra o recepción, no por ajuste.',
      );
    }

    if (levels.length > 1) {
      const options = levels
        .map(
          (level) =>
            `${level.inventory_locations?.name ?? 'bodega'} (id ${level.location_id}, ${level.quantity_on_hand} u.)`,
        )
        .join('; ');
      return failure(
        targetLabel,
        `"${targetLabel}" tiene existencias en ${levels.length} bodegas: ${options}.`,
        'Pregunta al usuario en cuál bodega es el ajuste y repite la llamada con ese location_id.',
      );
    }

    const level = levels[0];
    const quantityBefore = Number(level.quantity_on_hand ?? 0);
    const delta = quantityAfter - quantityBefore;

    if (delta === 0) {
      return failure(
        targetLabel,
        `"${targetLabel}" ya tiene ${quantityBefore} unidades en ${level.inventory_locations?.name ?? 'la bodega'}: el ajuste no cambiaría nada.`,
        'Confirma con el usuario cuál es la cantidad física real que contó.',
      );
    }

    return {
      ok: true,
      value: {
        productId,
        productName: String(product.name),
        variantId: variant ? variant.id : null,
        variantLabel,
        locationId: Number(level.location_id),
        locationName: String(level.inventory_locations?.name ?? 'bodega'),
        quantityBefore,
        quantityReserved: Number(level.quantity_reserved ?? 0),
        quantityAfter,
        delta,
        adjustmentType,
        label: targetLabel,
      },
    };
  }

  return [
    {
      name: 'adjust_stock',
      domain: 'inventory',
      requiresConfirmation: true,
      description:
        'Corrige las existencias físicas de un producto en una bodega: conteo que no cuadra, mercancía averiada, perdida, robada o vencida. Se le pasa la cantidad FINAL que quedó en la bodega, no la diferencia. Deja traza de auditoría, recalcula el costo del inventario y genera el asiento contable, así que es la única forma correcta de cuadrar stock — nunca edites el producto para "corregir" existencias. Requiere product_id: obtenlo con find_product. Si el producto maneja variantes hay que indicar la variante, y si tiene existencias en varias bodegas hay que indicar la bodega (get_inventory_locations las lista). Para la primera entrada de mercancía nueva NO sirve: eso es una compra o una recepción.',
      parameters: {
        type: 'object',
        properties: {
          product_id: {
            type: 'number',
            description: 'ID del producto, obtenido con find_product.',
          },
          quantity_after: {
            type: 'number',
            description:
              'Unidades que quedan físicamente en la bodega DESPUÉS del ajuste (el conteo real), no la diferencia. Entero, mayor o igual a cero.',
          },
          location_id: {
            type: 'number',
            description:
              'Bodega donde está la mercancía. Se puede omitir si el producto solo tiene existencias en una; si tiene en varias, es obligatorio.',
          },
          product_variant_id: {
            type: 'number',
            description:
              'Variante a ajustar. Obligatorio cuando el producto maneja variantes.',
          },
          adjustment_type: {
            type: 'string',
            enum: ADJUSTMENT_TYPES,
            description:
              'Motivo del ajuste: damage (avería), loss (pérdida), theft (robo), expiration (vencimiento), count_variance (diferencia de conteo), manual_correction (corrección manual, por defecto).',
          },
          reason: {
            type: 'string',
            description:
              'Descripción libre para la traza de auditoría. Recomendado: quién contó, cuándo, qué pasó.',
          },
        },
        required: ['product_id', 'quantity_after'],
      },
      requiredPermissions: ['store:inventory:adjustments:create'],
      preview: async (args, context) => {
        const resolved = await resolveStockTarget(args, context.store_id);
        if (!resolved.ok) {
          return previewError(
            resolved.label,
            [resolved.message, resolved.nextStep].filter(Boolean).join(' '),
            'inventory',
          );
        }

        const target = resolved.value;
        const signo = target.delta > 0 ? '+' : '';
        const warnings: string[] = [];

        if (target.quantityAfter < target.quantityReserved) {
          warnings.push(
            `Quedarían ${target.quantityReserved} unidades reservadas para pedidos con solo ${target.quantityAfter} en físico: algún pedido no se va a poder despachar.`,
          );
        }
        if (target.delta < 0) {
          warnings.push(
            `Se dan de baja ${Math.abs(target.delta)} unidades; el costo de esa mercancía se lleva a resultados en el asiento contable.`,
          );
        }

        return {
          status: warnings.length ? 'warning' : 'ok',
          target: target.label,
          changes: [
            {
              field: 'quantity_on_hand',
              label: `Existencias en ${target.locationName}`,
              from: target.quantityBefore,
              to: target.quantityAfter,
            },
          ],
          message: [
            `Ajuste de tipo "${target.adjustmentType}" en ${target.locationName}: ${signo}${target.delta} unidades.`,
            ...warnings,
          ].join(' '),
          domain: 'inventory',
        };
      },
      handler: async (args, context) => {
        try {
          const organizationId = context.organization_id;
          const userId = context.user_id;
          if (!organizationId || !userId) {
            return toolError(
              'Falta el contexto de organización o de usuario: un ajuste de inventario tiene que quedar firmado por quien lo hace.',
            );
          }

          // Re-verificación completa contra la base: entre la propuesta y esta
          // llamada pudo venderse, entrar mercancía o moverse la bodega.
          const resolved = await resolveStockTarget(args, context.store_id);
          if (!resolved.ok) {
            return toolError(resolved.message, resolved.nextStep);
          }
          const target = resolved.value;

          // `organization_id` y `created_by_user_id` los resuelve el servicio del
          // contexto de la petición; ya no se aceptan en el DTO.
          const dto: CreateAdjustmentDto = {
            product_id: target.productId,
            ...(target.variantId
              ? { product_variant_id: target.variantId }
              : {}),
            location_id: target.locationId,
            type: target.adjustmentType,
            quantity_after: target.quantityAfter,
            description:
              cleanString(args.reason) ?? 'Ajuste registrado desde Vexi',
          };

          const adjustment = await adjustmentsService.createAdjustment(dto);

          return JSON.stringify({
            summary: `${target.label}: ${adjustment.quantity_before} → ${adjustment.quantity_after} unidades en ${target.locationName}.`,
            data: {
              adjustment_id: adjustment.id,
              product_id: adjustment.product_id,
              product_variant_id: adjustment.product_variant_id,
              location_id: adjustment.location_id,
              location: target.locationName,
              type: adjustment.adjustment_type,
              quantity_before: adjustment.quantity_before,
              quantity_after: adjustment.quantity_after,
              quantity_change: adjustment.quantity_change,
            },
            note: 'El ajuste quedó registrado con traza de auditoría y generó el movimiento contable correspondiente.',
          });
        } catch (error) {
          const { code, message } = describeError(error);
          return toolError(
            `No se pudo registrar el ajuste${code ? ` (${code})` : ''}: ${message}`,
            'Verifica con get_stock_levels que la bodega y la variante sean las correctas.',
          );
        }
      },
    },
  ];
}

// ─────────────────────────────────────────────────────────────────────────────
// 2 y 5. PRODUCTOS — update_product_price, create_product
// ─────────────────────────────────────────────────────────────────────────────

export interface ProductWriteToolDeps {
  productsService: ProductsService;
  prisma: StorePrismaService;
}

/** Qué campo de precio se está tocando. */
type PriceField = 'base_price' | 'sale_price' | 'price_override';

interface PriceTarget {
  productId: number;
  variantId: number | null;
  label: string;
  field: PriceField;
  currentPrice: number;
  newPrice: number;
  basePrice: number;
  activatesSale: boolean;
  taxRate: number;
}

const PRICE_FIELD_LABELS: Record<PriceField, string> = {
  base_price: 'Precio base (sin impuestos)',
  sale_price: 'Precio de oferta (sin impuestos)',
  price_override: 'Precio de la variante (sin impuestos)',
};

export function createProductWriteTools(
  deps: ProductWriteToolDeps,
): RegisteredTool[] {
  const { productsService, prisma } = deps;

  /**
   * Precondición replicada de `products.service.ts` (`update` y
   * `ProductVariantService.updateVariant`): con reservas activas el servicio
   * lanza `INV_STOCK_001`. Mejor decirlo en la propuesta que fallar al aplicar.
   */
  async function hasActiveReservations(
    productId: number,
    variantId: number | null,
  ): Promise<boolean> {
    const found = await prisma.stock_reservations.findFirst({
      where: {
        product_id: productId,
        product_variant_id: variantId,
        status: 'active',
      },
      select: { id: true },
    });
    return !!found;
  }

  async function resolvePriceTarget(
    args: Record<string, any>,
    storeId: number | undefined,
  ): Promise<Resolution<PriceTarget>> {
    const label = 'Cambio de precio';

    if (!storeId) {
      return failure(
        label,
        'Sin tienda en contexto: los precios se cambian siempre dentro de una tienda.',
      );
    }

    const productId = toPositiveInt(args.product_id);
    if (!productId) {
      return failure(
        label,
        'product_id inválido.',
        'Usa find_product para obtener el product_id antes de cambiar un precio.',
      );
    }

    const newPriceArg = toNumberOrNull(args.new_price);
    const percentArg = toNumberOrNull(args.percent_change);

    if (newPriceArg === null && percentArg === null) {
      return failure(
        label,
        'Falta el precio: indica new_price (valor exacto) o percent_change (porcentaje, positivo para subir y negativo para bajar).',
      );
    }
    if (newPriceArg !== null && percentArg !== null) {
      return failure(
        label,
        'new_price y percent_change son excluyentes: usa uno u otro, no los dos.',
      );
    }
    if (newPriceArg !== null && newPriceArg < 0) {
      return failure(label, 'El precio no puede ser negativo.');
    }
    if (percentArg !== null && percentArg <= -100) {
      return failure(
        label,
        'Un descuento del 100% o más dejaría el precio en cero o negativo.',
      );
    }

    const applyTo = cleanString(args.apply_to) ?? 'base';
    if (applyTo !== 'base' && applyTo !== 'sale') {
      return failure(
        label,
        'apply_to solo acepta "base" (precio normal) o "sale" (precio de oferta).',
      );
    }

    const product: any = await prisma.products.findFirst({
      where: { id: productId },
      select: {
        id: true,
        name: true,
        sku: true,
        state: true,
        base_price: true,
        sale_price: true,
        is_on_sale: true,
        product_tax_assignments: {
          select: {
            tax_categories: {
              select: { tax_rates: { select: { rate: true } } },
            },
          },
        },
        product_variants: {
          orderBy: { id: 'asc' },
          take: 100,
          select: {
            id: true,
            name: true,
            sku: true,
            price_override: true,
            sale_price: true,
            is_on_sale: true,
          },
        },
      },
    });

    if (!product) {
      return failure(
        label,
        `No existe un producto con id ${productId} en esta tienda.`,
        'Usa find_product para obtener el product_id correcto.',
      );
    }

    const productLabel = product.sku
      ? `${product.name} (${product.sku})`
      : String(product.name);

    // Réplica de `products.service.ts:1912-1923`: archivado ⇒ PROD_FIND_001.
    if (product.state === 'archived') {
      return failure(
        productLabel,
        'El producto está archivado: no se le puede cambiar el precio.',
      );
    }

    const requestedVariantId = args.product_variant_id
      ? toPositiveInt(args.product_variant_id)
      : null;
    if (args.product_variant_id && !requestedVariantId) {
      return failure(productLabel, 'product_variant_id inválido.');
    }

    const variants: any[] = product.product_variants ?? [];
    const variant =
      requestedVariantId != null
        ? variants.find((row) => row.id === requestedVariantId)
        : undefined;

    if (requestedVariantId != null && !variant) {
      return failure(
        productLabel,
        `La variante ${requestedVariantId} no pertenece a "${product.name}".`,
        'Llama a get_product para ver las variantes válidas y sus product_variant_id.',
      );
    }

    // Un producto con variantes no tiene "un" precio: cada variante puede
    // sobrescribirlo. Cambiar el base sin decirlo movería a unas y a otras no.
    if (!variant && variants.length > 0) {
      const overridden = variants.filter(
        (row) => toNumberOrNull(row.price_override) !== null,
      );
      if (overridden.length > 0) {
        const names = overridden
          .slice(0, 10)
          .map((row) => `${row.name ?? row.sku ?? row.id} (id ${row.id})`)
          .join('; ');
        return failure(
          productLabel,
          `"${product.name}" tiene ${overridden.length} variante(s) con precio propio (${names}); cambiar el precio base no las afecta.`,
          'Pregunta al usuario si el cambio es del precio base o de una variante concreta, y en ese caso pasa su product_variant_id.',
        );
      }
    }

    const basePrice = Number(product.base_price ?? 0);
    const label2 = variant
      ? `${productLabel} — ${variant.name ?? variant.sku ?? `variante ${variant.id}`}`
      : productLabel;

    let field: PriceField;
    let currentPrice: number;

    if (variant) {
      if (applyTo === 'sale') {
        field = 'sale_price';
        currentPrice = toNumberOrNull(variant.sale_price) ?? 0;
      } else {
        field = 'price_override';
        // Sin override la variante hereda el precio del producto: ese es el
        // precio vigente sobre el que se calcula un porcentaje.
        currentPrice = toNumberOrNull(variant.price_override) ?? basePrice;
      }
    } else if (applyTo === 'sale') {
      field = 'sale_price';
      currentPrice = toNumberOrNull(product.sale_price) ?? 0;
    } else {
      field = 'base_price';
      currentPrice = basePrice;
    }

    if (percentArg !== null && currentPrice <= 0) {
      return failure(
        label2,
        `No hay un precio vigente sobre el cual aplicar ${percentArg}%.`,
        'Indica el precio exacto con new_price.',
      );
    }

    const newPrice =
      newPriceArg !== null
        ? round2(newPriceArg)
        : round2(currentPrice * (1 + percentArg! / 100));

    if (newPrice === currentPrice) {
      return failure(
        label2,
        `El precio ya es ${currentPrice}: el cambio no modificaría nada.`,
      );
    }

    // Regla de negocio de `vendix-product-pricing`: la oferta solo tiene
    // sentido por debajo del precio normal.
    const referenceBase = variant
      ? (toNumberOrNull(variant.price_override) ?? basePrice)
      : basePrice;
    if (applyTo === 'sale' && newPrice >= referenceBase && referenceBase > 0) {
      return failure(
        label2,
        `Un precio de oferta de ${newPrice} no puede ser mayor o igual al precio normal (${referenceBase}).`,
        'Baja el precio de oferta o cambia el precio normal con apply_to = "base".',
      );
    }

    if (await hasActiveReservations(productId, variant ? variant.id : null)) {
      return failure(
        label2,
        'El producto tiene reservas de stock activas (pedidos en curso apartando unidades) y el sistema bloquea editarlo mientras existan.',
        'Despacha o cancela esos pedidos y vuelve a intentarlo.',
      );
    }

    const isOnSale = variant
      ? variant.is_on_sale === true
      : product.is_on_sale === true;

    return {
      ok: true,
      value: {
        productId,
        variantId: variant ? variant.id : null,
        label: label2,
        field,
        currentPrice,
        newPrice,
        basePrice: referenceBase,
        activatesSale: applyTo === 'sale' && !isOnSale,
        taxRate: totalTaxRate(product.product_tax_assignments),
      },
    };
  }

  /** Datos ya validados para crear un producto nuevo. */
  interface NewProduct {
    dto: CreateProductDto;
    label: string;
    initialStock: number;
    costPrice: number | null;
  }

  async function resolveNewProduct(
    args: Record<string, any>,
    storeId: number | undefined,
  ): Promise<Resolution<NewProduct>> {
    const label = 'Producto nuevo';

    if (!storeId) {
      return failure(
        label,
        'Sin tienda en contexto: los productos se crean siempre dentro de una tienda.',
      );
    }

    const name = cleanString(args.name);
    if (!name || name.length < 2 || name.length > 255) {
      return failure(
        label,
        'El nombre del producto es obligatorio y debe tener entre 2 y 255 caracteres.',
      );
    }

    const basePrice = toNumberOrNull(args.base_price);
    if (basePrice === null || basePrice < 0) {
      return failure(
        name,
        'base_price es obligatorio y no puede ser negativo. Es el precio de venta SIN impuestos.',
      );
    }

    const costPrice = toNumberOrNull(args.cost_price);
    if (costPrice !== null && costPrice < 0) {
      return failure(name, 'cost_price no puede ser negativo.');
    }

    const productType = cleanString(args.product_type) ?? ProductType.PHYSICAL;
    if (
      productType !== ProductType.PHYSICAL &&
      productType !== ProductType.SERVICE &&
      productType !== ProductType.PREPARED
    ) {
      return failure(
        name,
        'product_type solo acepta "physical" (producto físico), "service" (servicio) o "prepared" (plato o preparación).',
      );
    }

    const initialStock = toNumberOrNull(args.initial_stock) ?? 0;
    if (!Number.isInteger(initialStock) || initialStock < 0) {
      return failure(
        name,
        'initial_stock debe ser un entero mayor o igual a cero.',
      );
    }

    const sku = cleanString(args.sku);
    const barcode = cleanString(args.barcode);

    // Réplicas de las precondiciones de `ProductsService.create`: slug, SKU y
    // código de barras únicos dentro de la tienda (PROD_DUP_001 /
    // PROD_BARCODE_DUP_001).
    const slug = generateSlug(name);
    const slugConflict: any = await prisma.products.findFirst({
      where: { slug },
      select: { id: true, name: true },
    });
    if (slugConflict) {
      return failure(
        name,
        `Ya existe un producto con un nombre equivalente: "${slugConflict.name}" (id ${slugConflict.id}).`,
        'Confirma con el usuario si quiere editar ese producto en vez de crear otro, o dale un nombre distinto.',
      );
    }

    if (sku) {
      const skuConflict: any = await prisma.products.findFirst({
        where: { sku },
        select: { id: true, name: true },
      });
      if (skuConflict) {
        return failure(
          name,
          `El SKU "${sku}" ya lo usa "${skuConflict.name}" (id ${skuConflict.id}).`,
        );
      }
    }

    if (barcode) {
      const barcodeProduct: any = await prisma.products.findFirst({
        where: { barcode },
        select: { id: true, name: true },
      });
      if (barcodeProduct) {
        return failure(
          name,
          `El código de barras "${barcode}" ya lo usa "${barcodeProduct.name}" (id ${barcodeProduct.id}).`,
        );
      }
      const barcodeVariant: any = await prisma.product_variants.findFirst({
        where: { barcode },
        select: { id: true },
      });
      if (barcodeVariant) {
        return failure(
          name,
          `El código de barras "${barcode}" ya lo usa la variante ${barcodeVariant.id}.`,
        );
      }
    }

    const categoryIds = Array.isArray(args.category_ids)
      ? args.category_ids
          .map((value: unknown) => toPositiveInt(value))
          .filter((value): value is number => value !== null)
      : undefined;
    const brandId = args.brand_id ? toPositiveInt(args.brand_id) : null;

    const dto: CreateProductDto = {
      name,
      base_price: round2(basePrice),
      ...(costPrice !== null && { cost_price: round2(costPrice) }),
      ...(sku && { sku }),
      ...(barcode && { barcode }),
      ...(cleanString(args.description) && {
        description: cleanString(args.description),
      }),
      product_type: productType as ProductType,
      ...(typeof args.track_inventory === 'boolean' && {
        track_inventory: args.track_inventory,
      }),
      ...(typeof args.is_sellable === 'boolean' && {
        is_sellable: args.is_sellable,
      }),
      ...(typeof args.available_for_ecommerce === 'boolean' && {
        available_for_ecommerce: args.available_for_ecommerce,
      }),
      ...(brandId && { brand_id: brandId }),
      ...(categoryIds?.length && { category_ids: categoryIds }),
      ...(initialStock > 0 && { stock_quantity: initialStock }),
    };

    return {
      ok: true,
      value: { dto, label: name, initialStock, costPrice },
    };
  }

  return [
    // ─── Tool 2: update_product_price ────────────────────────────────
    {
      name: 'update_product_price',
      domain: 'products',
      requiresConfirmation: true,
      description:
        'Cambia el precio de venta de un producto o de una variante. Acepta el precio exacto (new_price) o un porcentaje (percent_change: 10 sube 10%, -15 baja 15%). Con apply_to = "sale" cambia el precio de oferta y deja el producto en promoción; por defecto cambia el precio normal. Los precios se manejan SIN impuestos: el precio al público se calcula sumando las tarifas asignadas. Requiere product_id: obtenlo con find_product, que también te dice si el producto maneja variantes. No sirve para tarifas por volumen o por empaque (esas se editan en el módulo de productos).',
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
              'Variante cuyo precio se cambia. Obligatorio cuando el cambio es de una presentación concreta.',
          },
          new_price: {
            type: 'number',
            description:
              'Precio exacto SIN impuestos. Excluyente con percent_change.',
          },
          percent_change: {
            type: 'number',
            description:
              'Variación porcentual sobre el precio vigente: 10 sube un 10%, -15 baja un 15%. Excluyente con new_price.',
          },
          apply_to: {
            type: 'string',
            enum: ['base', 'sale'],
            description:
              'base (por defecto): precio normal. sale: precio de oferta, que además pone el producto en promoción.',
          },
        },
        required: ['product_id'],
      },
      requiredPermissions: ['store:products:update'],
      preview: async (args, context) => {
        const resolved = await resolvePriceTarget(args, context.store_id);
        if (!resolved.ok) {
          return previewError(
            resolved.label,
            [resolved.message, resolved.nextStep].filter(Boolean).join(' '),
            'products',
          );
        }

        const target = resolved.value;
        const changes: ToolPreview['changes'] = [
          {
            field: target.field,
            label: PRICE_FIELD_LABELS[target.field],
            from: target.currentPrice,
            to: target.newPrice,
          },
        ];
        if (target.activatesSale) {
          changes.push({
            field: 'is_on_sale',
            label: 'Producto en oferta',
            from: false,
            to: true,
          });
        }

        const variationPct =
          target.currentPrice > 0
            ? round2(
                ((target.newPrice - target.currentPrice) /
                  target.currentPrice) *
                  100,
              )
            : null;
        const publicPrice = round2(target.newPrice * (1 + target.taxRate));

        const notes: string[] = [];
        if (variationPct !== null) {
          notes.push(
            `Variación de ${variationPct > 0 ? '+' : ''}${variationPct}%.`,
          );
        }
        notes.push(
          target.taxRate > 0
            ? `Precio al público con impuestos: ${publicPrice}.`
            : 'El producto no tiene impuestos asignados: el precio al público es el mismo.',
        );

        const warning =
          target.newPrice === 0
            ? 'El producto quedaría en cero: se podría vender gratis.'
            : null;
        if (warning) notes.push(warning);

        return {
          status: warning ? 'warning' : 'ok',
          target: target.label,
          changes,
          message: notes.join(' '),
          domain: 'products',
        };
      },
      handler: async (args, context) => {
        try {
          // Re-cálculo contra el precio VIGENTE, no contra el que vio el
          // preview: si alguien movió el precio entretanto, un porcentaje se
          // aplica sobre el nuevo valor y la respuesta lo dice explícitamente.
          const resolved = await resolvePriceTarget(args, context.store_id);
          if (!resolved.ok) {
            return toolError(resolved.message, resolved.nextStep);
          }
          const target = resolved.value;

          if (target.variantId) {
            const dto: UpdateProductVariantDto =
              target.field === 'sale_price'
                ? { sale_price: target.newPrice, is_on_sale: true }
                : { price_override: target.newPrice };
            await productsService.updateVariant(target.variantId, dto);
          } else {
            const dto: UpdateProductDto =
              target.field === 'sale_price'
                ? { sale_price: target.newPrice, is_on_sale: true }
                : { base_price: target.newPrice };
            await productsService.update(target.productId, dto, { lean: true });
          }

          return JSON.stringify({
            summary: `${target.label}: ${PRICE_FIELD_LABELS[target.field]} ${target.currentPrice} → ${target.newPrice}.`,
            data: {
              product_id: target.productId,
              product_variant_id: target.variantId,
              field: target.field,
              previous_price: target.currentPrice,
              new_price: target.newPrice,
              public_price_with_tax: round2(
                target.newPrice * (1 + target.taxRate),
              ),
            },
            note: 'El precio se aplicó sobre el valor vigente en el momento de confirmar.',
          });
        } catch (error) {
          const { code, message } = describeError(error);
          return toolError(
            `No se pudo cambiar el precio${code ? ` (${code})` : ''}: ${message}`,
          );
        }
      },
    },

    // ─── Tool 5: create_product ──────────────────────────────────────
    {
      name: 'create_product',
      domain: 'products',
      requiresConfirmation: true,
      description:
        'Da de alta un producto o servicio nuevo en el catálogo de la tienda. Pide siempre al usuario el nombre y el precio de venta SIN impuestos; el resto (costo, SKU, código de barras, categoría, marca) es opcional. Puede cargar unas existencias iniciales en la bodega por defecto con initial_stock. Antes de crear, usa find_product para asegurarte de que no exista ya con otro nombre — un catálogo con duplicados rompe los informes. No crea variantes ni asigna impuestos: eso se hace después en el módulo de productos.',
      parameters: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description:
              'Nombre comercial del producto. Entre 2 y 255 caracteres.',
          },
          base_price: {
            type: 'number',
            description: 'Precio de venta SIN impuestos.',
          },
          cost_price: {
            type: 'number',
            description: 'Costo de compra o de producción por unidad.',
          },
          sku: {
            type: 'string',
            description:
              'Código interno del producto. Debe ser único en la tienda.',
          },
          barcode: {
            type: 'string',
            description: 'Código de barras. Debe ser único en la tienda.',
          },
          description: {
            type: 'string',
            description: 'Descripción del producto.',
          },
          product_type: {
            type: 'string',
            enum: [
              ProductType.PHYSICAL,
              ProductType.SERVICE,
              ProductType.PREPARED,
            ],
            description:
              'physical (por defecto): producto físico. service: servicio. prepared: plato o preparación de cocina.',
          },
          track_inventory: {
            type: 'boolean',
            description:
              'Si el producto lleva control de existencias. Por defecto lo decide la tienda; los servicios normalmente no.',
          },
          is_sellable: {
            type: 'boolean',
            description:
              'Si se puede vender directamente. false lo marca como insumo interno (restaurantes).',
          },
          available_for_ecommerce: {
            type: 'boolean',
            description: 'Si se publica en la tienda en línea.',
          },
          brand_id: { type: 'number', description: 'ID de la marca.' },
          category_ids: {
            type: 'array',
            items: { type: 'number' },
            description: 'IDs de las categorías a las que pertenece.',
          },
          initial_stock: {
            type: 'number',
            description:
              'Unidades con las que nace el producto en la bodega por defecto. Entero. Omítelo si la mercancía todavía no llegó.',
          },
        },
        required: ['name', 'base_price'],
      },
      requiredPermissions: ['store:products:create'],
      preview: async (args, context) => {
        const resolved = await resolveNewProduct(args, context.store_id);
        if (!resolved.ok) {
          return previewError(
            resolved.label,
            [resolved.message, resolved.nextStep].filter(Boolean).join(' '),
            'products',
          );
        }

        const { dto, label, initialStock, costPrice } = resolved.value;
        const changes: ToolPreview['changes'] = [
          { field: 'name', label: 'Nombre', from: null, to: dto.name },
          {
            field: 'base_price',
            label: 'Precio base (sin impuestos)',
            from: null,
            to: dto.base_price,
          },
        ];
        if (dto.cost_price !== undefined) {
          changes.push({
            field: 'cost_price',
            label: 'Costo',
            from: null,
            to: dto.cost_price,
          });
        }
        if (dto.sku) {
          changes.push({ field: 'sku', label: 'SKU', from: null, to: dto.sku });
        }
        if (dto.barcode) {
          changes.push({
            field: 'barcode',
            label: 'Código de barras',
            from: null,
            to: dto.barcode,
          });
        }
        changes.push({
          field: 'product_type',
          label: 'Tipo',
          from: null,
          to: dto.product_type,
        });
        if (initialStock > 0) {
          changes.push({
            field: 'stock_quantity',
            label: 'Existencias iniciales (bodega por defecto)',
            from: 0,
            to: initialStock,
          });
        }

        const warnings: string[] = [];
        if (costPrice !== null && dto.base_price <= costPrice) {
          warnings.push(
            `El precio de venta (${dto.base_price}) no supera al costo (${costPrice}): el producto se vendería a pérdida.`,
          );
        }
        if (initialStock > 0) {
          warnings.push(
            `Se cargarán ${initialStock} unidades como existencias iniciales en la bodega por defecto.`,
          );
        }

        return {
          status: warnings.length ? 'warning' : 'ok',
          target: label,
          changes,
          message:
            warnings.length > 0
              ? warnings.join(' ')
              : 'El producto se crea activo y sin impuestos asignados; revisa sus impuestos en el módulo de productos.',
          domain: 'products',
        };
      },
      handler: async (args, context) => {
        try {
          // Re-verificación: otro usuario pudo crear el mismo SKU, nombre o
          // código de barras entre la propuesta y la confirmación.
          const resolved = await resolveNewProduct(args, context.store_id);
          if (!resolved.ok) {
            return toolError(resolved.message, resolved.nextStep);
          }

          const created: any = await productsService.create(resolved.value.dto);

          return JSON.stringify({
            summary: `Producto "${created?.name ?? resolved.value.label}" creado.`,
            data: {
              product_id: created?.id,
              name: created?.name,
              sku: created?.sku ?? null,
              base_price: resolved.value.dto.base_price,
              product_type: resolved.value.dto.product_type,
              initial_stock: resolved.value.initialStock,
            },
            next_step:
              'Si el producto lleva impuestos, variantes o tarifas por empaque, configúralos en el módulo de productos. Para ajustar existencias más adelante usa adjust_stock.',
          });
        } catch (error) {
          const { code, message } = describeError(error);
          return toolError(
            `No se pudo crear el producto${code ? ` (${code})` : ''}: ${message}`,
          );
        }
      },
    },
  ];
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. CLIENTES — upsert_customer
// ─────────────────────────────────────────────────────────────────────────────

export interface CustomerWriteToolDeps {
  customersService: CustomersService;
  /**
   * `StorePrismaService`. Ojo: su getter `users` devuelve el cliente SIN scope
   * (`vendix-prisma-scopes`), así que toda consulta a `users` de este bloque
   * lleva el filtro de tienda/organización escrito a mano.
   */
  prisma: StorePrismaService;
}

/** Campos que la herramienta sabe escribir, con su etiqueta para la propuesta. */
const CUSTOMER_FIELD_LABELS: Record<string, string> = {
  first_name: 'Nombres',
  last_name: 'Apellidos',
  email: 'Correo',
  phone: 'Teléfono',
  document_type: 'Tipo de documento',
  document_number: 'Número de documento',
  person_type: 'Tipo de persona',
  tax_regime: 'Régimen fiscal',
  is_withholding_agent: 'Agente de retención',
};

const PHONE_PATTERN = /^[\d+#*\s()-]*$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface CustomerUpsert {
  mode: 'create' | 'update';
  customerId: number | null;
  label: string;
  payload: Record<string, unknown>;
  changes: ToolPreview['changes'];
}

export function createCustomerWriteTools(
  deps: CustomerWriteToolDeps,
): RegisteredTool[] {
  const { customersService, prisma } = deps;

  /** `stores` NO está scopeado: el filtro por id es obligatorio. */
  async function resolveOrganizationId(
    storeId: number,
    contextOrgId?: number,
  ): Promise<number | null> {
    if (contextOrgId) return contextOrgId;
    const store: any = await prisma.stores.findFirst({
      where: { id: storeId },
      select: { organization_id: true },
    });
    return store?.organization_id ?? null;
  }

  async function resolveUpsert(
    args: Record<string, any>,
    storeId: number | undefined,
    contextOrgId: number | undefined,
  ): Promise<Resolution<CustomerUpsert>> {
    const label = 'Cliente';

    if (!storeId) {
      return failure(
        label,
        'Sin tienda en contexto: los clientes pertenecen siempre a una tienda.',
      );
    }

    const customerId = args.customer_id
      ? toPositiveInt(args.customer_id)
      : null;
    if (args.customer_id && !customerId) {
      return failure(
        label,
        'customer_id inválido.',
        'Usa find_customer para obtener el customer_id, o omítelo para crear un cliente nuevo.',
      );
    }

    const firstName = cleanString(args.first_name);
    const lastName = cleanString(args.last_name);
    const email = cleanString(args.email);
    const phone = cleanString(args.phone);
    const documentType = cleanString(args.document_type)?.toUpperCase();
    const documentNumber = cleanString(args.document_number);
    const personType = cleanString(args.person_type)?.toUpperCase();
    const taxRegime = cleanString(args.tax_regime);
    const isWithholdingAgent =
      typeof args.is_withholding_agent === 'boolean'
        ? args.is_withholding_agent
        : undefined;

    // ── Validaciones de formato: aquí no corre el ValidationPipe, así que las
    // reglas de los DTOs (@IsEmail, @Matches, @IsIn, @DocumentNumberMatchesType)
    // se replican a mano o el fallo aparecería como un 500 opaco.
    if (email && !EMAIL_PATTERN.test(email)) {
      return failure(label, `"${email}" no es un correo válido.`);
    }
    if (phone && !PHONE_PATTERN.test(phone)) {
      return failure(
        label,
        'El teléfono solo puede tener números y los símbolos + # * ( ) -.',
      );
    }
    if (
      documentType &&
      !DOCUMENT_TYPE_CODES.includes(documentType as DocumentTypeCode)
    ) {
      return failure(
        label,
        `El tipo de documento "${documentType}" no existe. Válidos: ${DOCUMENT_TYPE_CODES.join(', ')}.`,
      );
    }
    if (documentNumber && !documentType) {
      return failure(
        label,
        'Falta el tipo de documento: un número sin tipo no se puede validar ni usar para facturar.',
      );
    }
    if (documentType && documentNumber) {
      const rule = DOCUMENT_TYPE_RULES[documentType as DocumentTypeCode];
      if (rule && !rule.regex.test(documentNumber)) {
        return failure(
          label,
          `El número "${documentNumber}" no tiene el formato de ${rule.label}.`,
        );
      }
    }
    if (personType && personType !== 'NATURAL' && personType !== 'JURIDICA') {
      return failure(label, 'person_type solo acepta NATURAL o JURIDICA.');
    }

    const organizationId = await resolveOrganizationId(storeId, contextOrgId);
    if (!organizationId) {
      return failure(
        label,
        'No se pudo resolver la organización de la tienda: sin ella no se puede validar que el documento no esté repetido.',
      );
    }

    // ── Alta ────────────────────────────────────────────────────────────────
    if (!customerId) {
      if (!firstName || !lastName) {
        return failure(
          label,
          'Para crear un cliente hacen falta al menos los nombres y los apellidos.',
          'Pídeselos al usuario. El correo es opcional; el documento es necesario si se le va a facturar.',
        );
      }

      const newLabel = `${firstName} ${lastName}`.trim();

      if (email) {
        const emailConflict: any = await prisma.users.findFirst({
          where: {
            email: email.toLowerCase(),
            organization_id: organizationId,
          },
          select: { id: true, first_name: true, last_name: true },
        });
        if (emailConflict) {
          return failure(
            newLabel,
            `El correo ${email} ya lo tiene ${fullName(emailConflict) || `el usuario ${emailConflict.id}`}.`,
            'Usa find_customer para localizarlo y edítalo pasando su customer_id.',
          );
        }
      }

      if (documentType && documentNumber) {
        const documentConflict: any =
          await customersService.findByDocumentInOrganization(
            organizationId,
            documentNumber,
            documentType,
          );
        if (documentConflict) {
          return failure(
            newLabel,
            `Ya existe un cliente con documento ${documentType} ${documentNumber}: ${fullName(documentConflict) || `id ${documentConflict.id}`} (customer_id ${documentConflict.id}).`,
            'Es el mismo cliente: edítalo pasando ese customer_id en vez de crear uno nuevo.',
          );
        }
      }

      const payload: Record<string, unknown> = {
        first_name: firstName,
        last_name: lastName,
        ...(email && { email }),
        ...(phone && { phone }),
        ...(documentType && { document_type: documentType }),
        ...(documentNumber && { document_number: documentNumber }),
        ...(personType && { person_type: personType }),
        ...(taxRegime && { tax_regime: taxRegime }),
        ...(isWithholdingAgent !== undefined && {
          is_withholding_agent: isWithholdingAgent,
        }),
      };

      const changes: ToolPreview['changes'] = Object.entries(payload).map(
        ([field, value]) => ({
          field,
          label: CUSTOMER_FIELD_LABELS[field] ?? field,
          from: null,
          to: value,
        }),
      );

      return {
        ok: true,
        value: {
          mode: 'create',
          customerId: null,
          label: newLabel,
          payload,
          changes,
        },
      };
    }

    // ── Edición ─────────────────────────────────────────────────────────────
    let existing: any;
    try {
      existing = await customersService.findOne(storeId, customerId);
    } catch {
      return failure(
        label,
        `No existe un cliente con id ${customerId} en esta tienda.`,
        'Usa find_customer con el nombre, el documento o el teléfono para obtener el customer_id correcto.',
      );
    }

    const currentLabel = fullName(existing) || `Cliente ${customerId}`;

    const candidate: Record<string, unknown> = {
      ...(firstName !== undefined && { first_name: firstName }),
      ...(lastName !== undefined && { last_name: lastName }),
      ...(email !== undefined && { email }),
      ...(phone !== undefined && { phone }),
      ...(documentType !== undefined && { document_type: documentType }),
      ...(documentNumber !== undefined && { document_number: documentNumber }),
      ...(personType !== undefined && { person_type: personType }),
      ...(taxRegime !== undefined && { tax_regime: taxRegime }),
      ...(isWithholdingAgent !== undefined && {
        is_withholding_agent: isWithholdingAgent,
      }),
    };

    const changes: ToolPreview['changes'] = [];
    const payload: Record<string, unknown> = {};
    for (const [field, value] of Object.entries(candidate)) {
      const current = existing[field] ?? null;
      const normalizedCurrent =
        typeof current === 'string' ? current : (current ?? null);
      if (String(normalizedCurrent ?? '') === String(value ?? '')) continue;
      payload[field] = value;
      changes.push({
        field,
        label: CUSTOMER_FIELD_LABELS[field] ?? field,
        from: normalizedCurrent,
        to: value,
      });
    }

    if (!changes.length) {
      return failure(
        currentLabel,
        'Los datos enviados son idénticos a los que ya tiene el cliente: no hay nada que cambiar.',
      );
    }

    // Unicidad de documento dentro de la organización, réplica de
    // `CustomersService.update`.
    if (payload.document_number || payload.document_type) {
      const effectiveType =
        (payload.document_type as string | undefined) ??
        existing.document_type ??
        null;
      const effectiveNumber =
        (payload.document_number as string | undefined) ??
        existing.document_number ??
        null;
      if (effectiveType && effectiveNumber && existing.organization_id) {
        const conflict: any =
          await customersService.findByDocumentInOrganization(
            existing.organization_id,
            effectiveNumber,
            effectiveType,
          );
        if (conflict && conflict.id !== customerId) {
          return failure(
            currentLabel,
            `El documento ${effectiveType} ${effectiveNumber} ya lo tiene ${fullName(conflict) || `el cliente ${conflict.id}`}.`,
          );
        }
      }
    }

    if (payload.email && existing.organization_id) {
      const emailConflict: any = await prisma.users.findFirst({
        where: {
          email: String(payload.email).toLowerCase(),
          organization_id: existing.organization_id,
          NOT: { id: customerId },
        },
        select: { id: true, first_name: true, last_name: true },
      });
      if (emailConflict) {
        return failure(
          currentLabel,
          `El correo ${payload.email} ya lo tiene ${fullName(emailConflict) || `el usuario ${emailConflict.id}`}.`,
        );
      }
    }

    return {
      ok: true,
      value: {
        mode: 'update',
        customerId,
        label: currentLabel,
        payload,
        changes,
      },
    };
  }

  return [
    {
      name: 'upsert_customer',
      domain: 'customers',
      requiresConfirmation: true,
      description:
        'Crea un cliente nuevo o corrige los datos de uno existente. Sin customer_id crea (hacen falta nombres y apellidos); con customer_id edita solo los campos que le pases. Antes de crear, busca siempre con find_customer: si el cliente ya existe hay que editarlo, porque un cliente duplicado parte su historial de compras y su cartera en dos. El documento (tipo + número) es lo que permite facturarle y no se puede repetir en la organización. No borra clientes ni cambia contraseñas.',
      parameters: {
        type: 'object',
        properties: {
          customer_id: {
            type: 'number',
            description:
              'ID del cliente a editar, obtenido con find_customer. Omítelo para crear uno nuevo.',
          },
          first_name: {
            type: 'string',
            description: 'Nombres. Obligatorio al crear.',
          },
          last_name: {
            type: 'string',
            description: 'Apellidos. Obligatorio al crear.',
          },
          email: {
            type: 'string',
            description: 'Correo electrónico. Opcional.',
          },
          phone: {
            type: 'string',
            description: 'Teléfono. Solo números y los símbolos + # * ( ) -.',
          },
          document_type: {
            type: 'string',
            enum: DOCUMENT_TYPE_CODES,
            description:
              'Tipo de documento DIAN: CC (cédula), CE, NIT, TI, RC, PA (pasaporte), PEP, PPT, DIE, NUIP.',
          },
          document_number: {
            type: 'string',
            description:
              'Número de documento. Debe ir acompañado del tipo y no puede repetirse en la organización.',
          },
          person_type: {
            type: 'string',
            enum: ['NATURAL', 'JURIDICA'],
            description:
              'Persona natural o jurídica. Determina cómo se le aplican las retenciones.',
          },
          tax_regime: {
            type: 'string',
            description: 'Régimen fiscal del cliente.',
          },
          is_withholding_agent: {
            type: 'boolean',
            description: 'Si el cliente es agente de retención.',
          },
        },
      },
      /**
       * Se exigen los DOS permisos porque la herramienta hace las dos cosas y
       * el registry filtra con `every`. Un rol que solo puede crear no la ve:
       * es fail-closed a propósito — preferimos que Vexi no ofrezca la
       * herramienta a que la ofrezca y falle en la mitad de los casos.
       */
      requiredPermissions: ['store:customers:create', 'store:customers:update'],
      preview: async (args, context) => {
        const resolved = await resolveUpsert(
          args,
          context.store_id,
          context.organization_id,
        );
        if (!resolved.ok) {
          return previewError(
            resolved.label,
            [resolved.message, resolved.nextStep].filter(Boolean).join(' '),
            'customers',
          );
        }

        const upsert = resolved.value;
        const isCreate = upsert.mode === 'create';
        const hasDocument =
          !!upsert.payload.document_number || !!upsert.payload.document_type;

        return {
          status: isCreate && !hasDocument ? 'warning' : 'ok',
          target: upsert.label,
          changes: upsert.changes,
          message: isCreate
            ? hasDocument
              ? 'Se crea el cliente y queda asociado a esta tienda.'
              : 'Se crea el cliente sin documento: no se le podrá emitir factura electrónica hasta que se lo registres.'
            : `Se actualizan ${upsert.changes.length} dato(s) del cliente.`,
          domain: 'customers',
        };
      },
      handler: async (args, context) => {
        try {
          const storeId = context.store_id;
          if (!storeId) {
            return toolError(
              'Sin tienda en contexto: los clientes pertenecen siempre a una tienda.',
            );
          }

          // Re-verificación: el documento o el correo pudieron quedar tomados
          // por otro cliente entre la propuesta y la confirmación.
          const resolved = await resolveUpsert(
            args,
            storeId,
            context.organization_id,
          );
          if (!resolved.ok) {
            return toolError(resolved.message, resolved.nextStep);
          }
          const upsert = resolved.value;

          if (upsert.mode === 'create') {
            const created: any = await customersService.create(
              storeId,
              upsert.payload as unknown as CreateCustomerDto,
            );
            return JSON.stringify({
              summary: `Cliente "${fullName(created) || upsert.label}" creado.`,
              data: {
                customer_id: created?.id,
                name: fullName(created) || upsert.label,
                document: created?.document_number ?? null,
                phone: created?.phone ?? null,
                email: created?.email ?? null,
              },
              next_step:
                'Ya puedes usar este customer_id para consultar su historial con get_customer_history.',
            });
          }

          const updated: any = await customersService.update(
            storeId,
            upsert.customerId!,
            upsert.payload as unknown as UpdateCustomerDto,
          );
          return JSON.stringify({
            summary: `Cliente "${fullName(updated) || upsert.label}" actualizado (${upsert.changes.length} campo(s)).`,
            data: {
              customer_id: upsert.customerId,
              updated_fields: upsert.changes.map((change) => change.field),
            },
          });
        } catch (error) {
          const { code, message } = describeError(error);
          return toolError(
            `No se pudo guardar el cliente${code ? ` (${code})` : ''}: ${message}`,
          );
        }
      },
    },
  ];
}

// ─────────────────────────────────────────────────────────────────────────────
// 4 y 6. ÓRDENES — update_order_status, create_dispatch_note
// ─────────────────────────────────────────────────────────────────────────────

export interface OrderWriteToolDeps {
  /**
   * `OrderFlowService` y NO `prisma.orders.update`: es el único escritor
   * legítimo de `orders.state`. Escribir el estado a mano deja reservas de
   * stock huérfanas y se salta el evento `order.shipped` (QUI-557).
   */
  orderFlowService: OrderFlowService;
  dispatchNotesService: DispatchNotesService;
  prisma: StorePrismaService;
}

/**
 * Estados que Vexi puede fijar. `refunded` queda FUERA por la lista de veto:
 * un reembolso mueve dinero y se hace desde el módulo de órdenes, que calcula
 * el monto, escoge el medio de devolución y genera la nota crédito.
 */
const ASSIGNABLE_ORDER_STATES: readonly order_state_enum[] = [
  'draft',
  'created',
  'pending_payment',
  'processing',
  'shipped',
  'delivered',
  'finished',
  'cancelled',
];

/** Qué dispara cada transición, en lenguaje de negocio. */
const STATE_EFFECTS: Partial<Record<order_state_enum, string>> = {
  cancelled:
    'Cancelar libera las unidades apartadas para este pedido y anula sus pagos pendientes.',
  shipped:
    'Marcar como enviada sella la fecha de salida y, en organizaciones con bodega central, consume las unidades reservadas.',
  delivered: 'Marcar como entregada sella la fecha de entrega.',
  finished:
    'Finalizar descuenta definitivamente el inventario y cierra la orden; si no hay existencias suficientes, la operación falla.',
};

interface OrderTransition {
  orderId: number;
  orderNumber: string;
  label: string;
  from: order_state_enum;
  to: order_state_enum;
  forced: boolean;
  remainingBalance: number;
}

interface DispatchPlan {
  orderId: number;
  label: string;
  targetStatus: 'draft' | 'confirmed';
  pendingUnits: number;
  pendingLines: number;
  totalUnits: number;
  deliveryType: string | null;
  orderState: string;
}

export function createOrderWriteTools(
  deps: OrderWriteToolDeps,
): RegisteredTool[] {
  const { orderFlowService, dispatchNotesService, prisma } = deps;

  async function resolveTransition(
    args: Record<string, any>,
    storeId: number | undefined,
  ): Promise<Resolution<OrderTransition>> {
    const label = 'Orden';

    if (!storeId) {
      return failure(
        label,
        'Sin tienda en contexto: las órdenes se gestionan siempre dentro de una tienda.',
      );
    }

    const orderId = toPositiveInt(args.order_id);
    if (!orderId) {
      return failure(
        label,
        'order_id inválido.',
        'Usa find_order o list_orders para obtener el order_id.',
      );
    }

    const requested = cleanString(args.new_state);
    if (!requested) {
      return failure(
        label,
        'Falta new_state: el estado al que se quiere llevar la orden.',
      );
    }

    const order: any = await prisma.orders.findFirst({
      where: { id: orderId },
      select: {
        id: true,
        order_number: true,
        state: true,
        remaining_balance: true,
        dispatch_fulfillment: true,
      },
    });

    if (!order) {
      return failure(
        label,
        `No existe la orden ${orderId} en esta tienda.`,
        'Usa find_order con el número de orden o el nombre del cliente.',
      );
    }

    const orderLabel = `Orden ${order.order_number ?? orderId}`;
    const from = order.state as order_state_enum;

    if (requested === 'refunded') {
      return failure(
        orderLabel,
        'Los reembolsos no se hacen desde aquí: mueven dinero y generan nota crédito.',
        'Deriva al usuario al detalle de la orden, en el módulo de órdenes, donde se registra la devolución con su monto y su medio de pago.',
      );
    }

    if (!ASSIGNABLE_ORDER_STATES.includes(requested as order_state_enum)) {
      return failure(
        orderLabel,
        `El estado "${requested}" no existe. Valores válidos: ${ASSIGNABLE_ORDER_STATES.join(', ')}.`,
      );
    }
    const to = requested as order_state_enum;

    if (from === to) {
      return failure(
        orderLabel,
        `La orden ya está en estado "${from}": no hay nada que cambiar.`,
      );
    }

    if (from === 'refunded') {
      return failure(
        orderLabel,
        'La orden está reembolsada, que es un estado final: ya no admite más transiciones.',
      );
    }

    return {
      ok: true,
      value: {
        orderId,
        orderNumber: String(order.order_number ?? orderId),
        label: orderLabel,
        from,
        to,
        forced: !(VALID_TRANSITIONS[from] ?? []).includes(to),
        remainingBalance: Number(order.remaining_balance ?? 0),
      },
    };
  }

  async function resolveDispatchPlan(
    args: Record<string, any>,
    storeId: number | undefined,
  ): Promise<Resolution<DispatchPlan>> {
    const label = 'Remisión';

    if (!storeId) {
      return failure(
        label,
        'Sin tienda en contexto: las remisiones se generan siempre dentro de una tienda.',
      );
    }

    const orderId = toPositiveInt(args.order_id);
    if (!orderId) {
      return failure(
        label,
        'order_id inválido.',
        'Usa find_order o list_orders para obtener el order_id.',
      );
    }

    const targetStatus = cleanString(args.target_status) ?? 'draft';
    if (targetStatus !== 'draft' && targetStatus !== 'confirmed') {
      return failure(
        label,
        'target_status solo acepta "draft" (borrador) o "confirmed" (confirmada).',
      );
    }

    const order: any = await prisma.orders.findFirst({
      where: { id: orderId },
      select: {
        id: true,
        order_number: true,
        state: true,
        delivery_type: true,
        shipping_address_snapshot: true,
        shipping_address_id: true,
        order_items: {
          select: { id: true, product_name: true, quantity: true },
        },
      },
    });

    if (!order) {
      return failure(
        label,
        `No existe la orden ${orderId} en esta tienda.`,
        'Usa find_order con el número de orden o el nombre del cliente.',
      );
    }

    const orderLabel = `Orden ${order.order_number ?? orderId}`;

    // Precondiciones replicadas de `DispatchNotesService.createFromOrder`.
    if (order.state !== 'processing' && order.state !== 'pending_payment') {
      return failure(
        orderLabel,
        `Una remisión solo se genera para órdenes en preparación (processing) o pendientes de pago con cobro contra entrega (pending_payment); esta está en "${order.state}".`,
        'Si el pedido ya está listo para salir, primero llévalo a processing con update_order_status.',
      );
    }

    if (order.delivery_type === 'direct_delivery') {
      return failure(
        orderLabel,
        'Es una entrega inmediata en mostrador: la mercancía se entrega en el acto y no pasa por el ciclo de remisión.',
      );
    }

    const snapshot = order.shipping_address_snapshot;
    const hasSnapshotAddress =
      !!snapshot &&
      typeof snapshot === 'object' &&
      Object.keys(snapshot as Record<string, unknown>).length > 0;
    if (
      order.delivery_type !== 'pickup' &&
      !hasSnapshotAddress &&
      !order.shipping_address_id
    ) {
      return failure(
        orderLabel,
        'La orden no tiene dirección de entrega y no es recogida en tienda: sin dirección no se puede remisionar.',
        'Registra la dirección de envío en el detalle de la orden y vuelve a intentarlo.',
      );
    }

    // Pendientes por renglón, con la MISMA contabilidad que el servicio:
    // remisiones no anuladas, enlazadas por `sales_order_item_id`.
    const notes: any[] = (await dispatchNotesService.getByOrder(
      orderId,
    )) as any[];
    const dispatchedByItem = new Map<number, number>();
    for (const note of notes) {
      for (const item of note.dispatch_note_items ?? []) {
        if (item.sales_order_item_id == null) continue;
        dispatchedByItem.set(
          item.sales_order_item_id,
          (dispatchedByItem.get(item.sales_order_item_id) ?? 0) +
            Number(item.dispatched_quantity ?? 0),
        );
      }
    }

    let pendingUnits = 0;
    let pendingLines = 0;
    let totalUnits = 0;
    for (const item of order.order_items ?? []) {
      const ordered = Number(item.quantity ?? 0);
      totalUnits += ordered;
      const pending = ordered - (dispatchedByItem.get(item.id) ?? 0);
      if (pending > 0) {
        pendingUnits += pending;
        pendingLines += 1;
      }
    }

    if (pendingUnits <= 0) {
      return failure(
        orderLabel,
        'La orden ya está totalmente remisionada: no queda nada por despachar.',
        'Consulta get_dispatch_status para ver las remisiones que ya tiene.',
      );
    }

    return {
      ok: true,
      value: {
        orderId,
        label: orderLabel,
        targetStatus,
        pendingUnits,
        pendingLines,
        totalUnits,
        deliveryType: order.delivery_type ?? null,
        orderState: String(order.state),
      },
    };
  }

  return [
    // ─── Tool 4: update_order_status ─────────────────────────────────
    {
      name: 'update_order_status',
      domain: 'orders',
      requiresConfirmation: true,
      description:
        'Cambia el estado de una orden: marcarla en preparación, enviada, entregada, finalizada o cancelada. Ejecuta los efectos reales de cada transición (liberar o descontar las unidades apartadas, sellar fechas, avisar a los procesos que dependen del envío), por eso es la única forma correcta de mover una orden. Requiere order_id: obtenlo con find_order. Los reembolsos NO se hacen aquí — mueven dinero y van por el detalle de la orden.',
      parameters: {
        type: 'object',
        properties: {
          order_id: {
            type: 'number',
            description:
              'ID de la orden, obtenido con find_order o list_orders.',
          },
          new_state: {
            type: 'string',
            enum: ASSIGNABLE_ORDER_STATES,
            description:
              'draft: borrador. created: creada. pending_payment: pendiente de pago. processing: en preparación. shipped: enviada. delivered: entregada. finished: finalizada (descuenta inventario). cancelled: cancelada (libera lo apartado).',
          },
          reason: {
            type: 'string',
            description:
              'Motivo del cambio. Queda en la traza de auditoría de la orden; es obligatorio de hecho para cancelaciones, aunque el sistema ponga uno genérico.',
          },
        },
        required: ['order_id', 'new_state'],
      },
      requiredPermissions: ['store:orders:update'],
      preview: async (args, context) => {
        const resolved = await resolveTransition(args, context.store_id);
        if (!resolved.ok) {
          return previewError(
            resolved.label,
            [resolved.message, resolved.nextStep].filter(Boolean).join(' '),
            'orders',
          );
        }

        const transition = resolved.value;
        const notes: string[] = [];
        const effect = STATE_EFFECTS[transition.to];
        if (effect) notes.push(effect);

        if (transition.forced) {
          notes.push(
            `El flujo normal no permite pasar de "${transition.from}" a "${transition.to}"; se registrará como transición forzada con tu nombre y el motivo.`,
          );
        }
        if (transition.to === 'cancelled' && transition.remainingBalance > 0) {
          notes.push(
            `La orden tiene un saldo pendiente de ${transition.remainingBalance}: cancelarla no devuelve dinero ya cobrado.`,
          );
        }

        return {
          status: transition.forced ? 'warning' : 'ok',
          target: transition.label,
          changes: [
            {
              field: 'state',
              label: 'Estado de la orden',
              from: transition.from,
              to: transition.to,
            },
          ],
          message: notes.join(' '),
          domain: 'orders',
        };
      },
      handler: async (args, context) => {
        try {
          // Re-verificación: la orden pudo avanzar sola (pago conciliado,
          // remisión entregada) entre la propuesta y la confirmación.
          const resolved = await resolveTransition(args, context.store_id);
          if (!resolved.ok) {
            return toolError(resolved.message, resolved.nextStep);
          }
          const transition = resolved.value;

          const reason =
            cleanString(args.reason) ?? 'Cambio de estado solicitado a Vexi';

          await orderFlowService.forceOrderState(
            transition.orderId,
            transition.to,
            { reason },
          );

          return JSON.stringify({
            summary: `${transition.label}: ${transition.from} → ${transition.to}.`,
            data: {
              order_id: transition.orderId,
              order_number: transition.orderNumber,
              previous_state: transition.from,
              new_state: transition.to,
              forced: transition.forced,
              reason,
            },
            note: STATE_EFFECTS[transition.to],
          });
        } catch (error) {
          const { code, message } = describeError(error);
          return toolError(
            `No se pudo cambiar el estado de la orden${code ? ` (${code})` : ''}: ${message}`,
            'Consulta get_order para ver en qué estado quedó realmente.',
          );
        }
      },
    },

    // ─── Tool 6: create_dispatch_note ────────────────────────────────
    {
      name: 'create_dispatch_note',
      domain: 'orders',
      requiresConfirmation: true,
      description:
        'Genera la remisión (nota de despacho) de una orden con TODAS las unidades que le falten por despachar. Es el documento que acompaña la mercancía y el que permite armar rutas de reparto y cobrar contra entrega. Solo aplica a órdenes en preparación o con cobro contra entrega, que tengan dirección de entrega (o sean recogida en tienda) y que no estén ya totalmente remisionadas. Nace en borrador salvo que pidas confirmarla. Requiere order_id: obtenlo con find_order, y revisa antes get_dispatch_status para saber qué falta.',
      parameters: {
        type: 'object',
        properties: {
          order_id: {
            type: 'number',
            description:
              'ID de la orden, obtenido con find_order o list_orders.',
          },
          target_status: {
            type: 'string',
            enum: ['draft', 'confirmed'],
            description:
              'draft (por defecto): queda en borrador para revisar antes de que salga la mercancía. confirmed: la deja lista para despachar de una vez.',
          },
          notes: {
            type: 'string',
            description: 'Observaciones que quedan impresas en la remisión.',
          },
        },
        required: ['order_id'],
      },
      requiredPermissions: ['store:dispatch_notes:create'],
      preview: async (args, context) => {
        const resolved = await resolveDispatchPlan(args, context.store_id);
        if (!resolved.ok) {
          return previewError(
            resolved.label,
            [resolved.message, resolved.nextStep].filter(Boolean).join(' '),
            'dispatch',
          );
        }

        const plan = resolved.value;
        const partial = plan.pendingUnits < plan.totalUnits;
        const notes: string[] = [];
        if (partial) {
          notes.push(
            `La orden ya tenía unidades remisionadas: esta remisión cubre las ${plan.pendingUnits} que faltaban de ${plan.totalUnits}.`,
          );
        }
        if (plan.targetStatus === 'confirmed') {
          notes.push(
            'Al confirmarla queda lista para salir y ya no es un borrador editable.',
          );
        }
        if (plan.deliveryType === 'pickup') {
          notes.push(
            'Es una recogida en tienda: la remisión documenta la entrega en mostrador.',
          );
        }

        return {
          status:
            plan.targetStatus === 'confirmed' || partial ? 'warning' : 'ok',
          target: plan.label,
          changes: [
            {
              field: 'dispatch_note',
              label: 'Unidades a remisionar',
              from: 0,
              to: `${plan.pendingUnits} unidad(es) en ${plan.pendingLines} renglón(es)`,
            },
            {
              field: 'status',
              label: 'Estado de la remisión',
              from: null,
              to: plan.targetStatus === 'confirmed' ? 'confirmada' : 'borrador',
            },
          ],
          message: notes.join(' '),
          domain: 'dispatch',
        };
      },
      handler: async (args, context) => {
        try {
          // Re-verificación: otro usuario pudo remisionar la orden, cancelarla
          // o cambiarle la dirección mientras el usuario decidía.
          const resolved = await resolveDispatchPlan(args, context.store_id);
          if (!resolved.ok) {
            return toolError(resolved.message, resolved.nextStep);
          }
          const plan = resolved.value;

          // `items: []` activa el carril "quick-accept" del servicio: despacha
          // todo lo pendiente calculado por él mismo, con su propia lectura.
          const note: any = await dispatchNotesService.createFromOrder(
            plan.orderId,
            {
              items: [],
              target_status: plan.targetStatus,
              ...(cleanString(args.notes) && {
                notes: cleanString(args.notes),
              }),
            },
          );

          return JSON.stringify({
            summary: `Remisión ${note?.dispatch_number ?? note?.id} creada para la ${plan.label} (${plan.pendingUnits} unidad(es)).`,
            data: {
              dispatch_note_id: note?.id,
              dispatch_number: note?.dispatch_number ?? null,
              status: note?.status ?? plan.targetStatus,
              order_id: plan.orderId,
              units: plan.pendingUnits,
            },
            next_step:
              'Usa get_dispatch_status para ver cómo quedó el cumplimiento de la orden. La asignación a una ruta de reparto se hace desde el módulo de despachos.',
          });
        } catch (error) {
          const { code, message } = describeError(error);
          return toolError(
            `No se pudo crear la remisión${code ? ` (${code})` : ''}: ${message}`,
            'Consulta get_dispatch_status para ver el estado real del despacho de esa orden.',
          );
        }
      },
    },
  ];
}
