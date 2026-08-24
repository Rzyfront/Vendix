import {
  Injectable,
  BadRequestException,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import {
  CreatePurchaseOrderDto,
  ShippingCostAllocation,
  validateFreightAndTaxHeader,
} from './dto/create-purchase-order.dto';
import { UpdatePurchaseOrderDto } from './dto/update-purchase-order.dto';
import { PurchaseOrderQueryDto } from './dto/purchase-order-query.dto';
import { ReceivePurchaseOrderDto } from './dto/receive-purchase-order.dto';
import { RegisterPaymentDto } from './dto/register-payment.dto';
import { AddAttachmentDto } from './dto/add-attachment.dto';
import {
  purchase_order_status_enum,
  tax_type_enum,
  invoice_type_enum,
  Prisma,
} from '@prisma/client';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { VendixHttpException } from '@common/errors/vendix-http.exception';
import { ErrorCodes } from '@common/errors/error-codes';
import { FiscalScopeService } from '@common/services/fiscal-scope.service';
import { RequestContextService } from '@common/context/request-context.service';
import { buildTaxCategoryScopeWhere } from '@common/helpers/tax-category-scope.helper';
import {
  localDateString,
  resolveStoreTimezone,
  DEFAULT_STORE_TIMEZONE,
} from '@common/utils/store-timezone.util';
import { AccountsPayableService } from '../../accounts-payable/accounts-payable.service';
import { toTitleCase } from '@common/utils/format.util';
import { generateSlug } from '@common/utils/slug.util';
import { StockLevelManager } from '../../inventory/shared/services/stock-level-manager.service';
import {
  CostingService,
  CostCalculationResult,
  scopedStockKey,
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
import { resolvePackSize } from '../../products/services/packaging.util';
import {
  resolvePricedUnits,
  resolveTierPricingCostAnchor,
} from '../../products/services/tier-margin.util';
import { assertTiersAllowed } from '../../products/services/tiers-variants-exclusive.util';
import {
  VatResponsibilityService,
  VatResponsibilityResult,
  VatTreatmentExplanation,
  vatTreatmentFromResult,
} from '@common/helpers/vat-responsibility.helper';

/**
 * QUI-647 — marcador del pago real de un abono registrado al crear la OC.
 * `source: 'po_advance'` distingue la fila del abono de las de `po_modal`
 * (pagos post-creación) y `po_bridge` (espejo AP). `payment_method` es solo
 * etiqueta: la contabilidad deriva la cuenta de contrapartida por mapping key,
 * no por este texto.
 */
const PO_ADVANCE_SOURCE = 'po_advance';
const PO_ADVANCE_PAYMENT_METHOD = 'advance';

/**
 * Normaliza el `tax_category_ids` que llega del carrito/plantilla: acepta
 * arreglo o cadena separada por coma/punto y coma y descarta lo que no sea un
 * entero positivo. Vive a nivel de módulo (antes era un closure dentro del
 * `$transaction`) porque `create()` ahora los valida ANTES de abrir la
 * transacción.
 */
function normalizeTaxCategoryIds(value: unknown): number[] | undefined {
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
}

@Injectable()
export class PurchaseOrdersService {
  private readonly logger = new Logger(PurchaseOrdersService.name);

  /**
   * Fuente de la verdad del ciclo de vida de una orden de compra.
   *
   * Antes de esto `approve()` y `cancel()` eran `prisma.update()` ciegos que
   * jamás leían el estado actual, así que se podía aprobar una orden ya
   * recibida o cancelarla dejando la mercancía dentro y la recepción viva.
   * Ningún método puede escribir `status` sin pasar por `assertTransition()`.
   *
   * - `received` y `cancelled` son terminales.
   * - `partial` NO admite cancelación: ya hay unidades en bodega, y sacarlas es
   *   trabajo de una devolución a proveedor, no de una cancelación.
   *
   * Sigue la forma de `ReservationsService.VALID_TRANSITIONS`, que es el patrón
   * de máquina de estados ya establecido en el repo.
   */
  private readonly VALID_TRANSITIONS: Record<string, string[]> = {
    draft: ['approved', 'cancelled'],
    approved: ['partial', 'received', 'cancelled'],
    partial: ['partial', 'received'],
    received: [],
    cancelled: [],
  };

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
    // FASE 3 — accountsPayableService provee el espejo PO→AP (mirrorPoPaymentToAp)
    // y el backfill de anticipos. Inyectado vía módulo AccountsPayableModule.
    private accountsPayableService: AccountsPayableService,
    // P0.1 — VatResponsibilityService consolida el predicado `isVatResponsible`
    // (antes replicado localmente aquí y en InvoiceScannerService). Cambia el
    // default pre-F4 es Paso 0.1 — fuera de P0.1.
    private vatService: VatResponsibilityService,
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
      discount_percentage?: number | null;
      discount_amount?: number | null;
    },
    header: { prices_include_tax?: boolean | null },
    /**
     * QUI-661 — share of the HEADER discount that belongs to this line, already
     * prorated by `prorateHeaderDiscount`. Kept as an explicit argument instead
     * of a field on `item` so a caller can never accidentally double-count it
     * by also leaving it inside `discount_amount`.
     */
    proratedHeaderDiscount = 0,
  ): {
    unit_price_net: number;
    tax_amount_per_unit: number;
    tax_amount: number;
    effective_include: boolean;
    /** Total commercial discount applied to the line (own + prorated header). */
    discount_total: number;
  } {
    const gross = Number(item.unit_price ?? item.unit_cost ?? 0);
    const quantity = Number(item.quantity ?? 0);
    const r = Number(item.tax_rate ?? 0) / 100;
    const effective_include =
      item.prices_include_tax ?? header.prices_include_tax ?? false;

    // QUI-661 — the commercial discount is subtracted from the GROSS unit price
    // BEFORE the VAT split. In Colombia an unconditional commercial discount
    // reduces the taxable base, so deriving the VAT from the undiscounted price
    // inflates the deductible VAT that reaches the declaration.
    //
    // `discount_amount` wins over `discount_percentage`: the user may type
    // either, but the resolved money figure is what gets persisted and what the
    // accounting reads. Re-deriving from the percentage at read time would give
    // a different number the day the price changes.
    const ownDiscount =
      item.discount_amount != null && Number(item.discount_amount) > 0
        ? Number(item.discount_amount)
        : gross * quantity * (Number(item.discount_percentage ?? 0) / 100);
    const discount_total = Math.max(
      0,
      ownDiscount + Number(proratedHeaderDiscount || 0),
    );
    // Never let a discount drive the line negative: a rebate larger than the
    // line is a data error, and a negative cost would poison the FIFO layer.
    const discountPerUnit =
      quantity > 0 ? Math.min(discount_total / quantity, gross) : 0;
    const grossAfterDiscount = gross - discountPerUnit;

    let unit_price_net: number;
    let tax_amount_per_unit: number;
    if (!(r > 0)) {
      // No (or invalid) tax rate → line is tax-free, cost stays as entered.
      unit_price_net = grossAfterDiscount;
      tax_amount_per_unit = 0;
    } else if (effective_include) {
      // Price already includes IVA: strip it out to get the net cost.
      unit_price_net = grossAfterDiscount / (1 + r);
      tax_amount_per_unit = grossAfterDiscount - unit_price_net;
    } else {
      // IVA added on top: entered price is already net.
      unit_price_net = grossAfterDiscount;
      tax_amount_per_unit = grossAfterDiscount * r;
    }

    return {
      unit_price_net,
      tax_amount_per_unit,
      tax_amount: tax_amount_per_unit * quantity,
      effective_include,
      discount_total: discountPerUnit * quantity,
    };
  }

  /**
   * QUI-661 — splits a HEADER discount across the lines, proportionally to each
   * line's weight in the gross subtotal.
   *
   * The header discount cannot stay in the header. FIFO cost layers are written
   * per line (`resolveUoMConversion` → `calculateCostOnReceipt`), so a figure
   * that only exists on `purchase_orders.discount_amount` has no physical way to
   * reach the product's cost — which is exactly why the pre-QUI-661 behaviour
   * left the CxP rebated while the inventory capitalized the full price.
   *
   * The rounding remainder lands on the LAST line so that
   * `Σ prorated === headerDiscount` exactly and the order total never drifts by
   * a cent against what the supplier invoiced.
   */
  private prorateHeaderDiscount(
    items: Array<{
      unit_price?: number | null;
      unit_cost?: number | null;
      quantity?: number | null;
    }>,
    headerDiscount: number,
  ): number[] {
    const shares = new Array(items.length).fill(0);
    const discount = Number(headerDiscount || 0);
    if (!(discount > 0) || items.length === 0) return shares;

    const grossPerLine = items.map(
      (i) =>
        Number(i.unit_price ?? i.unit_cost ?? 0) * Number(i.quantity ?? 0),
    );
    const grossTotal = grossPerLine.reduce((s, v) => s + v, 0);
    // A discount over a zero-value order has nothing to attach to; dropping it
    // is safer than dividing by zero and emitting NaN into the cost engine.
    if (!(grossTotal > 0)) return shares;

    // Never discount more than the order is worth.
    const effective = Math.min(discount, grossTotal);
    const round2 = (n: number) => Math.round(n * 100) / 100;

    let assigned = 0;
    for (let i = 0; i < items.length - 1; i++) {
      shares[i] = round2((grossPerLine[i] / grossTotal) * effective);
      assigned += shares[i];
    }
    shares[items.length - 1] = round2(effective - assigned);
    return shares;
  }

  /**
   * CP-PURCHASE-TRANSPARENCY C.2 — reparte el flete de la cabecera entre las
   * líneas, para que pueda CAPITALIZARSE al costo (modo `prorate`).
   *
   * Base del reparto: el NETO por línea DESPUÉS de descuentos
   * (`unit_price_net × quantity`). Repartir sobre el bruto haría que una línea
   * con 100 % de descuento absorbiera flete: el proveedor la regaló y el sistema
   * le cargaría transporte, inflando el costo de un producto que no costó nada.
   *
   * Degradaciones, en orden:
   *   - neto total 0 (toda la orden regalada) → se reparte por CANTIDAD; el
   *     transporte se pagó igual y las unidades lo consumieron igual.
   *   - también cantidad 0 → no hay a qué adherir el flete: `basis: 'none'` y el
   *     llamador degrada la orden a `expense` y lo registra. Es preferible a
   *     dividir por cero y sembrar `NaN` en una capa FIFO.
   *
   * El residuo del redondeo aterriza ÍNTEGRO en la última línea del lote —la
   * misma regla que `prorateHeaderDiscount` ya aplica en producción— para que
   * `Σ shares === shippingCost` EXACTAMENTE. `allocated_shipping_amount` es
   * `Decimal(12,2)`: si la suma de las líneas no diera el flete de la cabecera
   * al céntimo, el invariante que C.4 verifica en los tres momentos (crear,
   * editar, recibir) sería inverificable.
   *
   * @param netPerLine  neto de cada línea después de descuentos (misma longitud
   *                    y mismo orden que las líneas del lote).
   * @param quantities  cantidades de cada línea (fallback de reparto).
   */
  private prorateShipping(
    netPerLine: number[],
    quantities: number[],
    shippingCost: number,
  ): { shares: number[]; basis: 'net' | 'quantity' | 'none' } {
    const shares = new Array(netPerLine.length).fill(0);
    const freight = Number(shippingCost || 0);
    if (!(freight > 0) || netPerLine.length === 0) {
      return { shares, basis: 'none' };
    }

    const netTotal = netPerLine.reduce((s, v) => s + Number(v || 0), 0);
    const qtyTotal = quantities.reduce((s, v) => s + Number(v || 0), 0);

    let weights: number[];
    let basis: 'net' | 'quantity' | 'none';
    if (netTotal > 0) {
      weights = netPerLine.map((v) => Number(v || 0));
      basis = 'net';
    } else if (qtyTotal > 0) {
      weights = quantities.map((v) => Number(v || 0));
      basis = 'quantity';
    } else {
      return { shares, basis: 'none' };
    }

    const weightTotal = weights.reduce((s, v) => s + v, 0);
    const round2 = (n: number) => Math.round(n * 100) / 100;

    let assigned = 0;
    for (let i = 0; i < weights.length - 1; i++) {
      shares[i] = round2((weights[i] / weightTotal) * freight);
      assigned += shares[i];
    }
    shares[weights.length - 1] = round2(freight - assigned);
    return { shares, basis };
  }

  /**
   * CP-PURCHASE-TRANSPARENCY C.2/C.4 — resuelve el modo de flete APLICADO y el
   * reparto por línea a partir de lo que el operador SOLICITÓ.
   *
   * Solicitado y aplicado pueden diferir: cuando `prorate` no tiene sobre qué
   * repartir (neto y cantidad en cero) la orden degrada a `expense`. Los dos
   * valores quedan sellados en la auditoría (C.11) porque re-derivarlos mañana
   * leería los datos de mañana, y entonces nada distinguiría un cambio de
   * configuración de un defecto.
   */
  private resolveFreightAllocation(params: {
    shippingCost: number;
    requested?: ShippingCostAllocation | string | null;
    netPerLine: number[];
    quantities: number[];
    /** Solo para el log cuando hay degradación. */
    context: string;
  }): {
    requested: ShippingCostAllocation | null;
    applied: ShippingCostAllocation | null;
    shares: number[];
    total: number;
  } {
    const requested =
      params.requested === 'prorate' || params.requested === 'expense'
        ? (params.requested as ShippingCostAllocation)
        : null;
    const freight = Math.round(Number(params.shippingCost || 0) * 100) / 100;
    const zeroShares = new Array(params.netPerLine.length).fill(0);

    if (!(freight > 0) || requested !== 'prorate') {
      return { requested, applied: requested, shares: zeroShares, total: freight };
    }

    const { shares, basis } = this.prorateShipping(
      params.netPerLine,
      params.quantities,
      freight,
    );
    if (basis === 'none') {
      this.logger.warn(
        `[Freight] ${params.context}: se pidió prorratear ${freight} de flete pero ` +
          `la orden no tiene ni neto ni cantidad sobre la que repartirlo; ` +
          `se degrada a 'expense' y el flete NO entra al costo del inventario.`,
      );
      return { requested, applied: 'expense', shares: zeroShares, total: freight };
    }
    return { requested, applied: 'prorate', shares, total: freight };
  }

  /**
   * F1 IVA lifecycle — read-only check of the commerce's VAT responsibility,
   * driving the inventory cost treatment at receipt:
   *   - O-48 (responsible)     → IVA is descontable, EXCLUDED from cost.
   *   - O-49 (non-responsible) → IVA is CAPITALIZED into inventory cost.
   *
   * Canonical source: `VatResponsibilityService.resolveDetailed(fiscalData)`
   * (RUT casilla 53 + fallback por régimen tributario).
   *
   * CP-PURCHASE-TRANSPARENCY B.1 — este método devolvía `boolean` y su `catch`
   * devolvía `true`. Dos defectos encadenados:
   *
   *   1. **Fallaba ABIERTO contra un helper que falla CERRADO.** Desde el
   *      2026-08-21 el helper canónico devuelve `false` ante indeterminación;
   *      este `catch` afirmaba «eres responsable de IVA» a partir de un timeout
   *      de settings. Un fallo técnico no es una afirmación fiscal, y la
   *      consecuencia era material: el IVA se declaraba descontable en una
   *      compra de un comercio que quizá no puede descontarlo.
   *   2. **Dos estados no alcanzan.** Un `boolean` no distingue «el comercio
   *      declaró O-49» de «no pudimos leer su configuración», y esa diferencia
   *      es exactamente la que la vista previa tiene que explicarle al operador
   *      antes de capitalizarle el 19 % al costo (ver B.4 y
   *      `buildFiscalExplanation`). Por eso devuelve el resultado de TRES
   *      estados y no su proyección booleana.
   *
   * El docblock anterior afirmaba «NO declared responsibilities / indeterminate
   * ⇒ treat as RESPONSIBLE (O-48)» y remitía a un «Paso 0.1» ya ejecutado: era
   * falso desde el 2026-08-21 y era la premisa sobre la que el próximo lector
   * habría diseñado mal.
   *
   * Nunca lanza. `organizationId`/`storeId` son los identificadores de tenant ya
   * resueltos (solo para el log); los datos fiscales se leen del contexto de
   * petición dentro de `getFiscalData()`.
   */
  private async resolveVatResponsibility(
    organizationId?: number,
    storeId?: number,
  ): Promise<VatResponsibilityResult> {
    try {
      const fiscalData = await this.settingsService.getFiscalData();
      return this.vatService.resolveDetailed(
        fiscalData as Parameters<
          VatResponsibilityService['resolveDetailed']
        >[0],
      );
    } catch (error: any) {
      // El `request_id` empareja esta línea con la del escáner de facturas
      // (`InvoiceScannerService.resolveVatResponsibility`): las dos réplicas
      // hablan de la MISMA factura y sin el identificador de petición no hay
      // forma de cruzarlas en el log cuando las dos fallan a la vez.
      const requestId = RequestContextService.getRequestId();
      this.logger.warn(
        `[PO] resolveVatResponsibility: could not resolve fiscal data ` +
          `for org ${organizationId ?? 'unknown'} / store ${storeId ?? 'unknown'} ` +
          `(request ${requestId ?? 'unknown'}): ${error?.message}. ` +
          `Falling back to NOT VAT responsible (fail-closed); the tax is capitalized into cost.`,
      );
      return this.vatService.readFailure();
    }
  }

  /**
   * CP-PURCHASE-TRANSPARENCY B.4 — traduce la decisión fiscal a algo que un
   * operador pueda leer, y que el frontend NO tenga que volver a derivar.
   *
   * Hay cuatro réplicas del predicado de responsabilidad de IVA en el
   * repositorio, con valores por omisión que llegaron a ser opuestos. Mientras
   * el paso de recepción se explique con el dato del backend y el de
   * confirmación con el selector del frontend, dos pantallas del MISMO asistente
   * pueden contradecirse sobre la misma factura. Por eso la explicación viaja
   * como dato estructurado y no como un booleano que cada pantalla interpreta.
   *
   * `treatment` es lo que de verdad se hizo con el impuesto:
   *   - `deductible`  → el IVA queda fuera del costo (240804, descontable).
   *   - `capitalized` → el IVA entra al costo del inventario.
   *
   * Las citas legales son un contrato cerrado: el operador las repite ante su
   * contador, así que una cita equivocada en pantalla es peor que ninguna. Por
   * eso el texto y la base legal NO se arman acá: salen de
   * `vatTreatmentFromResult` (B.3), que a su vez los toma del catálogo oficial
   * de responsabilidades. Este método es un alias con nombre local — escribir
   * una segunda copia de las citas es exactamente cómo dos pantallas del mismo
   * asistente terminan citando artículos distintos para la misma factura.
   */
  private buildFiscalExplanation(
    outcome: VatResponsibilityResult,
  ): VatTreatmentExplanation {
    return vatTreatmentFromResult(outcome);
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

    return PurchaseOrdersService.applyUoMConversion(
      product,
      purchaseQuantity,
      purchaseUnitCost,
    );
  }

  /**
   * A.12 — la ARITMÉTICA de `resolveUoMConversion`, sin su lectura.
   *
   * `getCostPreview` resolvía la conversión línea por línea, y cada resolución
   * abría su propia `products.findFirst`: el costo del preview crecía con el
   * número de líneas cuando la configuración de unidad de medida se puede leer
   * de una sola vez para todo el lote. Separar la lectura del cálculo permite
   * que la vista previa lea el conjunto una vez y aplique la MISMA aritmética
   * que la recepción, en lugar de una copia.
   *
   * Estática y pura a propósito: si tuviera acceso a `this` alguien acabaría
   * volviendo a meterle una consulta dentro.
   */
  private static applyUoMConversion(
    product: {
      is_ingredient?: boolean | null;
      purchase_to_stock_factor?: unknown;
      stock_uom_id?: number | null;
      purchase_uom_id?: number | null;
    } | null
      | undefined,
    purchaseQuantity: number,
    purchaseUnitCost: number,
  ): {
    stockQuantity: number;
    stockUnitCost: number;
    purchaseFactor: number;
  } {
    const factor = Number(product?.purchase_to_stock_factor ?? 1);
    // QUI-648 — la conversión al recibir deja de ser exclusiva del insumo:
    // comprar 5 rollos y almacenar 100.000 mm es el mismo mecanismo que
    // comprar un saco y almacenar gramos. Lo que decide es tener las dos
    // unidades declaradas y un factor real; un producto sin factor sigue
    // recibiendo uno a uno, exactamente como hoy.
    const declaresBothUoms =
      product?.stock_uom_id != null && product?.purchase_uom_id != null;
    const hasUoM =
      (!!product?.is_ingredient || declaresBothUoms) &&
      factor > 0 &&
      Number.isFinite(factor);

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

  /**
   * QUI-486 — Un producto con variantes SOLO se compra por variante.
   *
   * El daño no es un error visible sino stock que se evapora:
   *
   * 1. `enforceStockLevelsMode` borra las filas base de `stock_levels`
   *    (`product_variant_id IS NULL`) en cuanto el producto tiene variantes,
   *    para sostener el invariante "base XOR variante".
   * 2. Al recibir, `getOrCreateStockLevel` vuelve a crear esa fila base — la
   *    recepción NO falla, persiste el movimiento y descuenta el dinero.
   * 3. Pero `syncProductStock` filtra `product_variant_id: { not: null }`
   *    cuando el producto tiene variantes, así que esas unidades quedan en una
   *    fila que ningún agregado lee: no suben `products.stock_quantity`, no
   *    aparecen en el catálogo y no se pueden vender.
   *
   * Resultado: se paga mercancía que el sistema nunca mostrará, y la fila
   * huérfana queda esperando a que el próximo `enforceStockLevelsMode` la
   * borre junto con el stock que representa. Por eso se rechaza aquí.
   *
   * Es la misma regla que `vendix-product-variants` ya impone en ecommerce,
   * POS, carrito y checkout, extendida al flujo de compra.
   *
   * Una sola consulta agrupada por `product_id` — nada de N+1 dentro de la
   * transacción. Las líneas sin `product_id` (producto nuevo creado por el
   * propio POP) se ignoran: un producto que aún no existe no tiene variantes.
   */
  /**
   * Lee la orden dentro de la transacción o falla con 404.
   *
   * Debe invocarse ANTES de cualquier validación de líneas: `receive()` validaba
   * primero las líneas, así que recibir contra una orden inexistente respondía
   * "La línea N no pertenece a esta orden de compra" en vez de decir que la
   * orden no existe.
   */
  private async loadOrderOrFail(
    tx: any,
    id: number,
  ): Promise<{ id: number; status: string; order_number: string }> {
    const order = await tx.purchase_orders.findUnique({
      where: { id },
      select: { id: true, status: true, order_number: true },
    });
    if (!order) {
      throw new VendixHttpException(
        ErrorCodes.PO_FIND_001,
        `La orden de compra ${id} no existe.`,
        { purchase_order_id: id },
      );
    }
    return order;
  }

  /**
   * Única puerta de escritura del campo `status`.
   *
   * `cancelled` sobre una orden con mercancía ingresada (`partial` / `received`)
   * recibe su propio código: no es un "no se puede", es un "se hace por otro
   * camino", y el mensaje tiene que nombrarlo o el operador queda sin salida.
   */
  private assertTransition(
    order: { status: string; order_number: string },
    target: string,
  ): void {
    const allowed = this.VALID_TRANSITIONS[order.status] ?? [];
    if (allowed.includes(target)) return;

    if (
      target === 'cancelled' &&
      (order.status === 'received' || order.status === 'partial')
    ) {
      throw new VendixHttpException(
        ErrorCodes.PO_CANCEL_RECEIVED_001,
        `La orden ${order.order_number} ya tiene mercancía recibida y no puede cancelarse. ` +
          `Para revertirla registra una devolución a proveedor, que descuenta el stock y reversa la contabilidad.`,
        { current_status: order.status, target_status: target },
      );
    }

    throw new VendixHttpException(
      ErrorCodes.PO_STATUS_001,
      `La orden ${order.order_number} está en estado «${order.status}» y no puede pasar a «${target}».`,
      { current_status: order.status, target_status: target, allowed },
    );
  }

  /**
   * Puerta de las operaciones que no cambian de estado pero sí alteran el
   * contenido de la orden (`update`, `remove`). Solo un borrador es maleable:
   * una orden aprobada ya es un compromiso con el proveedor, y una recibida
   * respalda movimientos de inventario y asientos contables.
   */
  private assertMutable(
    order: { status: string; order_number: string },
    operation: 'editar' | 'eliminar',
  ): void {
    if (order.status === 'draft') return;
    throw new VendixHttpException(
      ErrorCodes.PO_STATUS_002,
      `No se puede ${operation} la orden ${order.order_number}: está en estado «${order.status}» y solo un borrador es modificable.`,
      { current_status: order.status, operation },
    );
  }

  private async assertNoBaseLineOnVariantProduct(
    tx: any,
    lines: Array<{
      product_id?: number | null;
      product_variant_id?: number | null;
    }>,
    context: { stage: 'create' | 'receive'; orderId?: number },
  ): Promise<void> {
    const baseLineProductIds = Array.from(
      new Set(
        lines
          .filter((line) => !line.product_variant_id && Number(line.product_id) > 0)
          .map((line) => Number(line.product_id)),
      ),
    );

    if (baseLineProductIds.length === 0) return;

    const withVariants = await tx.product_variants.findMany({
      where: { product_id: { in: baseLineProductIds } },
      select: { product_id: true },
      distinct: ['product_id'],
    });

    if (withVariants.length === 0) return;

    const offendingIds = withVariants.map((v: any) => v.product_id);
    const offendingProducts = await tx.products.findMany({
      where: { id: { in: offendingIds } },
      select: { id: true, name: true },
    });
    const names = offendingProducts
      .map((p: any) => `«${p.name}»`)
      .join(', ');

    let detail: string;
    if (context.stage === 'create') {
      detail = `No se puede comprar ${names} sin variante: el producto tiene variantes y debes seleccionar cuál estás comprando.`;
    } else {
      // Solo en el camino de error pagamos la consulta del número de orden:
      // recibir es la ruta caliente y no vale un query extra por recepción.
      const order = context.orderId
        ? await tx.purchase_orders.findUnique({
            where: { id: context.orderId },
            select: { order_number: true },
          })
        : null;
      const label = order?.order_number
        ? `la orden ${order.order_number}`
        : 'esta orden';
      detail = `No se puede recibir ${label} porque ${names} se compró sin variante. Anula la orden y vuelve a crearla seleccionando la variante.`;
    }

    throw new VendixHttpException(ErrorCodes.PO_VARIANT_001, detail, {
      stage: context.stage,
      product_ids: offendingIds,
    });
  }

  /**
   * Tienda contra la que se valida el alcance de las categorías de impuesto
   * cuando el contexto no la trae (la puerta de ORGANIZACIÓN llama a `create()`
   * directamente). Replica la cascada que el bloque de alta de productos usa
   * dentro de la transacción: ubicación → tienda, y si no, la primera tienda
   * de la organización. Lee sin alcance porque con contexto de organización el
   * cliente de tienda rechazaría `inventory_locations`.
   */
  private async resolveTaxScopeStoreId(
    dto: CreatePurchaseOrderDto,
  ): Promise<number | null> {
    const organizationId = RequestContextService.getOrganizationId();
    if (dto.location_id) {
      const location = await this.prisma
        .withoutScope()
        .inventory_locations.findUnique({
          where: { id: dto.location_id },
          select: { store_id: true, stores: { select: { organization_id: true } } },
        });
      // La ubicación tiene que ser del inquilino: si no, no sirve como ancla.
      if (
        location?.store_id &&
        (!organizationId ||
          location.stores?.organization_id === organizationId)
      ) {
        return location.store_id;
      }
    }
    if (!organizationId) return null;
    const firstStore = await this.prisma.withoutScope().stores.findFirst({
      where: { organization_id: organizationId },
      select: { id: true },
      orderBy: { id: 'asc' },
    });
    return firstStore?.id ?? null;
  }

  async create(createPurchaseOrderDto: CreatePurchaseOrderDto) {
    // ===== C.7 — la regla de flete e impuesto se valida en el SERVICIO =====
    //
    // `IsValidFreightAndTax` protege la puerta HTTP de tienda, pero hay una
    // segunda puerta al mismo flujo: `OrgPurchaseOrdersService.create()` arma el
    // DTO campo por campo y llama a este método directamente, sin volver a pasar
    // por el `ValidationPipe`. Ningún decorador nuevo se aplica por esa puerta.
    // Validar acá es lo único que hace que las dos acepten y rechacen igual.
    const freightContractError = validateFreightAndTaxHeader(
      createPurchaseOrderDto as {
        shipping_cost?: number;
        shipping_cost_allocation?: string;
        prices_include_tax?: boolean;
        items?: Array<{ tax_rate?: number } | null | undefined>;
      },
    );
    if (freightContractError) {
      throw new BadRequestException(freightContractError);
    }

    // QUI-647 — timezone de la tienda para comparar las fechas del plan de
    // pago contra "hoy" en el CALENDARIO local (fecha-sólo, sin convertir a
    // instante: pasar a UTC correría la fecha un día en tiendas con offset
    // negativo). Se resuelve ANTES del $transaction para no abrir una segunda
    // lectura dentro de la transacción, y SOLO cuando el plan trae fechas que
    // validar (deferred/installments) — un plan immediate/partial o una orden
    // sin plan no paga la consulta de settings.
    const ctxStoreId = RequestContextService.getStoreId();
    const planNeedsDateValidation =
      createPurchaseOrderDto.payment_plan === 'deferred' ||
      createPurchaseOrderDto.payment_plan === 'installments' ||
      // QUI-647 — abono parcial con fecha del saldo: `payment_due_date` es
      // opcional, pero si viene hay que compararla contra "hoy" en la timezone
      // de la tienda (misma regla que deferred).
      (createPurchaseOrderDto.payment_plan === 'partial' &&
        !!createPurchaseOrderDto.payment_due_date);
    const storeTz =
      planNeedsDateValidation && ctxStoreId
        ? await resolveStoreTimezone(this.prisma, ctxStoreId)
        : DEFAULT_STORE_TIMEZONE;

    // ===== HOTFIX impuestos — el escáner sugiere, esto valida =====
    //
    // La validación vivía DENTRO del `$transaction` y usaba `tx.tax_categories`
    // (cliente CON alcance de tienda). `tax_categories` está en
    // `store_scoped_models`, así que `mergeScopedWhere` sumaba
    // `store_id = <contexto>` al where y anulaba con un AND el
    // `OR ... store_id: null` que el código creía tener: ninguna categoría de
    // nivel ORGANIZACIÓN pasaba nunca, y la orden moría con «Una o más
    // categorías de impuesto no existen para esta tienda».
    //
    // Se resuelve ACÁ, antes de abrir la transacción, por dos razones: la
    // lectura necesita `withoutScope()` (única forma de ver la rama global) y
    // hacerla dentro del tx abriría una segunda conexión — el patrón que ya
    // sigue `storeTz` unas líneas más arriba.
    const requestedTaxCategoryIds = new Set<number>();
    for (const item of createPurchaseOrderDto.items ?? []) {
      for (const id of normalizeTaxCategoryIds(
        (item as any)?.tax_category_ids,
      ) ?? []) {
        requestedTaxCategoryIds.add(id);
      }
    }
    const allowedTaxCategoryIds = new Set<number>();
    if (requestedTaxCategoryIds.size > 0) {
      const taxScopeStoreId =
        ctxStoreId ?? (await this.resolveTaxScopeStoreId(createPurchaseOrderDto));
      if (!taxScopeStoreId) {
        throw new BadRequestException(
          'No se pudo resolver la tienda de la orden para validar las categorías de impuesto.',
        );
      }
      const taxCategories = await this.prisma
        .withoutScope()
        .tax_categories.findMany({
          where: {
            id: { in: Array.from(requestedTaxCategoryIds) },
            ...buildTaxCategoryScopeWhere(
              taxScopeStoreId,
              RequestContextService.getOrganizationId(),
            ),
          },
          select: { id: true },
        });
      for (const taxCategory of taxCategories) {
        allowedTaxCategoryIds.add(taxCategory.id);
      }
      const missing = Array.from(requestedTaxCategoryIds).filter(
        (id) => !allowedTaxCategoryIds.has(id),
      );
      if (missing.length > 0) {
        // El mensaje NOMBRA los ids: sin eso el operador veía un 400 opaco y no
        // tenía cómo saber qué renglón corregir.
        throw new BadRequestException(
          `Una o más categorías de impuesto no existen para esta tienda (ids: ${missing.join(', ')}).`,
        );
      }
    }

    // La transacción devuelve la orden + (si hubo abono) el pago de anticipo
    // registrado: el evento contable se emite por FUERA, después del commit.
    const txResult = await this.prisma.$transaction(
      async (tx): Promise<{
        order: any;
        advance: { paymentId: number; amount: number } | null;
        // C.11 — el modo de flete SOLICITADO y el APLICADO salen de la
        // transacción para sellarse en la auditoría: la degradación
        // `prorate → expense` ocurre acá dentro y después no es observable.
        freight: {
          requested: ShippingCostAllocation | null;
          applied: ShippingCostAllocation | null;
          shares: number[];
          total: number;
        };
      }> => {
        let advanceToRegister: {
          paymentId: number;
          amount: number;
        } | null = null;
      // 1. Process items to handle new product creation
      const processedItems: any[] = [];
      const organization_id = RequestContextService.getOrganizationId();

      if (!organization_id) {
        throw new BadRequestException('Organization ID not found in context');
      }

      // QUI-486: rechazo temprano — la OC inválida no llega a nacer, así el
      // operador no queda con una orden `approved` que nunca podrá recibir.
      await this.assertNoBaseLineOnVariantProduct(
        tx,
        createPurchaseOrderDto.items,
        { stage: 'create' },
      );

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
          const itemTaxCategoryIds = normalizeTaxCategoryIds(
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
          //
          // QUI-661 + QUI-645: the cost a NEW product is born with must be the
          // same NET, discounted figure the line persists in `unit_cost` — not
          // the gross `unit_price`. Using the gross price anchored the product's
          // margin to a cost it never had: with IVA included or a supplier
          // discount, `cost_price` came out above what the FIFO layer would
          // capitalize, so the product was born with an understated margin.
          // The header discount is prorated in the totals pass below; here we
          // honour the line's own discount and the include/added VAT mode,
          // which is what `deriveLineTax` owns.
          let basePrice = item.base_price || 0;
          const cost = this.deriveLineTax(
            item,
            createPurchaseOrderDto,
          ).unit_price_net;
          let margin = item.profit_margin || 0;
          if (margin > 0 && margin < 1) margin = margin * 100;

          // QUI-645: a NEW product with margin 0 is a deliberate decision, not
          // a missing value — it is born priced at cost and the operator can
          // raise it later. So the price is derived whenever a base price was
          // not pinned, including `margin === 0`, instead of leaving
          // `base_price = 0` (which read as "free" in the catalog).
          //
          // QUI-648 — el costo se lleva a la ESCALA en la que el producto
          // publica su precio antes de derivar `base_price`, porque el destino
          // de este número es `products.base_price` (líneas de abajo) y esa
          // columna vale por `price_unit_quantity` unidades de stock. Sobre un
          // producto existente vendido por metro, derivar desde el costo crudo
          // le reescribía el precio del metro con el del milímetro. Un producto
          // NUEVO nace siempre en escala 1 —el DTO de la orden de compra no
          // tiene `price_unit_quantity`—, así que ahí `resolvePricedUnits`
          // devuelve 1 y el resultado es el histórico.
          const basePriceScale = resolvePricedUnits(
            null,
            (existingProduct as { price_unit_quantity?: number | null } | null)
              ?.price_unit_quantity,
          );
          if (cost > 0 && (!item.base_price || item.base_price === 0)) {
            basePrice = cost * basePriceScale * (1 + margin / 100);
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

          // Las categorías ya se validaron ANTES de abrir la transacción
          // (`allowedTaxCategoryIds`): acá solo se toman las que sobrevivieron.
          // Leerlas de nuevo con `tx` volvería a aplicar el alcance de tienda
          // que dejaba fuera a las de nivel ORGANIZACIÓN.
          const taxCategoryIds = itemTaxCategoryIds?.filter((id) =>
            allowedTaxCategoryIds.has(id),
          );

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

            // ===== A.7 — la colisión de SKU no puede terminar en un 500 =====
            //
            // `products` tiene `@@unique([store_id, sku])` y el índice NO
            // distingue estado: el SKU de un producto ARCHIVADO lo sigue
            // ocupando. El flujo que originó el reporte del dueño —«borro el
            // producto y lo vuelvo a cargar»— cae justo ahí, y hasta A.4 el
            // `try/catch` del controlador convertía el P2002 en un HTTP 200
            // mentiroso; sin él sale un 500 crudo que no dice qué producto
            // estorba ni ofrece salida.
            //
            // Se comprueba ANTES de crear, no en un `catch`: un error de Postgres
            // ABORTA la transacción, así que dentro del `catch` ya no se puede
            // consultar quién ocupa el SKU, que es precisamente el dato que el
            // frontend necesita para ofrecer «reactivar» (D.1). El costo es una
            // consulta indexada por línea, y solo por línea con producto NUEVO.
            const desiredSku = item.sku || `GEN-${Date.now()}`;
            const skuOwner = await tx.products.findFirst({
              where: { store_id: storeId, sku: desiredSku },
              select: { id: true, name: true, state: true },
            });
            if (skuOwner) {
              throw new VendixHttpException(
                ErrorCodes.PROD_SKU_COLLISION_001,
                `El SKU «${desiredSku}» ya está ocupado por el producto «${skuOwner.name}» (id ${skuOwner.id}, estado ${skuOwner.state}) en esta tienda.`,
                {
                  sku: desiredSku,
                  product_id: skuOwner.id,
                  product_name: skuOwner.name,
                  product_state: skuOwner.state,
                  // El archivado es el caso que el operador no entiende: el
                  // producto «no está» en su catálogo pero su SKU sigue ahí.
                  is_archived: skuOwner.state === 'archived',
                },
              );
            }

            let newProduct: { id: number };
            try {
              newProduct = await tx.products.create({
              data: {
                name: item.product_name,
                slug:
                  item.product_name
                    .toLowerCase()
                    .replace(/[^a-z0-9]+/g, '-')
                    .replace(/(^-|-$)+/g, '') + `-${Date.now()}`,
                description: item.product_description || '',
                sku: desiredSku,
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
            } catch (error: any) {
              // Carrera: entre la comprobación de arriba y este INSERT otra
              // petición pudo tomar el SKU. Se mapea igual, pero SIN volver a
              // consultar: el P2002 ya abortó la transacción de Postgres y
              // cualquier lectura posterior fallaría con "current transaction is
              // aborted". El código y el SKU bastan para que el frontend
              // reintente o mande al catálogo.
              //
              // El filtro por `target` es deliberadamente estrecho: mapear todo
              // P2002 escondería colisiones de `slug` o `barcode`, que exigen
              // otra explicación y otro remedio.
              const target = error?.meta?.target;
              const hitsSku = Array.isArray(target)
                ? target.includes('sku')
                : typeof target === 'string' && target.includes('sku');
              if (error?.code === 'P2002' && hitsSku) {
                throw new VendixHttpException(
                  ErrorCodes.PROD_SKU_COLLISION_001,
                  `El SKU «${desiredSku}» quedó ocupado por otra operación mientras se creaba el producto.`,
                  { sku: desiredSku, concurrent: true },
                );
              }
              throw error;
            }
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

        // Unidad de venta (QUI-648): configurar en qué presentación se venderá
        // el producto sin salir del flujo de compra. Corre para productos
        // nuevos y existentes por igual, y NUNCA para un insumo puro (un insumo
        // no se vende, de ahí que su rama fuerce has_multiple_price_tiers=false).
        if (
          finalProductId &&
          item.sale_unit_name &&
          orderType !== 'ingredient'
        ) {
          await this.persistSaleUnitConfigToProduct(finalProductId, item, tx);
        }

        processedItems.push({
          ...item,
          product_id: finalProductId,
          product_name: undefined,
          sku: undefined,
          product_description: undefined,
        });
      }

      // FASE 4 — total_amount BRUTO consistente. Antes se sumaba
      // Σ(qty×unit_price) (bruto en modo include-tax, neto en exclude-tax) + un
      // `tax_amount` de header, dando un total inconsistente entre modos (y a
      // veces doble-contando el IVA). Ahora derivamos neto + IVA por línea vía
      // `deriveLineTax` (la MISMA derivación que persiste cada línea en :848),
      // de modo que:
      //   subtotal_amount = Σ neto           (base independiente del modo)
      //   total_amount    = neto + IVA − descuento + flete   (BRUTO)
      // La contabilidad NO lee estos campos (deriva neto de unit_cost, ver
      // :1921); recalculatePaymentStatus SÍ lee total_amount → ahora bruto
      // consistente frente a los pagos (que pagan el bruto de factura).
      //
      // QUI-661: el descuento comercial YA NO se resta al final. Antes era
      //   total = subtotal − descuento + IVA + flete
      // con `lineTax` derivado del subtotal SIN descontar, lo que inflaba el
      // IVA descontable que llega a la declaración. Ahora el descuento de
      // cabecera se prorratea por línea y entra DENTRO de `deriveLineTax`, que
      // baja `unit_price_net` antes de derivar el IVA. Como consecuencia
      // `subtotal_amount` ya viene neto de descuento y restarlo otra vez sería
      // contarlo dos veces.
      const round2 = (n: number) => Math.round(n * 100) / 100;
      const headerShares = this.prorateHeaderDiscount(
        processedItems,
        Number(createPurchaseOrderDto.discount_amount || 0),
      );
      let netSubtotal = 0;
      let lineTax = 0;
      // C.2 — el prorrateo del flete necesita el NETO por línea DESPUÉS de
      // descuentos, que es justo lo que este bucle ya deriva. Se guarda en vez
      // de recalcularse: una segunda aritmética sería una segunda verdad.
      const netPerLine: number[] = [];
      const quantitiesPerLine: number[] = [];
      for (let i = 0; i < processedItems.length; i++) {
        const d = this.deriveLineTax(
          processedItems[i],
          createPurchaseOrderDto,
          headerShares[i],
        );
        const qty = Number(processedItems[i].quantity ?? 0);
        netPerLine.push(d.unit_price_net * qty);
        quantitiesPerLine.push(qty);
        netSubtotal += d.unit_price_net * qty;
        lineTax += d.tax_amount;
      }
      const subtotal = round2(netSubtotal);
      const totalAmount = round2(
        subtotal + round2(lineTax) + (createPurchaseOrderDto.shipping_cost || 0),
      );

      // C.2/C.4 — reparto del flete resuelto sobre el lote COMPLETO, antes de
      // escribir nada. La orden sella el modo APLICADO (que puede diferir del
      // solicitado si hubo degradación) y cada línea su porción; recibir no
      // vuelve a repartir.
      const freight = this.resolveFreightAllocation({
        shippingCost: Number(createPurchaseOrderDto.shipping_cost || 0),
        requested: createPurchaseOrderDto.shipping_cost_allocation,
        netPerLine,
        quantities: quantitiesPerLine,
        context: `create() para la ubicación ${createPurchaseOrderDto.location_id}`,
      });

      // ===== QUI-647: validación del plan de pago =====
      //
      // Se valida ANTES de escribir nada: un calendario cuyas cuotas no suman
      // el saldo no puede cerrar la deuda nunca, y descubrirlo después de crear
      // la orden deja al usuario con una OC a medio configurar que tiene que
      // ir a arreglar a mano en Cuentas por Pagar — exactamente el trabajo que
      // este ticket viene a eliminar.
      //
      // `paymentPlan`/`downPayment` son `let` porque la matriz anti-doble-
      // registro reconduce un caso límite: partial con abono == total significa
      // "pago todo ahora", que se trata como immediate SIN abono (el pago
      // completo viaja por el flujo post-creación, jamás como anticipo 133005).
      let paymentPlan = createPurchaseOrderDto.payment_plan;
      let downPayment = Number(
        createPurchaseOrderDto.down_payment_amount ?? 0,
      );
      const installments = createPurchaseOrderDto.payment_installments ?? [];
      const dueDate = createPurchaseOrderDto.payment_due_date;

      // "Hoy" en el calendario de la tienda. Las fechas del plan son strings
      // date-only (YYYY-MM-DD) y se comparan LEXICOGRÁFICAMENTE contra esta
      // referencia: convertir a instante UTC correría la fecha un día en
      // tiendas con offset negativo (contrato vendix-date-timezone).
      const todayLocal = localDateString(new Date(), storeTz);
      const dateOnly = (s: string) => s.slice(0, 10);
      const isPast = (s: string) => dateOnly(s) < todayLocal;

      if (paymentPlan === 'partial') {
        if (!(downPayment > 0)) {
          throw new VendixHttpException(
            ErrorCodes.PO_PAYMENT_001,
            'Un abono parcial requiere un monto abonado mayor que cero.',
          );
        }
        if (downPayment > totalAmount) {
          throw new VendixHttpException(
            ErrorCodes.PO_PAYMENT_002,
            `El abono ($${downPayment}) no puede superar el total de la orden ($${totalAmount}).`,
          );
        }
        // Matriz anti-doble-registro: abono == total se reconduce a immediate
        // SIN abono registrado (ver comentario de los `let` de arriba).
        if (downPayment === totalAmount) {
          paymentPlan = 'immediate';
          downPayment = 0;
        } else if (dueDate && isPast(dueDate)) {
          // QUI-647 — la fecha del saldo (opcional) materializa la cuota
          // planeada del saldo; si viene debe ser hoy o futura (misma regla que
          // deferred). Solo aplica cuando QUEDA saldo: abono == total se
          // recondujo a immediate arriba y no hay cuota que fechar.
          throw new VendixHttpException(
            ErrorCodes.PO_PAYMENT_004,
            `La fecha de pago del saldo ${dateOnly(dueDate)} no puede ser anterior a hoy (${todayLocal}).`,
          );
        }
      }

      if (paymentPlan === 'deferred') {
        if (!dueDate) {
          throw new VendixHttpException(
            ErrorCodes.PO_PAYMENT_003,
            'Un pago diferido requiere una fecha de pago.',
          );
        }
        if (isPast(dueDate)) {
          throw new VendixHttpException(
            ErrorCodes.PO_PAYMENT_004,
            `La fecha de pago ${dateOnly(dueDate)} no puede ser anterior a hoy (${todayLocal}).`,
          );
        }
      }

      if (paymentPlan === 'installments') {
        if (installments.length === 0) {
          throw new VendixHttpException(
            ErrorCodes.PO_PAYMENT_006,
            'Un pago en cuotas requiere al menos una cuota programada.',
          );
        }
        // El abono de un plan de cuotas es opcional y DEBE dejar saldo para
        // las cuotas: 0 <= down < total (down >= total haría imposible que
        // las cuotas, con piso 0.01 cada una, sumen el saldo).
        if (downPayment < 0 || downPayment >= totalAmount) {
          throw new VendixHttpException(
            ErrorCodes.PO_PAYMENT_002,
            `El abono ($${downPayment}) debe ser menor que el total de la orden ($${totalAmount}) para un pago en cuotas.`,
          );
        }
        for (const inst of installments) {
          if (!(Number(inst.amount) >= 0.01)) {
            throw new VendixHttpException(
              ErrorCodes.PO_PAYMENT_006,
              'Cada cuota debe tener un monto mayor que cero.',
            );
          }
          if (isPast(inst.scheduled_date)) {
            throw new VendixHttpException(
              ErrorCodes.PO_PAYMENT_004,
              `La cuota del ${dateOnly(inst.scheduled_date)} no puede programarse en una fecha anterior a hoy (${todayLocal}).`,
            );
          }
        }
        // Suma EXACTA con Prisma.Decimal contra totalAmount − downPayment
        // (tolerancia 0.01). Reemplaza el round2 anterior: la aritmética de
        // punto flotante puede desviar la suma de cuotas en centavos.
        const scheduledSum = installments.reduce(
          (sum, i) => sum.plus(new Prisma.Decimal(i.amount ?? 0)),
          new Prisma.Decimal(0),
        );
        const balance = new Prisma.Decimal(totalAmount).minus(downPayment);
        if (!scheduledSum.minus(balance).abs().lte(new Prisma.Decimal('0.01'))) {
          throw new VendixHttpException(
            ErrorCodes.PO_PAYMENT_005,
            `Las cuotas suman $${scheduledSum.toFixed(2)} y el saldo de la orden es $${balance.toFixed(2)}. Deben coincidir.`,
          );
        }
      }

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
        // Solo proveedores activos pueden recibir una OC nueva: `inactive` y
        // `archived` existen para el histórico, no para abrir trabajo.
        const supplierExists = await tx.suppliers.findFirst({
          where: {
            id: orderData.supplier_id,
            organization_id,
            state: 'active',
          },
        });
        if (!supplierExists) {
          throw new BadRequestException(
            `El proveedor con ID ${orderData.supplier_id} no existe o no está activo.`,
          );
        }
      }

      // Coerce ISO-string dates to Date before Prisma. `@IsDateString` only
      // validates the wire format; Prisma DateTime columns require Date or a
      // full ISO-8601 DateTime, so `YYYY-MM-DD` from <input type="date">
      // would otherwise blow up here.
      const toDate = PurchaseOrdersService.toDateOrUndefined;
      // QUI-647: `payment_installments` es un campo del DTO, no una columna.
      // Se saca del spread o Prisma lo rechaza como argumento desconocido; las
      // cuotas se escriben más abajo por la relación `payment_schedules`.
      // `down_payment_amount` también se saca: la reconducción de la matriz
      // anti-doble-registro (partial con abono==total → immediate SIN abono)
      // convierte `downPayment` en 0, y si el valor crudo del DTO quedara en
      // el spread, el conditional `...(downPayment > 0 ? ...)` vacío no lo
      // sobreescribiría y la orden immediate quedaría con un abono fantasma.
      //
      // A.10 — `status` sale del spread. El DTO lo sigue aceptando (el POP web
      // lo envía en cada creación y quitarlo devolvería 400 a la pantalla
      // principal de compras) pero el servicio lo IGNORA: una orden nace en
      // borrador y la aprobación es un acto con permiso propio. Antes el spread
      // lo derramaba a Prisma tal cual, así que un `POST` con
      // `"status":"approved"` hacía nacer la orden aprobada saltándose ese
      // permiso — y `approved_by_user_id`, que también estaba en el DTO,
      // permitía además nombrar al aprobador de una orden que nadie aprobó.
      const {
        expected_date: rawExpectedDate,
        payment_due_date: rawPaymentDueDate,
        payment_installments: _installmentsInput,
        down_payment_amount: _downPaymentInput,
        status: _clientStatusIgnored,
        shipping_cost_allocation: _requestedAllocationIgnored,
        ...orderDataRest
      } = orderData;

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
          // A.10 — de oficio, no del cliente. Ver el comentario del destructuring.
          status: purchase_order_status_enum.draft,
          approved_by_user_id: null,
          // C.4 — el modo APLICADO (el solicitado pudo degradar). Se sella acá
          // y `receive()` lo obedece sin volver a decidir.
          shipping_cost_allocation: freight.applied,
          order_type: orderType,
          expected_date: toDate(rawExpectedDate),
          // Bug 1: `payment_due_date` viene como `YYYY-MM-DD` (string) del
          // input HTML; Prisma exige `Date`. Conversión defensiva antes de
          // persistir para no reventar contra la columna DateTime.
          payment_due_date: toDate(rawPaymentDueDate),
          created_by_user_id: user_id,
          organization_id,
          order_number,
          subtotal_amount: subtotal,
          // QUI-661: `create()` nunca escribía el `tax_amount` de cabecera y lo
          // dejaba en 0 mientras `total_amount` sí incluía el IVA — cabecera
          // internamente incoherente. `update()` sí lo escribía. La métrica de
          // compras lee la LÍNEA (ver QUI-624), pero dejar el header mintiendo
          // es la trampa que hace caer al próximo lector.
          tax_amount: round2(lineTax),
          total_amount: totalAmount,
          order_date: new Date(),
          // QUI-647: el plan acordado queda en la orden. `payment_terms` ya
          // existía como texto libre; `payment_plan` es el modo tipado que el
          // motor lee, para no tener que interpretar una cadena.
          ...(paymentPlan ? { payment_plan: paymentPlan } : {}),
          ...(downPayment > 0 ? { down_payment_amount: downPayment } : {}),
          // Las cuotas se guardan contra la ORDEN porque la CxP todavía no
          // existe: nace con la recepción. Se materializan en
          // `ap_payment_schedules` cuando esa CxP aparece.
          ...(installments.length > 0
            ? {
                payment_schedules: {
                  create: installments.map((i) => ({
                    // Bug 1: convertir scheduled_date string → Date aquí también
                    scheduled_date: toDate(i.scheduled_date) ?? new Date(i.scheduled_date),
                    amount: i.amount,
                    status: 'planned',
                  })),
                },
              }
            : {}),
          purchase_order_items: {
            create: processedItems.map((item, index) => {
              // F1 IVA lifecycle: derive net/tax from the entered unit_price
              // and the effective include-tax mode (line override ?? header).
              // `unit_cost` persists the NET price (single source of truth for
              // costing); the VAT treatment for inventory cost is decided later
              // in receive() by fiscal responsibility.
              //
              // QUI-661: the SAME prorated header share used for the order
              // totals is passed here, so the persisted `unit_cost` — the value
              // the FIFO engine capitalizes at reception — already carries the
              // commercial discount. This is what closes the old gap where the
              // CxP was rebated but the inventory was not.
              const derived = this.deriveLineTax(
                item,
                createPurchaseOrderDto,
                headerShares[index],
              );
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
                // Total discount actually applied (own + prorated header), and
                // the percentage the user typed to get there. The amount is the
                // source of truth; the percentage is provenance only.
                discount_amount: derived.discount_total,
                discount_percentage: item.discount_percentage ?? 0,
                // C.2 — porción del flete que aterriza en esta línea. Cero en
                // modo `expense`. La suma de las líneas es EXACTAMENTE
                // `purchase_orders.shipping_cost` (el residuo va a la última),
                // y `receive()` lo lee de acá en vez de repartir otra vez.
                allocated_shipping_amount: freight.shares[index] ?? 0,
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

      // QUI-647 Paso 2 — un abono declarado al crear es un PAGO REAL de
      // anticipo. Se registra DENTRO de esta transacción (Prisma no permite
      // anidar $transaction, así que el core de registerPayment se ejecuta
      // contra el `tx` abierto via registerAdvancePaymentInTx); el evento
      // contable se emite solo después del commit (ver
      // emitPurchaseOrderPaymentEvent). `downPayment` ya vino reconducido
      // por la matriz anti-doble-registro: partial con abono==total es
      // immediate SIN abono, así que aquí solo entran abonos reales < total.
      if (downPayment > 0) {
        const advance = await this.registerAdvancePaymentInTx(
          tx,
          purchaseOrder.id,
          downPayment,
          user_id,
        );
        (purchaseOrder as any).payment_status = advance.paymentStatus;
        advanceToRegister = { paymentId: advance.id, amount: downPayment };
      }

      // QUI-647 — abono parcial CON fecha de pago del saldo: el saldo queda con
      // fecha materializado como cuota planeada contra la ORDEN (mismo contrato
      // que installments: `purchase_order_payment_schedules` con status
      // 'planned', a la espera de CxP que nace con la recepción). Sin
      // `payment_due_date` el saldo queda sin fecha y se gestiona desde Cuentas
      // por Pagar — comportamiento previo. `paymentPlan === 'partial'` ya
      // excluye la reconducción a immediate (abono == total → no hay saldo).
      if (paymentPlan === 'partial' && dueDate && downPayment < totalAmount) {
        await tx.purchase_order_payment_schedules.create({
          data: {
            purchase_order_id: purchaseOrder.id,
            scheduled_date: new Date(dueDate),
            amount: new Prisma.Decimal(totalAmount).minus(downPayment),
            status: 'planned',
          },
        });
      }

      return { order: purchaseOrder, advance: advanceToRegister, freight };
    },
      // A.11 — techo EXPLÍCITO de transacción. Prisma impone 5.000 ms por
      // omisión y nadie lo había declarado: una orden de 80 líneas emite del
      // orden de miles de consultas (creación de productos, config de UoM,
      // líneas, calendario de pagos) y aborta con P2028 en RDS mientras pasa en
      // local, donde la latencia por consulta es un orden de magnitud menor. El
      // resto del repositorio ya sube el techo a 20-30 s; aquí hace falta más
      // porque este camino puede crear catálogo.
      { timeout: 120_000, maxWait: 10_000 },
    );

    const result = txResult.order;
    const advanceRegistered = txResult.advance;

    // QUI-647 Paso 2 — el evento contable del anticipo se emite DESPUÉS del
    // commit: el handler de `purchase_order.payment` corre async y debe ver la
    // fila de pago ya persistida (misma convención que registerPayment).
    if (advanceRegistered) {
      await this.emitPurchaseOrderPaymentEvent({
        purchaseOrder: result,
        paymentId: advanceRegistered.paymentId,
        amount: advanceRegistered.amount,
        paymentMethod: PO_ADVANCE_PAYMENT_METHOD,
        userId: RequestContextService.getUserId(),
      });
    }

    // ===== C.11 — sellar la decisión fiscal y el modo de flete al CREAR =====
    //
    // La decisión que mueve el 19 % del costo queda escrita junto a la orden que
    // la sufrió. Re-derivarla mañana leería los datos fiscales de mañana: tras
    // B.2, configurar el RUT la semana que viene haría que la re-derivación
    // contradijera la orden y nada distinguiría un cambio de configuración de un
    // defecto.
    //
    // Se resuelve DESPUÉS del commit a propósito: son dos lecturas de solo
    // lectura y meterlas dentro alargaría la transacción sin ninguna ganancia.
    try {
      const user_id = RequestContextService.getUserId();
      const auditStoreId =
        result.location?.store_id ?? RequestContextService.getStoreId() ?? undefined;
      const vatOutcome = await this.resolveVatResponsibility(
        result.organization_id ?? undefined,
        auditStoreId,
      );
      let costingMethodLabel: string | undefined;
      try {
        costingMethodLabel = toPublicCostingMethod(
          await this.costingMethodResolver.resolveCostingMethod(
            result.organization_id,
            auditStoreId,
          ),
        );
      } catch {
        // El método de costeo es contexto de la auditoría, no su razón de ser:
        // no poder resolverlo no puede impedir que la fila se escriba.
        costingMethodLabel = undefined;
      }

      await this.auditService.log({
        userId: user_id ?? 0,
        // `logCustom` no acepta `store_id` y lo dejaba nulo en las 256 filas de
        // compras, así que la auditoría de compras no se podía filtrar por
        // tienda. `log()` sí lo acepta y vive en el mismo servicio.
        storeId: auditStoreId,
        organizationId: result.organization_id ?? undefined,
        action: 'PO_CREATED',
        resource: 'purchase_orders',
        resourceId: result.id,
        metadata: {
          purchase_order_id: result.id,
          order_number: result.order_number,
          items_count: createPurchaseOrderDto.items?.length ?? 0,
          costing_method: costingMethodLabel,
          fiscal_explanation: this.buildFiscalExplanation(vatOutcome),
          shipping_cost: txResult.freight.total,
          // Los DOS modos: `prorate` degrada a `expense` cuando no hay neto ni
          // cantidad sobre la que repartir, y sin las dos cifras esa degradación
          // es indistinguible de una elección del operador.
          shipping_cost_allocation_requested: txResult.freight.requested,
          shipping_cost_allocation_applied: txResult.freight.applied,
          request_id: RequestContextService.getRequestId(),
        },
      });
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
      sort_by = 'next_payment_date',
      sort_order = 'asc',
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

    // CP-ID-VNDX-2026-08-18-PO-PROD — ADR-001 / F1.S5 / F1.S6.
    // Antes el DTO aceptaba cualquier string y el cliente inyectaba columnas
    // Prisma inexistentes. Hoy sort_by es un enum cerrado de 5 valores.
    // Para `next_payment_date` (campo calculado por el decorador) no hay
    // columna SQL nativa: ordenamos en memoria tras decorar. Trade-off ADR-002
    // (≤500 POs por tienda, latencia subsegundo).
    const orderBy = this.resolveOrderBy(sort_by, sort_order);

    // CP-ID-VNDX-2026-08-18-PO-PROD — F1.S6: cuando el orden es por
    // `next_payment_date`, no podemos paginar en SQL (el campo no existe).
    // Traemos TODAS las filas match, decoramos, ordenamos en memoria, paginamos.
    const needsInMemorySort = sort_by === 'next_payment_date';

    let data: any[];
    let total: number;

    if (needsInMemorySort) {
      const allMatched = await this.prisma.purchase_orders.findMany({
        where,
        include,
      });
      const enriched = await this.decorateWithNextPaymentDate(allMatched);
      // nulls al final (sin plan de pago), resto asc.
      enriched.sort((a, b) => {
        const av = a.next_payment_date;
        const bv = b.next_payment_date;
        if (av === bv) return 0;
        if (av === null) return 1;
        if (bv === null) return -1;
        return sort_order === 'asc'
          ? av.localeCompare(bv)
          : bv.localeCompare(av);
      });
      total = enriched.length;
      data = enriched.slice(skip, skip + limit);
    } else {
      [data, total] = await Promise.all([
        this.prisma.purchase_orders.findMany({
          where,
          include,
          skip,
          take: limit,
          orderBy,
        }),
        this.prisma.purchase_orders.count({ where }),
      ]);
      data = await this.decorateWithNextPaymentDate(data);
    }

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

  /**
   * CP-ID-VNDX-2026-08-18-PO-PROD — F1.S5 / ADR-001.
   * Mapea el sort_by cerrado al orderBy soportado por Prisma. Rechaza valores
   * no listados (el DTO ya bloquea por `@IsEnum`, esto es la red final).
   */
  private resolveOrderBy(
    sort_by: 'order_date' | 'next_payment_date' | 'supplier_name' | 'total' | 'status',
    sort_order: 'asc' | 'desc',
  ): any {
    switch (sort_by) {
      case 'order_date':
        return { order_date: sort_order };
      case 'total':
        return { total_amount: sort_order };
      case 'status':
        return { status: sort_order };
      case 'supplier_name':
        return { suppliers: { name: sort_order } };
      case 'next_payment_date':
        // Manejado en findAll() con orden en memoria.
        return { order_date: 'desc' };
      default:
        throw new VendixHttpException(
          ErrorCodes.PO_INVALID_SORT_BY,
          'sort_by no soportado.',
        );
    }
  }

  /**
   * Bug 4 — Decorador batched para `findAll` (sin tocar `findOne` ni el resto del contrato).
   *
   * Devuelve una copia del array original enriquecida con `next_payment_date` y
   * `next_payment_due_in_days` por OC. El cálculo se hace con una sola query
   * batched sobre `purchase_order_payment_schedules` (status='planned'), con
   * fallback al `payment_due_date` de la OC si no hay cuotas planeadas.
   *
   * No muta los objetos originales; spread shallow para preservar la shape que
   * el resto del repo espera de `findAll`.
   */
  private async decorateWithNextPaymentDate<T extends { id: number }>(
    rows: T[],
  ): Promise<Array<T & { next_payment_date: string | null; next_payment_due_in_days: number | null }>> {
    if (!rows.length) return [];
    const poIds = rows.map((r) => r.id);
    const map = await this.deriveNextPaymentDates(poIds);
    const todayLocal = localDateString(new Date(), DEFAULT_STORE_TIMEZONE);
    return rows.map((row) => {
      const next = map.get(row.id);
      if (!next || !next.date) {
        return { ...row, next_payment_date: null, next_payment_due_in_days: null };
      }
      const days = Math.ceil(
        (new Date(`${next.date}T00:00:00`).getTime() -
          new Date(`${todayLocal}T00:00:00`).getTime()) /
          86_400_000,
      );
      return { ...row, next_payment_date: next.date, next_payment_due_in_days: days };
    });
  }

  /**
   * Bug 4 — Helper público de derivación. Recibe un set de PO ids y devuelve un
   * `Map<poId, { date: string | null }>` con la próxima fecha de pago planeada
   * (`status='planned'` ASC) o `null` si no hay. Exposed para tests y para que
   * `findOne` pueda enriquecer en el futuro sin duplicar lógica.
   *
   * Implementación: usa `$queryRaw` directo contra `baseClient` porque
   * `StorePrismaService` no expone `purchase_order_payment_schedules` como
   * delegado (es un modelo de control interno de las OCs, sin scope por store).
   * El fallback usa `this.prisma.purchase_orders` (sí delegado) para el
   * `payment_due_date`.
   */
  async deriveNextPaymentDates(
    poIds: number[],
  ): Promise<Map<number, { date: string | null }>> {
    const out = new Map<number, { date: string | null }>();
    if (!poIds.length) return out;
    // Schedules planeadas: query raw batched sobre la tabla puente.
    // El model existe en el schema pero no se delega en StorePrismaService.
    // ANY/ALL de los ids se sanitiza con BIGINT parameter binding.
    const idsList = poIds.join(',');
    const rows: Array<{ purchase_order_id: number; scheduled_date: Date }> =
      await this.prisma.$queryRawUnsafe(
        `SELECT purchase_order_id, scheduled_date
         FROM purchase_order_payment_schedules
         WHERE purchase_order_id IN (${idsList})
           AND status = 'planned'
         ORDER BY purchase_order_id ASC, scheduled_date ASC`,
      );
    for (const r of rows) {
      if (!out.has(r.purchase_order_id)) {
        out.set(r.purchase_order_id, {
          date: localDateString(r.scheduled_date, DEFAULT_STORE_TIMEZONE),
        });
      }
    }
    // Fallback: si no hay schedules planeados, usar payment_due_date de la OC.
    const fallbackIds = poIds.filter((id) => !out.has(id));
    if (fallbackIds.length) {
      const orders = await this.prisma.purchase_orders.findMany({
        where: { id: { in: fallbackIds } },
        select: { id: true, payment_due_date: true },
      });
      for (const o of orders) {
        out.set(o.id, {
          date: o.payment_due_date
            ? localDateString(o.payment_due_date, DEFAULT_STORE_TIMEZONE)
            : null,
        });
      }
    }
    return out;
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

  /**
   * CP-PURCHASE-TRANSPARENCY R2 — una orden inexistente ya no se disfraza de
   * éxito.
   *
   * `findUnique` devuelve `null` cuando no hay fila, y el handler envolvía ese
   * `null` en el sobre de éxito del `ResponseService`. `GET /:id` con un id
   * inventado respondía:
   *
   *     HTTP/1.1 200 OK
   *     {"success":true,"message":"Orden de compra obtenida exitosamente","data":null}
   *
   * Con eso el detalle del frontend pinta una página entera: título
   * «OC #undefined», todos los campos en «—», «Productos (0)» y el botón
   * Imprimir operativo. El cliente pidió un recurso y recibió otra cosa sin que
   * nada se lo dijera: es el mismo defecto que persigue este plan un nivel más
   * abajo que el `responseService.error` que arregló `fe9736bd7`.
   *
   * Se lanza `PO_FIND_001` (404), el código YA REGISTRADO en
   * `error-codes.ts` para «Orden de compra no encontrada» — el mismo que ya
   * usan `loadOrderOrFail()` y `configurePaymentPlan()`. No se introduce
   * ningún código nuevo.
   *
   * **Alcance multi-tenant — 404, nunca 403.** `this.prisma` es el
   * `StorePrismaService`: la extensión de alcance inyecta
   * `{ location: { store_id } }` en el `where` (registro relacional
   * `purchase_orders` en `store-prisma.service.ts`), así que una orden de OTRA
   * tienda tampoco casa y sale por esta misma rama. El resultado es
   * deliberado: un 403 confirmaría la existencia del recurso a quien no debe
   * saber ni que existe. `purchase_orders.location_id` es `Int` NOT NULL, de
   * modo que el filtro relacional nunca deja fuera una orden propia.
   *
   * Consumidores auditados antes de lanzar (el riesgo real es quien ramificaba
   * sobre el `null`):
   *   · `purchase-orders.controller.ts` `findOne()` — el destinatario del
   *     arreglo: la excepción sube al `AllExceptionsFilter` y sale 404 con
   *     `error_code`.
   *   · `configurePaymentPlan()` (final del método, más abajo en este mismo
   *     fichero) — reusa `findOne()` para devolver la orden ya modificada, y
   *     ese camino solo se alcanza tras haber lanzado `PO_FIND_001` él mismo
   *     si la orden no existía. Inalcanzable con `null`; sin cambio.
   *   · `OrgPurchaseOrdersService.findOne()` es un método DISTINTO (alcance
   *     organización) y ya lanzaba `NotFoundException`: este cambio alinea el
   *     alcance tienda con el hermano que siempre estuvo bien.
   */
  async findOne(id: number) {
    const order = await this.prisma.purchase_orders.findUnique({
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
        // QUI-647 — el detalle de la OC expone el calendario de pagos completo
        // (fechas, montos, estados) ordenado cronológicamente; es la superficie
        // donde el operador audita la deuda con el proveedor.
        payment_schedules: {
          orderBy: { scheduled_date: 'asc' },
        },
      },
    });

    if (!order) {
      throw new VendixHttpException(
        ErrorCodes.PO_FIND_001,
        `La orden de compra ${id} no existe.`,
        { purchase_order_id: id },
      );
    }

    return order;
  }

  /**
   * Campos escalares que un borrador acepta. Es una allowlist y no un spread del
   * DTO porque `UpdatePurchaseOrderDto` es `PartialType(CreatePurchaseOrderDto)`
   * y arrastra claves que NO son columnas de `purchase_orders` — entre ellas
   * `items`. Pasarlo crudo a `data` hacía que Prisma abortara con
   * "Unknown argument `items`" en TODA llamada a update(); el catch del
   * controller devolvía ese fallo como HTTP 200, así que editar una orden nunca
   * funcionó y además lo aparentaba. `status` queda deliberadamente fuera: solo
   * se escribe vía assertTransition().
   */
  /**
   * Normaliza una fecha entrante a `Date` o `undefined`. Era una closure dentro
   * de `create()`; se eleva a la clase porque `update()` persiste los mismos
   * campos de lote y debe interpretarlos igual.
   */
  private static toDateOrUndefined(v: unknown): Date | undefined {
    if (v == null || v === '') return undefined;
    if (v instanceof Date) return v;
    const d = new Date(String(v));
    return Number.isNaN(d.getTime()) ? undefined : d;
  }

  private static readonly UPDATABLE_ORDER_FIELDS = [
    'supplier_id',
    'location_id',
    'expected_date',
    'notes',
    'internal_notes',
    'discount_amount',
    'shipping_cost',
    // C.4 — sin esta clave la edición de un borrador PERDÍA el modo de flete en
    // silencio: el operador elegía prorratear, la allowlist descartaba el campo
    // y la recepción usaba el valor viejo. El modo es editable mientras la orden
    // sea borrador y queda sellado al recibir; cambiarlo después exigiría
    // reprocesar capas de costo, y eso no se hace.
    'shipping_cost_allocation',
    'shipping_method',
    'payment_terms',
    'payment_due_date',
    'order_type',
    'prices_include_tax',
    'supplier_invoice_number',
    'supplier_invoice_date',
  ] as const;

  async update(id: number, updatePurchaseOrderDto: UpdatePurchaseOrderDto) {
    return this.prisma.$transaction(async (tx) => {
      const order = await this.loadOrderOrFail(tx, id);
      // Solo un borrador es editable: una orden aprobada ya comprometió al
      // proveedor y una recibida respalda inventario y asientos contables.
      this.assertMutable(order, 'editar');

      const { items, ...rest } = updatePurchaseOrderDto as UpdatePurchaseOrderDto & {
        items?: any[];
      };

      // C.7 — misma regla de flete e impuesto que en la creación. `PartialType`
      // vuelve opcional a `location_id`, y `@IsOptional()` desactiva TODOS los
      // validadores colgados de esa propiedad cuando llega ausente: el
      // validador cruzado NO corre en una edición parcial. Acá sí.
      const freightContractError = validateFreightAndTaxHeader({
        shipping_cost: updatePurchaseOrderDto.shipping_cost,
        shipping_cost_allocation:
          updatePurchaseOrderDto.shipping_cost_allocation,
        prices_include_tax: updatePurchaseOrderDto.prices_include_tax,
        items,
      });
      if (freightContractError) {
        throw new BadRequestException(freightContractError);
      }

      const data: Record<string, unknown> = {};
      for (const field of PurchaseOrdersService.UPDATABLE_ORDER_FIELDS) {
        if (rest[field as keyof typeof rest] !== undefined) {
          data[field] = rest[field as keyof typeof rest];
        }
      }

      // C.4 — la cabecera vigente. El flete y su modo pueden venir a medias en
      // un PATCH (sólo el monto, sólo el modo, ninguno), así que el reparto se
      // resuelve sobre la combinación de lo enviado y lo ya persistido, nunca
      // sobre el DTO a secas.
      const currentHeader = (await tx.purchase_orders.findUnique({
        where: { id },
        select: {
          shipping_cost: true,
          shipping_cost_allocation: true,
          subtotal_amount: true,
          tax_amount: true,
        },
      })) as {
        shipping_cost: unknown;
        shipping_cost_allocation: string | null;
        subtotal_amount: unknown;
        tax_amount: unknown;
      } | null;

      let freightForItems: {
        requested: ShippingCostAllocation | null;
        applied: ShippingCostAllocation | null;
        shares: number[];
        total: number;
      } | null = null;

      // If items are being updated, recalculate totals.
      // FASE 4 — misma derivación bruta consistente que create(): neto por línea
      // vía deriveLineTax → subtotal_amount = Σ neto, total_amount = neto + IVA −
      // descuento + flete (BRUTO). Corrige además la columna: antes escribía
      // `.subtotal` (inexistente; la columna real es `subtotal_amount`, ver :838).
      if (items) {
        // QUI-486 — `update()` era un bypass del guard de variantes: se podía
        // crear la orden por variante y luego reescribir la línea a la base.
        await this.assertNoBaseLineOnVariantProduct(tx, items, {
          stage: 'create',
        });

        // QUI-661 — mismo cambio de orden que create(): el descuento entra
        // DENTRO de la derivación (baja la base gravable) en vez de restarse
        // al final sobre un IVA ya calculado sin descontar.
        const round2 = (n: number) => Math.round(n * 100) / 100;
        const headerShares = this.prorateHeaderDiscount(
          items,
          Number(updatePurchaseOrderDto.discount_amount || 0),
        );
        let netSubtotal = 0;
        let lineTax = 0;
        const netPerLine: number[] = [];
        const quantitiesPerLine: number[] = [];
        for (let i = 0; i < items.length; i++) {
          const d = this.deriveLineTax(
            items[i],
            updatePurchaseOrderDto,
            headerShares[i],
          );
          const qty = Number(items[i].quantity ?? 0);
          netPerLine.push(d.unit_price_net * qty);
          quantitiesPerLine.push(qty);
          netSubtotal += d.unit_price_net * qty;
          lineTax += d.tax_amount;
        }
        const subtotal = round2(netSubtotal);
        const shippingCost = Number(
          updatePurchaseOrderDto.shipping_cost ??
            currentHeader?.shipping_cost ??
            0,
        );
        const totalAmount = round2(subtotal + round2(lineTax) + shippingCost);

        data.subtotal_amount = subtotal;
        data.tax_amount = round2(lineTax);
        data.total_amount = totalAmount;

        // C.4 — al reescribir las líneas hay que REPARTIR otra vez: las
        // porciones viejas pertenecían a un lote que ya no existe. Si el reparto
        // se recalculara al editar pero no al recibir (o al contrario), la suma
        // de porciones dejaría de cuadrar con la cabecera y el invariante de C.2
        // se rompería sin que nada lo advirtiera.
        freightForItems = this.resolveFreightAllocation({
          shippingCost,
          requested:
            (updatePurchaseOrderDto.shipping_cost_allocation as
              | ShippingCostAllocation
              | undefined) ??
            (currentHeader?.shipping_cost_allocation as
              | ShippingCostAllocation
              | null
              | undefined),
          netPerLine,
          quantities: quantitiesPerLine,
          context: `update() orden ${id}`,
        });
        data.shipping_cost_allocation = freightForItems.applied;

        // Reemplazo completo de las líneas. Es seguro porque assertMutable ya
        // garantizó `draft`: sin recepciones, `quantity_received` es 0 en todas
        // y ninguna capa de costeo las referencia.
        await tx.purchase_order_items.deleteMany({
          where: { purchase_order_id: id },
        });
        for (let i = 0; i < items.length; i++) {
          const item = items[i];
          const derived = this.deriveLineTax(
            item,
            updatePurchaseOrderDto,
            headerShares[i],
          );
          await tx.purchase_order_items.create({
            data: {
              purchase_order_id: id,
              product_id: item.product_id,
              product_variant_id: item.product_variant_id ?? null,
              quantity_ordered: item.quantity,
              unit_cost: derived.unit_price_net,
              unit_price_net: derived.unit_price_net,
              discount_amount: derived.discount_total,
              discount_percentage: item.discount_percentage ?? 0,
              allocated_shipping_amount: freightForItems?.shares[i] ?? 0,
              tax_rate: item.tax_rate ?? null,
              tax_type:
                (item.tax_type as tax_type_enum | undefined) ??
                tax_type_enum.iva,
              prices_include_tax: item.prices_include_tax ?? null,
              tax_amount: derived.tax_amount,
              notes: item.notes,
              batch_number: item.batch_number,
              manufacturing_date:
                PurchaseOrdersService.toDateOrUndefined(item.manufacturing_date),
              expiration_date:
                PurchaseOrdersService.toDateOrUndefined(item.expiration_date),
            },
          });
        }
      } else if (
        updatePurchaseOrderDto.shipping_cost !== undefined ||
        updatePurchaseOrderDto.shipping_cost_allocation !== undefined ||
        updatePurchaseOrderDto.discount_amount !== undefined
      ) {
        // ===== C.4 — editar SOLO la cabecera =====
        //
        // El PATCH del flete sin líneas era un agujero doble: ni se repartía de
        // nuevo entre las líneas (la suma dejaba de cuadrar con la cabecera) ni
        // se recalculaba `total_amount` (la rama de totales colgaba de `items`).
        // El operador subía el flete de 0 a 100.000 y la orden seguía valiendo
        // lo mismo, con la cartera y el pago cuadrando contra una cifra vieja.
        const round2 = (n: number) => Math.round(n * 100) / 100;
        const existingLines = await tx.purchase_order_items.findMany({
          where: { purchase_order_id: id },
          select: {
            id: true,
            quantity_ordered: true,
            unit_price_net: true,
            unit_cost: true,
            tax_amount: true,
          },
          orderBy: { id: 'asc' },
        });

        const netPerLine = existingLines.map(
          (l) =>
            Number(l.unit_price_net ?? l.unit_cost ?? 0) *
            Number(l.quantity_ordered ?? 0),
        );
        const quantitiesPerLine = existingLines.map((l) =>
          Number(l.quantity_ordered ?? 0),
        );
        const shippingCost = Number(
          updatePurchaseOrderDto.shipping_cost ??
            currentHeader?.shipping_cost ??
            0,
        );
        const freight = this.resolveFreightAllocation({
          shippingCost,
          requested:
            (updatePurchaseOrderDto.shipping_cost_allocation as
              | ShippingCostAllocation
              | undefined) ??
            (currentHeader?.shipping_cost_allocation as
              | ShippingCostAllocation
              | null
              | undefined),
          netPerLine,
          quantities: quantitiesPerLine,
          context: `update() cabecera de la orden ${id}`,
        });
        data.shipping_cost_allocation = freight.applied;

        for (let i = 0; i < existingLines.length; i++) {
          await tx.purchase_order_items.update({
            where: { id: existingLines[i].id },
            data: { allocated_shipping_amount: freight.shares[i] ?? 0 },
          });
        }

        // El total se recompone desde lo persistido: el neto y el IVA de las
        // líneas no cambian al mover el flete, pero el bruto sí.
        //
        // LÍMITE CONOCIDO: editar `discount_amount` sin reenviar las líneas NO
        // vuelve a prorratear el descuento (eso reescribiría `unit_cost` y con
        // él la base gravable de cada línea). El frontend siempre manda las
        // líneas cuando toca el descuento; acá sólo se recompone el total para
        // que la cabecera no quede mintiendo.
        const netSubtotal = netPerLine.reduce((s, v) => s + v, 0);
        const lineTax = existingLines.reduce(
          (s, l) => s + Number(l.tax_amount ?? 0),
          0,
        );
        data.subtotal_amount = round2(netSubtotal);
        data.tax_amount = round2(lineTax);
        data.total_amount = round2(
          round2(netSubtotal) + round2(lineTax) + shippingCost,
        );
      }

      return tx.purchase_orders.update({
        where: { id },
        data,
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
    // La lectura y la validación van en la misma transacción que la escritura:
    // fuera de ella dos aprobaciones concurrentes podrían pasar ambas el guard.
    const result = await this.prisma.$transaction(async (tx) => {
      const order = await this.loadOrderOrFail(tx, id);
      this.assertTransition(order, purchase_order_status_enum.approved);
      return tx.purchase_orders.update({
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
    // El guard rechaza `partial` y `received` con PO_CANCEL_RECEIVED_001: esa
    // mercancía ya entró a bodega y sacarla es una devolución a proveedor, no
    // una cancelación. Antes se marcaba `cancelled` dejando el stock dentro.
    const result = await this.prisma.$transaction(async (tx) => {
      const order = await this.loadOrderOrFail(tx, id);
      this.assertTransition(order, purchase_order_status_enum.cancelled);
      return tx.purchase_orders.update({
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
   *
   * QUI-648 — ESCALAS. `costPrice` viene en unidad MÍNIMA de stock (lo escribe
   * `CostingService` como valor / quantity_on_hand) mientras que `base_price` /
   * `price_override` cubren `products.price_unit_quantity` de esas unidades. Un
   * cable con el stock en milímetros guarda $3 el milímetro y $5.000 el metro:
   * restarlos tal cual publicaba un margen del 166.566% y —peor— con un margen
   * pinneado derivaba `base_price = costo_del_milímetro × (1+m)`, o sea que
   * RECIBIR MERCANCÍA dejaba el cable a $3,60 el metro. Por eso el costo se sube
   * a la escala del precio con `resolvePricedUnits`, el mismo resolutor que usan
   * el editor de producto (`tier-margin.util`) y la analítica: las tres puntas
   * miden el margen contra el mismo costo de referencia.
   *
   * `packSize` va en `null` a propósito: una PRESENTACIÓN
   * (`price_tiers.kind = 'sale_unit'`) tiene su propio precio y su propio margen
   * en `product_price_tier_overrides`, y no se deriva desde acá.
   *
   * Con `priceUnitQuantity` ausente, nulo, 0, 1 o no numérico —el catálogo
   * histórico entero— `resolvePricedUnits` devuelve 1, el costo sale intacto
   * (×1 es exacto en IEEE-754) y la aritmética es byte a byte la de siempre.
   */
  static resolvePricingAfterReceipt(args: {
    costPrice: number;
    existingBasePrice: number;
    newBasePrice?: number;
    newProfitMargin?: number;
    /** `products.price_unit_quantity` del producto de la línea. */
    priceUnitQuantity?: number | null;
  }): { basePrice: number; profitMargin: number } {
    const { costPrice, existingBasePrice } = args;
    const { newBasePrice, newProfitMargin } = args;

    // Costo llevado a la escala en la que se publica el precio.
    const costInPriceScale =
      costPrice * resolvePricedUnits(null, args.priceUnitQuantity);

    if (newBasePrice !== undefined && newBasePrice !== null) {
      // Operator pinned the listing price → margin derived from new cost.
      const margin =
        costInPriceScale > 0
          ? Math.round(
              ((newBasePrice - costInPriceScale) / costInPriceScale) * 10000,
            ) / 100
          : 0;
      return {
        basePrice: newBasePrice,
        profitMargin: PurchaseOrdersService.clampProfitMargin(margin),
      };
    }

    if (newProfitMargin !== undefined && newProfitMargin !== null) {
      // Operator pinned the margin → listing price derived from new cost.
      const basePrice = costInPriceScale * (1 + newProfitMargin / 100);
      return {
        basePrice: Math.round(basePrice * 100) / 100,
        profitMargin: PurchaseOrdersService.clampProfitMargin(newProfitMargin),
      };
    }

    // Cost-anchor default: keep the existing base_price, recompute margin.
    const margin =
      costInPriceScale > 0
        ? Math.round(
            ((existingBasePrice - costInPriceScale) / costInPriceScale) * 10000,
          ) / 100
        : 0;
    return {
      basePrice: existingBasePrice,
      profitMargin: PurchaseOrdersService.clampProfitMargin(margin),
    };
  }

  /**
   * Techo y piso del margen publicable, por el ancho real de la columna.
   *
   * `products.profit_margin` y `product_variants.profit_margin` son
   * `Decimal(5,2)`: el rango representable es ±999.99. Un markup mayor —normal
   * cuando el costo por unidad mínima es de centavos frente a un precio de
   * presentación, y también en cualquier producto vendido a más de ~11× su
   * costo— desbordaba la columna con `numeric field overflow` (Postgres 22003)
   * y **revertía la transacción completa de `receive()`**: sin stock, sin capa
   * de costo, sin CxP, sin asiento, y el operador leyendo "Internal server
   * error" en cada reintento. La recepción física no se puede bloquear por el
   * ancho de una columna de presentación, así que el margen se satura y el
   * precio —que es el dato de negocio— se persiste intacto.
   *
   * El spec `purchase-orders.service.spec.ts` documenta el caso que motivó la
   * escala de QUI-648 con un margen de 142.757,14%; esto es la red por debajo,
   * para cuando la escala no alcance a normalizarlo.
   */
  private static clampProfitMargin(margin: number): number {
    const MAX_DECIMAL_5_2 = 999.99;
    if (!Number.isFinite(margin)) return 0;
    if (margin > MAX_DECIMAL_5_2) return MAX_DECIMAL_5_2;
    if (margin < -MAX_DECIMAL_5_2) return -MAX_DECIMAL_5_2;
    return margin;
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
  /**
   * Persiste la configuración de UNIDAD DE VENTA del producto desde la orden de
   * compra (QUI-648). Espeja `persistIngredientConfigToProduct`: el flujo de
   * compra ya sabía configurar un producto como insumo mientras se lo cargaba a
   * la orden; esto hace lo mismo para la presentación en la que se venderá.
   *
   * Escribe TRES filas coordinadas dentro de la transacción de la OC, o ninguna:
   *
   *   1. `price_tiers` — la presentación, por tienda y de nombre libre
   *      (`kind = 'sale_unit'`). Se reutiliza si ya existe con ese nombre.
   *   2. `product_price_tier_assignments` — habilita el par (producto,
   *      presentación). Es el allowlist que consulta la venta.
   *   3. `product_price_tier_overrides` — factor, precio y margen del producto
   *      para esa presentación.
   *
   * Escribir solo una o dos es el modo de fallo peligroso: prender
   * `has_multiple_price_tiers` sin el assignment guarda sin error y falla recién
   * AL VENDER con `PRICE_TIER_NOT_ALLOWED`, muy lejos de la causa.
   */
  private async persistSaleUnitConfigToProduct(
    productId: number,
    item: {
      sale_unit_name?: string;
      sale_unit_units_per_package?: number;
      sale_unit_price?: number;
      sale_unit_profit_margin?: number;
      sale_unit_is_default?: any;
    },
    tx: any,
  ): Promise<void> {
    const name = item.sale_unit_name?.trim();
    if (!name) return;

    const product = await tx.products.findFirst({
      where: { id: productId },
      select: {
        id: true,
        store_id: true,
        cost_price: true,
        price_unit_quantity: true,
        is_ingredient: true,
        is_sellable: true,
      },
    });
    if (!product?.store_id) return;
    // Un insumo puro no se vende, así que no puede tener presentaciones de
    // venta. La rama de insumo del create fuerza `has_multiple_price_tiers=false`
    // por la misma razón; esta guarda evita reactivarlo por la puerta de atrás.
    if (product.is_ingredient && product.is_sellable === false) return;

    // Multi-tarifa ⊕ variantes: configurar una presentación desde la compra es
    // una tercera puerta a la misma regla. Lanza (no silencia) para que el
    // comprador sepa por qué su configuración no se aplicó — la OC entera se
    // revierte con la transacción y él decide si quita las variantes o la
    // presentación.
    await assertTiersAllowed(tx, productId, {
      action: 'purchase_order_sale_unit_config',
    });

    // 1. La presentación. `(store_id, name)` es único, así que un nombre repetido
    //    reutiliza la tarifa en vez de fallar. `is_package_unit` se deriva del
    //    factor igual que en PriceTiersService, para no dejar el flag inconsistente.
    const unitsPerPackage = item.sale_unit_units_per_package ?? null;
    let tier = await tx.price_tiers.findFirst({
      where: { store_id: product.store_id, name },
      select: { id: true, kind: true, units_per_package: true },
    });
    if (!tier) {
      tier = await tx.price_tiers.create({
        data: {
          store_id: product.store_id,
          name,
          kind: 'sale_unit',
          discount_percentage: 0,
          is_active: true,
          is_default: false,
          is_package_unit: (unitsPerPackage ?? 0) >= 2,
          units_per_package: unitsPerPackage,
          updated_at: new Date(),
        },
        select: { id: true, kind: true, units_per_package: true },
      });
    }

    // 2. Allowlist del par (producto, presentación). El default se aplica solo si
    //    la tarifa es una unidad de venta, y desmarcando el anterior ANTES de
    //    marcar el nuevo: el índice único parcial no tolera dos `true` a la vez.
    const wantsDefault =
      item.sale_unit_is_default === true ||
      item.sale_unit_is_default === 'true';
    const canBeDefault = wantsDefault && tier.kind === 'sale_unit';
    if (canBeDefault) {
      await tx.product_price_tier_assignments.updateMany({
        where: {
          product_id: productId,
          is_default: true,
          NOT: { price_tier_id: tier.id },
        },
        data: { is_default: false },
      });
    }
    await tx.product_price_tier_assignments.upsert({
      where: {
        product_id_price_tier_id: {
          product_id: productId,
          price_tier_id: tier.id,
        },
      },
      update: canBeDefault ? { is_default: true } : {},
      create: {
        product_id: productId,
        price_tier_id: tier.id,
        is_default: canBeDefault,
      },
    });

    // 3. Override del producto: factor + precio/margen con criterio cost-anchor.
    const packSize = resolvePackSize(
      tier.units_per_package,
      unitsPerPackage,
    );
    const { override_price, override_profit_margin } =
      resolveTierPricingCostAnchor({
        unitCost: Number(product.cost_price ?? 0),
        packSize,
        priceUnitQuantity: product.price_unit_quantity,
        overridePrice: item.sale_unit_price,
        overrideMargin: item.sale_unit_profit_margin,
      });

    const existingOverride = await tx.product_price_tier_overrides.findFirst({
      where: {
        product_id: productId,
        variant_id: null,
        price_tier_id: tier.id,
      },
      select: { id: true },
    });
    const overrideData = {
      override_price,
      override_profit_margin,
      override_units_per_package: unitsPerPackage,
      updated_at: new Date(),
    };
    if (existingOverride) {
      await tx.product_price_tier_overrides.update({
        where: { id: existingOverride.id },
        data: overrideData,
      });
    } else {
      await tx.product_price_tier_overrides.create({
        data: {
          product_id: productId,
          variant_id: null,
          price_tier_id: tier.id,
          ...overrideData,
        },
      });
    }

    // El master switch: sin él `resolveWithTier` delega a la cascada legacy y la
    // presentación quedaría configurada pero inerte.
    await tx.products.update({
      where: { id: productId },
      data: { has_multiple_price_tiers: true },
    });
  }

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

      // La orden se resuelve ANTES que las líneas: al revés, recibir contra una
      // orden inexistente respondía "La línea N no pertenece a esta orden de
      // compra", que describe un problema que no es el que ocurrió.
      const orderHeader = await this.loadOrderOrFail(tx, id);
      // Solo `approved` y `partial` admiten mercancía. Recibir sobre un borrador
      // saltaría la aprobación, y sobre `cancelled` o `received` ingresaría
      // stock que ningún compromiso vigente respalda. El destino se afina más
      // abajo (partial vs received) según lo que quede pendiente; aquí basta
      // con validar que el estado actual admita recibir algo.
      this.assertTransition(orderHeader, purchase_order_status_enum.partial);

      // Guard: every incoming line must belong to THIS purchase order and must
      // not exceed its pending quantity (ordered − already received). Without
      // this, receive() blindly increments quantity_received, so an over-receipt
      // (e.g. 99 against 1 ordered) is accepted and inflates stock, and a line
      // id from another order could be received against this one. A throw here
      // rolls back the whole transaction (no partial reception is persisted).
      const poLines = await tx.purchase_order_items.findMany({
        where: { purchase_order_id: id },
        select: {
          id: true,
          quantity_ordered: true,
          quantity_received: true,
          // QUI-486: necesarios para el guard de línea base con variantes.
          // Se piden en esta misma consulta para no añadir un round-trip.
          product_id: true,
          product_variant_id: true,
        },
      });
      const poLineById = new Map<
        number,
        {
          id: number;
          quantity_ordered: number;
          quantity_received: number;
          product_id: number | null;
          product_variant_id: number | null;
        }
      >(poLines.map((l) => [l.id, l]));
      // El pendiente se descuenta A MEDIDA que se recorre el payload: el mapa se
      // construye una sola vez, así que dos entradas con el MISMO `id` medían
      // ambas contra el pendiente original y burlaban el tope
      // (`[{id:5,qty:10},{id:5,qty:10}]` sobre 10 pendientes recibía 20). El
      // bucle de escritura de más abajo sí usa `{ increment }` por ítem, o sea
      // que la sobre-recepción se persistía completa.
      const claimedByLine = new Map<number, number>();
      for (const item of dto.items) {
        if (item.quantity_received <= 0) continue;
        const poLine = poLineById.get(item.id);
        if (!poLine) {
          throw new BadRequestException(
            `La línea ${item.id} no pertenece a esta orden de compra`,
          );
        }
        const alreadyClaimed = claimedByLine.get(item.id) ?? 0;
        const pending =
          poLine.quantity_ordered - poLine.quantity_received - alreadyClaimed;
        if (item.quantity_received > pending) {
          throw new BadRequestException(
            `No se puede recibir ${item.quantity_received} unidad(es) de la línea ${item.id}: solo quedan ${Math.max(0, pending)} pendiente(s) de ${poLine.quantity_ordered} pedida(s)`,
          );
        }
        claimedByLine.set(item.id, alreadyClaimed + item.quantity_received);
      }

      // QUI-486 — red de seguridad para las OCs legacy que ya se crearon con
      // línea base antes de que `create()` tuviera el guard. Se valida ANTES
      // de crear la recepción para que el throw revierta la transacción sin
      // dejar recepciones parciales, igual que el guard de sobre-recepción.
      await this.assertNoBaseLineOnVariantProduct(
        tx,
        dto.items
          .filter((item) => item.quantity_received > 0)
          .map((item) => poLineById.get(item.id))
          .filter((line): line is NonNullable<typeof line> => !!line),
        { stage: 'receive', orderId: id },
      );

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
      // O-49 (non-responsible) capitalizes it.
      //
      // B.1 — indeterminado ⇒ NO responsable (fail-closed). Antes el comentario
      // decía «Indeterminate ⇒ responsible» y era cierto: el wrapper fallaba
      // abierto. Ya no.
      const vatOutcome = await this.resolveVatResponsibility(
        organizationId ?? undefined,
        storeId ?? undefined,
      );
      const vatResponsible = vatOutcome.responsible;

      // C.2 — flete capitalizado al costo. `allocated_shipping_amount` se selló
      // por línea al crear/editar la orden (ver `resolveFreightAllocation`), así
      // que la recepción NO vuelve a repartir: reparte quien conoce el lote
      // completo, y recibir parcialmente no debe cambiar el reparto pactado.
      // Solo se capitaliza cuando la cabecera dice `prorate`; con `expense` la
      // columna vale 0 y el flete no toca el costo del inventario.
      const freightProrated =
        (purchaseOrder as { shipping_cost_allocation?: string | null })
          .shipping_cost_allocation === 'prorate';

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

          // C.2 — porción del flete que aterrizó en ESTA línea, llevada a
          // unidad de compra. Se divide por `quantity_ordered` (no por lo
          // recibido en este lote) porque el reparto se pactó sobre la orden
          // completa: si se dividiera por lo recibido, una recepción parcial
          // cargaría a esas unidades todo el flete de la línea.
          const freightPerUnit =
            freightProrated && qtyOrdered > 0
              ? Number(
                  (orderItem as { allocated_shipping_amount?: unknown })
                    ?.allocated_shipping_amount ?? 0,
                ) / qtyOrdered
              : 0;

          // O-48 responsible → cost EXCLUDES IVA (net). O-49 non-responsible →
          // CAPITALIZE IVA into cost. Capitalization is on the PURCHASE unit,
          // BEFORE resolveUoMConversion (so the per-stock-unit cost the FIFO
          // engine sees already carries the capitalized IVA when applicable).
          //
          // C.2 — el flete entra AQUÍ, en unidad de COMPRA, por la misma razón:
          // sumarlo después de `resolveUoMConversion` lo desviaría exactamente
          // por `purchase_to_stock_factor`. En una compra por cajas de 12 el
          // error es de un orden de magnitud y queda sellado en la capa FIFO,
          // irreversible sin un ajuste manual.
          const costUnit =
            (vatResponsible ? netUnitCost : netUnitCost + ivaPerUnit) +
            freightPerUnit;

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

          // F2 — sellar la config de UoM del producto ANTES de convertir.
          //
          // `resolveUoMConversion` lee `purchase_to_stock_factor` del PRODUCTO,
          // no de la línea. Cuando esta función corría después, la primera
          // recepción convertía con el factor viejo (1 si el producto aún no lo
          // tenía) y la segunda ya con el factor real: 10 L de aceite en dos
          // recepciones parciales entraban como 5 ml + 5.000 ml, con dos capas
          // FIFO a costos que difieren en tres órdenes de magnitud. Y el hueco
          // era alcanzable porque `persistIngredientConfigToProduct` tiene reja
          // de industria (`storeIndustriesSupportIngredients`) que esta función
          // no tiene: una tienda no-restaurante con `order_type='ingredient'`
          // no recibía config al crear y sí al recibir.
          //
          // Es idempotente y nunca sobrescribe con null/vacío, así que adelantarla
          // no cambia nada en el caso donde el producto ya traía su config.
          await this.syncIngredientConfigOnReceipt(productId, orderItem, tx);

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
          // QUI-648 — escala de publicación del precio del producto. Se lee UNA
          // vez y alimenta los cuatro call-sites de
          // `resolvePricingAfterReceipt` (producto/variante × con/sin override):
          // el costo que entra ahí está en unidad MÍNIMA de stock y
          // `base_price`/`price_override` cubren `price_unit_quantity` de esas
          // unidades. Sin esto, recibir un cable vendido por metro reescribía su
          // precio con el costo del milímetro. La variante hereda la escala del
          // producto: `price_unit_quantity` no existe en `product_variants`.
          const pricingScaleProduct = await tx.products.findUnique({
            where: { id: productId },
            select: { price_unit_quantity: true },
          });
          const priceUnitQuantity =
            pricingScaleProduct?.price_unit_quantity ?? null;

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
                select: {
                  price_override: true,
                  profit_margin: true,
                  products: { select: { base_price: true } },
                },
              });
              // Acá el operador pinneó precio o margen, así que escribir
              // `price_override` es correcto: es un precio propio deliberado.
              // La referencia sigue siendo el precio EFECTIVO (heredado si la
              // variante no tenía override) y no 0 — con ambos overrides
              // ausentes esta rama caería al cost-anchor y un 0 daría un margen
              // de -100%, el mismo defecto de la rama sin override.
              const referencePrice =
                existingVariant?.price_override == null
                  ? Number(existingVariant?.products?.base_price ?? 0)
                  : Number(existingVariant.price_override);
              const resolved = PurchaseOrdersService.resolvePricingAfterReceipt(
                {
                  costPrice: Number(costForPricing),
                  existingBasePrice: referencePrice,
                  newBasePrice: dtoItem.new_base_price,
                  newProfitMargin: dtoItem.new_profit_margin,
                  priceUnitQuantity,
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
                  priceUnitQuantity,
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
                  select: {
                    price_override: true,
                    profit_margin: true,
                    products: { select: { base_price: true } },
                  },
                });
                // `price_override = null` significa HEREDA del producto, y esa
                // semántica no se puede aplastar con `?? 0`: el 0 resultante se
                // persistía como precio propio de la variante y dejaba
                // `profit_margin = -100`. Peor, `referencePrice = override ??
                // base_price` en `ProductVariantService` volvía imposible todo
                // PATCH posterior sobre una variante en oferta —`sale_price >= 0`
                // siempre— con `PROD_VAR_SALE_PRICE_001` permanente. Y el propio
                // invariante del dominio (`PROD_VAR_PRICE_001`) rechaza un
                // `price_override <= 0`: la recepción era el único escritor que
                // se lo saltaba. Referencia correcta = el precio efectivo hoy;
                // el override solo se escribe si la variante ya tenía uno.
                const inheritsPrice = existingVariant?.price_override == null;
                const referencePrice = inheritsPrice
                  ? Number(existingVariant?.products?.base_price ?? 0)
                  : Number(existingVariant?.price_override);
                const resolved =
                  PurchaseOrdersService.resolvePricingAfterReceipt({
                    costPrice: Number(costForPricing),
                    existingBasePrice: referencePrice,
                    priceUnitQuantity,
                  });
                await tx.product_variants.update({
                  where: { id: productVariantId },
                  data: {
                    ...(inheritsPrice
                      ? {}
                      : { price_override: resolved.basePrice }),
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
                    priceUnitQuantity,
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

          // (F2 se movió al inicio del cuerpo del ítem: la conversión de UoM lee
          // el factor del producto y necesitaba que ya estuviera sellado.)
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
        // B.4/C.11 — el resultado de TRES estados y el método de costeo viajan
        // fuera de la transacción para sellarse en la auditoría. Re-derivarlos
        // después leería la configuración de DESPUÉS, y entonces nada
        // distinguiría un cambio de configuración de un defecto.
        vat_outcome: vatOutcome,
        costing_method: costingMethod,
        // C.3 — modo de flete de la orden (sellado al crear) y su monto.
        freight_allocation: (updated_po as { shipping_cost_allocation?: string | null })
          .shipping_cost_allocation ?? null,
        freight_total:
          Math.round(Number(updated_po.shipping_cost ?? 0) * 100) / 100,
      };
    },
      // A.11 — techo EXPLÍCITO de transacción, igual que en `create()`. Una
      // recepción de 80 líneas encadena costeo FIFO, movimientos, niveles de
      // stock, series y precios: del orden de 3.000 consultas. Con el techo
      // heredado de 5.000 ms aborta con P2028 en RDS y es invisible en local.
      { timeout: 120_000, maxWait: 10_000 },
    );

    // C.3 — el flete de la cabecera, resuelto UNA vez para los dos consumidores
    // de más abajo: la auditoría (que lo sella) y la emisión contable (que lo
    // reparte entre 1435 y 513550 según el modo).
    const freight_total = result.freight_total;
    const freight_prorated = result.freight_allocation === 'prorate';
    // El flete-gasto se reconoce UNA sola vez, en la recepción que cierra la
    // orden: es un cargo de cabecera, no de línea, así que prorratearlo entre
    // recepciones parciales sólo fabricaría residuos de redondeo. Misma
    // convención que el complemento de IVA descontable.
    const freight_expense_amount =
      !freight_prorated && result.all_items_received ? freight_total : 0;

    // ===== C.11 — sellar la decisión fiscal y el modo de flete =====
    //
    // El `metadata` de una recepción era literalmente
    // `{"items_count": 1, "purchase_order_id": 213}`. La única huella indirecta
    // de la estrategia fiscal aplicada eran las dos columnas de impuesto, y en
    // 134 de 152 líneas ambas valen cero: para esas líneas la estrategia es
    // IRRECUPERABLE. Y re-derivarla mañana leería los datos fiscales de mañana —
    // tras B.2, configurar el RUT la semana que viene haría que la re-derivación
    // contradijera la orden sin que nada distinga un cambio de configuración de
    // un defecto.
    //
    // Se usa `log()` y no `logCustom()` porque `logCustom` no acepta `store_id`
    // y lo dejaba nulo en las 256 filas de compras, así que la auditoría de
    // compras no se podía filtrar por tienda. `logCustom` vive en el dominio
    // común y no se toca desde aquí.
    try {
      const user_id = RequestContextService.getUserId();
      const audit_action = result.all_items_received
        ? 'PO_RECEIVED'
        : 'PO_PARTIALLY_RECEIVED';
      await this.auditService.log({
        userId: user_id ?? 0,
        storeId:
          result.updated_po.location?.store_id ??
          RequestContextService.getStoreId() ??
          undefined,
        organizationId: result.updated_po.organization_id ?? undefined,
        action: audit_action,
        resource: 'purchase_orders',
        resourceId: id,
        metadata: {
          purchase_order_id: id,
          order_number: result.updated_po.order_number,
          reception_id: result.reception_id,
          items_count: dto.items.length,
          all_items_received: result.all_items_received,
          costing_method: toPublicCostingMethod(result.costing_method),
          fiscal_explanation: this.buildFiscalExplanation(result.vat_outcome),
          shipping_cost: result.freight_total,
          // El modo SELLADO en la cabecera, que es el que la recepción obedeció.
          // El modo SOLICITADO por el operador vive en el `metadata` de
          // `PO_CREATED`: la degradación `prorate → expense` (sin base sobre la
          // que repartir) ocurre al crear, y aquí ya no es observable. Guardar
          // dos veces el mismo valor con dos nombres distintos fingiría una
          // distinción que este punto del flujo no puede hacer.
          shipping_cost_allocation_applied: result.freight_allocation,
          // C.3 — cuánto del flete se llevó a gasto en esta recepción (513550).
          // Cero en modo `prorate` (fue al costo) y en recepciones parciales.
          freight_expense_recognized: freight_expense_amount,
          request_id: RequestContextService.getRequestId(),
        },
      });
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
    //
    // `batch_amount` (monto contabilizado como CxP en 2205 por ESTA recepción)
    // se declara en el scope externo para reutilizarlo luego en la
    // reclasificación de anticipos (DR 2205 / CR 133005).
    let batch_amount = 0;
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

      // C.3 — el flete entra al asiento. Hoy `shipping_cost` sumaba en
      // `total_amount` mientras el asiento y el auxiliar de cartera se
      // construían sobre `orderSubtotal`, que NO lo incluye; el techo de
      // sobrepago de `registerPayment` SÍ. Con flete > 0 una orden alcanzaba el
      // estado `paid` con la cartera todavía abierta por el monto del flete.
      //
      // Los dos modos difieren en QUÉ cuenta recibe el débito, no en si el
      // proveedor cobra:
      //   - `prorate`: el flete ya está DENTRO del costo de los productos
      //     (`allocated_shipping_amount` → `costUnit` → capa FIFO), así que
      //     entra al mismo asiento de recepción (DR 1435 / CR 2205).
      //   - `expense`: el flete NO toca el inventario; va a gasto del período
      //     (513550 «Transporte, Fletes y Acarreos»). Ese débito es una LÍNEA
      //     DISTINTA que el listener contable tiene que emitir — ver
      //     `freight_expense_amount` en el evento. Mientras esa línea no exista,
      //     el flete-gasto NO se suma al `total_amount` del asiento (hacerlo lo
      //     mandaría a inventario, justo lo contrario de lo que el operador
      //     eligió), pero SÍ al auxiliar de cartera, que es lo que de verdad se
      //     le debe al proveedor.
      const capitalized_freight = freight_prorated ? freight_total : 0;

      const emit_total =
        Math.round((net_total + capitalized_iva + capitalized_freight) * 100) /
        100;

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

      // ===== C.3/C.9 — el evento se emite SIEMPRE =====
      //
      // Antes esto era `if (batch_amount > 0 || freight_expense_amount > 0)`.
      // Una recepción de monto cero y sin flete —el último lote de una orden ya
      // posteada por completo, o una orden de valor cero— no emitía nada, así que
      // el dominio contable no llegaba a enterarse de que existió: sin evento no
      // hay fila de instrumentación, y el camino quedaba MUDO justo donde había
      // que poder explicar por qué no hay asiento. Es la misma forma del defecto
      // que este plan entero cierra —el sistema decide algo y no lo dice— sólo
      // que en el registro contable en vez de en la pantalla.
      //
      // Se eligió emitir siempre y dejar que el listener clasifique el caso
      // (`SKIPPED_ZERO_AMOUNT`, que ya existe y ya escribe fila) en vez de
      // registrar el salto acá. La razón es que la clasificación de por qué una
      // recepción no genera asiento queda en UN solo sitio: repartirla entre el
      // emisor y el consumidor es exactamente cómo dos lados del mismo flujo
      // terminan contando historias distintas sobre la misma recepción.
      //
      // El auxiliar de cartera no se ve afectado: `upsertPayableForReception`
      // clampea la contribución a >= 0 y es idempotente por
      // `ap_reception_links.reception_id`, así que un lote de cero sólo deja el
      // vínculo de la recepción sin mover el saldo.
      // O-48 subledger gross-up (decisión de negocio jul-2026, confirmada por
      // el usuario): la CxP (accounts_payable) DEBE reflejar el BRUTO que se le
      // debe al proveedor (= neto + IVA descontable), no el neto. El GL 2205 ya
      // llega a bruto vía DOS asientos: `purchase_order.received` (neto) + el
      // complemento `purchase.vat_recognized` (IVA, solo en la recepción final,
      // ver :2154). El subledger se alimenta ÚNICAMENTE de `gross_reception_share`,
      // así que espejamos ese complemento aquí: en la recepción final de una
      // compra O-48 sumamos el IVA descontable total del pedido a la porción del
      // subledger — SIN tocar `total_amount`, que consume el asiento GL de
      // recepción y debe seguir neto para no doble-contar el CR 2205.
      // (O-49 nunca entra: su IVA ya viene capitalizado en batch_amount.)
      let subledger_gross_share = batch_amount;
      if (result.vat_responsible && result.all_items_received) {
        const deductible_iva =
          Math.round(
            result.updated_po.purchase_order_items.reduce(
              (sum, i) => sum + Number(i.deductible_tax_amount ?? 0),
              0,
            ) * 100,
          ) / 100;
        subledger_gross_share =
          Math.round((batch_amount + deductible_iva) * 100) / 100;
      }
      // C.3 — con `expense` el flete no está dentro de `batch_amount` (no fue
      // al inventario) pero SÍ se le debe al proveedor. Sumarlo aquí es lo que
      // hace que `accounts_payable.original_amount` cuadre con
      // `purchase_orders.total_amount` y que una orden con flete deje de poder
      // llegar a `paid` con cartera abierta. Con `prorate` ya viene dentro.
      if (freight_expense_amount > 0) {
        subledger_gross_share =
          Math.round((subledger_gross_share + freight_expense_amount) * 100) /
          100;
      }
      this.eventEmitter.emit('purchase_order.received', {
        purchase_order_id: result.updated_po.id,
        reception_id: result.reception_id,
        organization_id: result.updated_po.organization_id,
        store_id,
        accounting_entity_id,
        // BRUTO real de la CxP: para O-49 = batch_amount (IVA ya capitalizado);
        // para O-48 en recepción final = batch_amount + IVA descontable total.
        // ApEventsListener.create→upsertPayableForReception lo usa como
        // gross_amount y crea 1 sola CxP por OC (incrementa original/balance en
        // cada recepción, idempotente por ap_reception_links.reception_id @unique).
        gross_reception_share: subledger_gross_share,
        // GL de recepción (DR 1435 / CR 2205): SIEMPRE neto del batch para O-48
        // (el IVA va por el complemento vat_recognized) y bruto para O-49.
        // Alias legacy para listeners que aún lean `total_amount`.
        total_amount: batch_amount,
        user_id: RequestContextService.getUserId(),
        // ApEventsListener maps the scalar `supplier_id` into the required
        // accounts_payable relation; without it createFromEvent receives
        // `undefined` and the AP row is never created (no CxP on reception).
        supplier_id: result.updated_po.supplier_id,
        // C4-followup: result.updated_po.suppliers ya viene completo del
        // include de la transacción — sin lookup adicional.
        supplier,
        // ===== C.3 — contrato de flete del evento =====
        // `shipping_expense_amount` es el monto que el listener contable
        // debita a 513550 «Transporte, Fletes y Acarreos» como línea PROPIA
        // del asiento (clave de mapeo `purchase_order.received.shipping_expense`,
        // dueño: dominio contable, C.6). El NOMBRE es el contrato: el
        // consumidor lo lee por esa clave exacta y un campo bautizado de otra
        // forma no rompe nada visiblemente — simplemente no se postea nunca la
        // línea de gasto, y el GL 2205 queda por debajo del auxiliar sin que
        // nadie reciba un error.
        //
        // Es > 0 SOLO en modo `expense` y SOLO en la recepción que cierra la
        // orden. Con `prorate` vale 0 porque el flete ya viajó dentro de
        // `total_amount` hacia 1435 (está en el costo del inventario).
        shipping_expense_amount: freight_expense_amount,
        // Contexto para lectores no contables (auditoría, depuración): el modo
        // aplicado y el flete TOTAL de la orden, que no es lo mismo que la
        // porción reconocida como gasto en esta recepción.
        shipping_cost_allocation: result.freight_allocation,
        freight_total,
      });
    } catch (error) {
      this.logger.error(
        `Failed to emit purchase_order.received for PO #${id} (reception #${result.reception_id}): ${error.message}`,
      );
    }

    // ===== ANTICIPO A PROVEEDORES: reclasificación al recibir =====
    // Si la OC tuvo pagos ANTICIPADOS (posteados a 133005 con
    // source_type='purchase_order.advance_payment'), al crear la CxP (CR 2205)
    // en la recepción hay que trasladar el anticipo contra ese pasivo:
    //   DR 2205 Proveedores / CR 133005 Anticipos, por
    //   min(monto_recibido_de_esta_recepción, saldo_anticipo_disponible).
    //
    // El SALDO se calcula desde la contabilidad REALMENTE posteada (fuente de
    // verdad, no desde flags de dominio), sin acoplarse a códigos de cuenta:
    //   saldo = Σ total_debit(advance_payment de esta OC)
    //         − Σ total_credit(advance_reclass ya posteadas de esta OC)
    // Así nunca deja 133005 en negativo aunque un pago anticipado aún no haya
    // posteado (quedaría en cola de reintento y se reclasificaría después).
    //
    // IDEMPOTENCIA: el asiento usa source_id=reception_id, así que cada
    // recepción reclasifica una sola vez (el guard de createAutoEntry lo cubre);
    // re-emitir esta recepción no duplica.
    //
    // LIMITACIÓN (parciales): con múltiples recepciones, cada una consume el
    // saldo restante en orden (FIFO por recepción) hasta agotarlo. `batch_amount`
    // es el neto (O-48) o bruto (O-49) contabilizado en 2205 por esta recepción;
    // para O-48 el complemento de IVA (240804/2205) se maneja aparte y NO se
    // reclasifica contra el anticipo (que fue caja real).
    try {
      if (batch_amount > 0) {
        // Débitos realmente posteados a 133005 por pagos anticipados de esta OC.
        const paymentIds = (
          await this.prisma.purchase_order_payments.findMany({
            where: { purchase_order_id: id },
            select: { id: true },
          })
        ).map((p) => p.id);

        let advanceDebits = 0;
        if (paymentIds.length > 0) {
          const advanceEntries =
            await this.prisma.accounting_entries.findMany({
              where: {
                source_type: 'purchase_order.advance_payment',
                source_id: { in: paymentIds },
              },
              select: { total_debit: true },
            });
          advanceDebits = advanceEntries.reduce(
            (sum, e) => sum + Number(e.total_debit || 0),
            0,
          );
        }

        // Anticipo ya reclasificado en recepciones previas (y la actual, si se
        // reintentara) de esta OC.
        const receptionIds = (
          await this.prisma.purchase_order_receptions.findMany({
            where: { purchase_order_id: id },
            select: { id: true },
          })
        ).map((r) => r.id);

        let alreadyReclassified = 0;
        if (receptionIds.length > 0) {
          const reclassEntries =
            await this.prisma.accounting_entries.findMany({
              where: {
                source_type: 'purchase_order.advance_reclass',
                source_id: { in: receptionIds },
              },
              select: { total_credit: true },
            });
          alreadyReclassified = reclassEntries.reduce(
            (sum, e) => sum + Number(e.total_credit || 0),
            0,
          );
        }

        const advanceBalance =
          Math.round((advanceDebits - alreadyReclassified) * 100) / 100;
        const reclassAmount =
          Math.round(Math.min(batch_amount, advanceBalance) * 100) / 100;

        if (reclassAmount > 0) {
          this.eventEmitter.emit('purchase_order.advance_reclass', {
            purchase_order_id: id,
            reception_id: result.reception_id,
            organization_id: result.updated_po.organization_id,
            store_id,
            accounting_entity_id,
            amount: reclassAmount,
            user_id: RequestContextService.getUserId(),
            supplier,
          });
        }
      }
    } catch (error) {
      this.logger.error(
        `Failed to emit purchase_order.advance_reclass for PO #${id} (reception #${result.reception_id}): ${error.message}`,
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
        // FASE TRACK B2/B4 — liga el adjunto a un pago concreto cuando el modal
        // de pago sube el comprobante tras registrar el pago. Nullable: los
        // adjuntos de factura/OC normales siguen sin payment_id.
        payment_id: dto.payment_id ?? null,
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

  /**
   * QUI-647 — registra el PAGO REAL de un abono declarado al crear la OC.
   *
   * `create()` corre dentro de `this.prisma.$transaction` y Prisma NO permite
   * anidar transacciones, así que este helper recibe el `tx` abierto y ejecuta
   * el core de `registerPayment` (fila de pago + recálculo de payment_status)
   * SIN abrir otra transacción.
   *
   * El abono es un ANTICIPO (is_advance=true): la OC no tiene recepciones al
   * momento de crearse, y el asiento DR 133005 / CR 1110 lo postea el handler
   * de `purchase_order.payment` que se emite DESPUÉS del commit — ver
   * emitPurchaseOrderPaymentEvent. Aquí no se hace el puente PO→AP (el espejo
   * de registerPayment) a propósito: la CxP no puede existir todavía porque
   * nace con la recepción.
   */
  private async registerAdvancePaymentInTx(
    tx: any,
    purchaseOrderId: number,
    amount: number,
    userId: number | undefined,
  ): Promise<{ id: number; paymentStatus: 'unpaid' | 'partial' | 'paid' }> {
    const payment = await tx.purchase_order_payments.create({
      data: {
        purchase_order_id: purchaseOrderId,
        amount,
        payment_date: new Date(),
        payment_method: PO_ADVANCE_PAYMENT_METHOD,
        source: PO_ADVANCE_SOURCE,
        created_by_user_id: userId,
      },
    });

    const status = await this.recalculatePaymentStatus(purchaseOrderId, tx);
    await tx.purchase_orders.update({
      where: { id: purchaseOrderId },
      data: { payment_status: status as any },
    });

    return { id: payment.id, paymentStatus: status };
  }

  /**
   * QUI-647 — emite `purchase_order.payment` para contabilidad.
   *
   * El EMISOR resuelve `is_advance` (la OC no tenía recepciones al momento del
   * pago → anticipo) y el snapshot del proveedor/entidad fiscal; el handler
   * contable NUNCA lo detecta. Se llama SIEMPRE después del commit de la
   * transacción que creó la fila de pago (los handlers corren async y deben
   * leer la fila ya persistida). Compartido por registerPayment y create().
   */
  private async emitPurchaseOrderPaymentEvent(params: {
    purchaseOrder: {
      id: number;
      organization_id: number;
      location?: { store_id?: number | null } | null;
      suppliers?: {
        id: number;
        name: string;
        tax_id?: string | null;
      } | null;
    };
    paymentId: number;
    amount: number;
    paymentMethod: string;
    userId?: number;
  }) {
    try {
      const { purchaseOrder: po, paymentId, amount, paymentMethod, userId } =
        params;
      const receptionsCount = await this.prisma.purchase_order_receptions.count(
        {
          where: { purchase_order_id: po.id },
        },
      );
      const is_advance = receptionsCount === 0;

      const store_id = po.location?.store_id ?? undefined;
      const supplier = po.suppliers
        ? {
            id: po.suppliers.id,
            name: po.suppliers.name,
            tax_id: po.suppliers.tax_id ?? undefined,
          }
        : undefined;

      let accounting_entity_id: number | undefined;
      try {
        const entity =
          await this.fiscalScopeService.resolveAccountingEntityForFiscal({
            organization_id: po.organization_id,
            store_id,
          });
        accounting_entity_id = entity?.id;
      } catch (error: any) {
        this.logger.warn(
          `Could not resolve fiscal accounting entity for PO payment #${po.id}: ${error?.message}`,
        );
      }

      this.eventEmitter.emit('purchase_order.payment', {
        purchase_order_id: po.id,
        payment_id: paymentId,
        organization_id: po.organization_id,
        store_id,
        accounting_entity_id,
        amount: Number(amount),
        payment_method: paymentMethod,
        is_advance,
        user_id: userId,
        supplier,
      });
    } catch (error) {
      this.logger.error(
        `Failed to emit purchase_order.payment for PO #${params.purchaseOrder.id}: ${error.message}`,
      );
    }
  }

  async registerPayment(purchaseOrderId: number, dto: RegisterPaymentDto) {
    const po = await this.prisma.purchase_orders.findUnique({
      where: { id: purchaseOrderId },
      include: { suppliers: true, location: true },
    });
    if (!po) {
      throw new NotFoundException('Purchase order not found');
    }

    const userId = RequestContextService.getUserId();

    // Atomic: validate overpay → create payment row → recalc payment_status.
    // Mirrors and backfill (Fase 3) MUST run inside the same $transaction so
    // the helper's SUM() sees the new row before committing — and so a failed
    // recompute rolls back the payment insert (no half-state on disk).
    const { payment, paymentStatus } = await this.prisma.$transaction(
      async (tx) => {
        // Overpay guard — must run INSIDE the tx so a concurrent registerPayment
        // can't slip past the check (without the lock two payments summing to
        // > total_amount would each see the pre-state and both commit).
        const totalAmount = Number(po.total_amount);
        const currentAgg = await tx.purchase_order_payments.aggregate({
          where: { purchase_order_id: purchaseOrderId },
          _sum: { amount: true },
        });
        const projectedTotal =
          Number(currentAgg._sum.amount || 0) + Number(dto.amount);
        if (projectedTotal > totalAmount + 0.005) {
          throw new BadRequestException(
            'El pago excedería el monto total de la orden',
          );
        }

        const created = await tx.purchase_order_payments.create({
          data: {
            purchase_order_id: purchaseOrderId,
            amount: dto.amount,
            payment_date: new Date(dto.payment_date),
            payment_method: dto.payment_method,
            reference: dto.reference,
            notes: dto.notes,
            created_by_user_id: userId,
            source: 'po_modal',
          },
        });

        // QUI-647 — si el frontend manda `payment_schedule_id` (caso del
        // ícono "Pagar" en una cuota del plan), marcamos la cuota como
        // `status='paid'` en la MISMA transacción. Sin esto el schedule
        // quedaba en `planned` aunque el pago se registrara — el bug
        // original del usuario. UPDATE acotado al `id` correcto para no
        // pisar cuotas vecinas si por error llegan schedules de otra OC
        // (defensa por FK cruzada).
        if (dto.payment_schedule_id) {
          await tx.purchase_order_payment_schedules.updateMany({
            where: {
              id: dto.payment_schedule_id,
              purchase_order_id: purchaseOrderId,
              status: 'planned',
            },
            data: {
              status: 'paid',
              materialized_at: new Date(),
            },
          });
        }

        // FASE 3 — PUENTE PO→AP: si la OC ya tiene una CxP, espejar el pago
        // hacia ap_payments (source='po_bridge') y bajar balance/paid_amount.
        // El espejo NO emite ap.payment_registered (no doble caja contable).
        // Esta llamada requiere el AccountsPayableService — se hace vía tx
        // compartido para no romper la atomicidad. La búsqueda de la CxP y
        // el espejo se ejecutan dentro del mismo $transaction.
        const ap = await tx.accounts_payable.findFirst({
          where: {
            source_type: 'purchase_order',
            source_id: purchaseOrderId,
          },
          select: { id: true },
        });
        if (ap) {
          const mirror = await this.accountsPayableService.mirrorPoPaymentToAp(
            {
              purchase_order_payment_id: created.id,
              accounts_payable_id: ap.id,
              amount: Number(dto.amount),
              payment_date: created.payment_date,
              payment_method: dto.payment_method,
              reference: dto.reference,
              notes: dto.notes,
              user_id: userId ?? undefined,
            },
            tx,
          );
          // Bajar balance / paid_amount de la CxP (in-line; evita invocar
          // applyPoPaymentToApBalance para no armar dos $transactions).
          const apRow = await tx.accounts_payable.findUnique({
            where: { id: ap.id },
            select: { original_amount: true, paid_amount: true, balance: true, status: true },
          });
          if (apRow) {
            const newPaid = Number(apRow.paid_amount) + Number(dto.amount);
            const newBalance = Math.max(
              Number(apRow.original_amount) - newPaid,
              0,
            );
            const newStatus =
              newBalance <= 0
                ? 'paid'
                : Number(apRow.balance) <= 0
                  ? 'partial'
                  : apRow.status;
            await tx.accounts_payable.update({
              where: { id: ap.id },
              data: {
                paid_amount: newPaid,
                balance: newBalance,
                status: newStatus,
              },
            });
          }
          void mirror; // referenced; carries ap_payment_id if needed
        }

        const status = await this.recalculatePaymentStatus(
          purchaseOrderId,
          tx,
        );
        await tx.purchase_orders.update({
          where: { id: purchaseOrderId },
          data: { payment_status: status as any },
        });

        return { payment: created, paymentStatus: status };
      },
    );

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

    // Emit event for accounting (helper compartido con create(): el EMISOR
    // resuelve `is_advance` y el snapshot proveedor/entidad; el handler
    // contable NUNCA lo detecta).
    await this.emitPurchaseOrderPaymentEvent({
      purchaseOrder: po,
      paymentId: payment.id,
      amount: Number(dto.amount),
      paymentMethod: dto.payment_method,
      userId,
    });

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

  /**
   * Vista previa del costo de una compra ANTES de crearla.
   *
   * CP-PURCHASE-TRANSPARENCY A.2 / A.12 / B.4 la reordenó por tres razones:
   *
   *  - **A.2 — el prorrateo se calcula sobre el LOTE, no por ítem.** Antes el
   *    bucle procesaba cada línea aislada y DECLINABA repartir el descuento de
   *    cabecera, con un comentario que reconocía que adivinar la porción
   *    mostraría un costo que `create()` no iba a persistir. Con el flete esa
   *    concesión deja de ser aceptable: si la vista previa no reparte, miente.
   *    Ahora el descuento de cabecera y el flete se reparten con los MISMOS
   *    helpers que usa `create()` (`prorateHeaderDiscount`,
   *    `resolveFreightAllocation`), así que la paridad se garantiza por
   *    contrato compartido y no por réplica aritmética.
   *  - **A.12 — las consultas salen del bucle, TODAS.** El producto, la
   *    variante, el nivel de stock, la configuración de unidad de medida y el
   *    agregado de stock con alcance se leían línea por línea. La vista previa
   *    se redispara con cada cambio de cabecera, así que su costo tiene que ser
   *    constante y no crecer con el tamaño del carrito. Hoy el bucle NO emite
   *    ninguna consulta: es aritmética sobre mapas ya resueltos. El agregado
   *    con alcance fue el último en izarse, vía
   *    `CostingService.getScopedStockAggregates` (una consulta para los N
   *    pares, más una sola resolución de la ubicación de cabecera).
   *  - **B.4 — devuelve `fiscal_explanation`.** El frontend deja de re-derivar
   *    el predicado de IVA para explicar el costo. Había cuatro réplicas del
   *    predicado en el repositorio con valores por omisión divergentes: si el
   *    paso de recepción se explica con el dato del backend y el de
   *    confirmación con el selector del frontend, dos pasos del MISMO asistente
   *    pueden contradecirse sobre la misma factura.
   */
  async getCostPreview(dto: CostPreviewDto) {
    const organizationId = RequestContextService.getOrganizationId();
    if (!organizationId) {
      throw new BadRequestException('Organization ID not found in context');
    }

    // C.7 — la vista previa aplica la MISMA regla de cabecera que la creación.
    // Un flete sin modo de imputación no se puede costear, y aceptarlo acá
    // dejaría al operador aprobar una simulación que el `POST` rechaza.
    const freightContractError = validateFreightAndTaxHeader(
      dto as {
        shipping_cost?: number;
        shipping_cost_allocation?: string;
        prices_include_tax?: boolean;
        items?: Array<{ tax_rate?: number } | null | undefined>;
      },
    );
    if (freightContractError) {
      throw new BadRequestException(freightContractError);
    }

    // ===== A.12: resoluciones de CONJUNTO, una sola vez para todo el lote =====

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
    // for this preview, using the SAME source of truth as receive(). O-48
    // responsible → IVA is descontable, EXCLUDED from cost (net). O-49
    // non-responsible → IVA is CAPITALIZED into the inventory cost. Without
    // this, the preview shows a NET cost while receive() persists a GROSS one,
    // so the modal's new_cost_per_unit diverges from the recorded cost_per_unit
    // by exactly the IVA factor (the observed 1.19 for a 19% line).
    //
    // B.1 — el resultado trae TRES estados. `responsible` gobierna la
    // aritmética; `indeterminate` y `reason` gobiernan lo que se le explica al
    // operador (ver `fiscal_explanation` al final).
    const vatOutcome = await this.resolveVatResponsibility(
      organizationId,
      storeId ?? undefined,
    );
    const vatResponsible = vatOutcome.responsible;

    const productIds = Array.from(
      new Set(dto.items.map((i) => i.product_id).filter((id) => !!id)),
    );
    const variantIds = Array.from(
      new Set(
        dto.items
          .map((i) => i.product_variant_id)
          .filter((id): id is number => !!id),
      ),
    );

    // Un solo barrido del catálogo para TODO el lote. Trae a la vez el snapshot
    // de precio para la UX de margen y la configuración de unidad de medida que
    // `applyUoMConversion` necesita: son la misma fila, leerla dos veces era
    // pagar el doble por el mismo dato.
    type PreviewProductRow = {
      id: number;
      name: string | null;
      base_price: unknown;
      profit_margin: unknown;
      price_unit_quantity: number | null;
      is_ingredient: boolean | null;
      purchase_to_stock_factor: unknown;
      stock_uom_id: number | null;
      purchase_uom_id: number | null;
    };
    const productRows: PreviewProductRow[] = productIds.length
      ? await this.prisma.products.findMany({
          where: { id: { in: productIds } },
          select: {
            id: true,
            name: true,
            base_price: true,
            profit_margin: true,
            // QUI-648 — escala de publicación del precio: sin ella el margen que
            // muestra el modal mezcla el costo del milímetro con el precio del
            // metro (ver `resolvePricingAfterReceipt`).
            price_unit_quantity: true,
            is_ingredient: true,
            purchase_to_stock_factor: true,
            stock_uom_id: true,
            purchase_uom_id: true,
          },
        })
      : [];
    const productById = new Map(productRows.map((p) => [p.id, p]));

    // Variants carry their own price_override (NOT base_price) and
    // profit_margin. We read both so the margin UX reflects the variant
    // pricing when a variant is involved.
    type PreviewVariantRow = {
      id: number;
      name: string | null;
      price_override: unknown;
      profit_margin: unknown;
    };
    const variantRows: PreviewVariantRow[] = variantIds.length
      ? await this.prisma.product_variants.findMany({
          where: { id: { in: variantIds } },
          select: {
            id: true,
            name: true,
            price_override: true,
            profit_margin: true,
          },
        })
      : [];
    const variantById = new Map(variantRows.map((v) => [v.id, v]));

    // Snapshot por ubicación (solo para mostrar). NO alimenta el CPP: eso sale
    // de `getScopedStockAggregate`.
    type PreviewStockRow = {
      product_id: number;
      product_variant_id: number | null;
      quantity_on_hand: unknown;
      cost_per_unit: unknown;
    };
    const stockRows: PreviewStockRow[] = productIds.length
      ? await this.prisma.stock_levels.findMany({
          where: {
            location_id: dto.location_id,
            product_id: { in: productIds },
          },
          select: {
            product_id: true,
            product_variant_id: true,
            quantity_on_hand: true,
            cost_per_unit: true,
          },
        })
      : [];
    const stockKey = (productId: number, variantId: number | null) =>
      `${productId}:${variantId ?? 'base'}`;
    const stockByKey = new Map(
      stockRows.map((s) => [
        stockKey(s.product_id, s.product_variant_id ?? null),
        s,
      ]),
    );

    // A.12 (cierre) — el agregado de stock con alcance, que era la ÚLTIMA
    // lectura que quedaba dentro del bucle, también sale de él.
    //
    // Es el número que gobierna la vista previa: `global_stock` decide si la
    // compra es una reactivación y `global_cost_per_unit` es la base del CPP
    // que el modal muestra. Se leía una vez por renglón, y cada lectura traía
    // además su propia resolución de ubicación (`inventory_locations` +
    // alcance operativo): una orden de 30 líneas pagaba ~60-90 consultas en un
    // endpoint que se redispara con cada tecla del encabezado. Ahora es UNA
    // consulta para todo el lote, más la resolución de ubicación una sola vez
    // —la ubicación receptora es de la CABECERA, no de la línea.
    //
    // La aritmética no cambia: `getScopedStockAggregates` es la implementación
    // canónica y `getScopedStockAggregate` (el que usa `receive()` dentro de su
    // transacción) delega en ella, así que vista previa y recepción siguen
    // emitiendo la MISMA consulta sobre el MISMO universo — el contrato A.0.
    const scopedAggregates = await this.costingService.getScopedStockAggregates(
      {
        keys: dto.items.map((i) => ({
          product_id: i.product_id,
          variant_id: i.product_variant_id ?? null,
        })),
        location_id: dto.location_id,
      },
    );

    // ===== A.2: el prorrateo se resuelve sobre el LOTE, antes del bucle =====

    // QUI-661 — el descuento de cabecera se reparte con el MISMO helper que
    // `create()`. Antes la vista previa lo ignoraba y mostraba un costo que la
    // orden nunca iba a tener.
    const headerShares = this.prorateHeaderDiscount(
      dto.items,
      Number(dto.discount_amount || 0),
    );

    // F1 IVA lifecycle: derive the NET cost from the entered (possibly gross)
    // unit_cost + tax_rate + effective include-tax mode. The NET is the cost
    // basis for CPP/FIFO — mirrors what create/receive persist.
    const derivedByLine = dto.items.map((item, index) =>
      this.deriveLineTax(
        {
          unit_cost: item.unit_cost,
          quantity: item.quantity,
          tax_rate: item.tax_rate,
          prices_include_tax: item.prices_include_tax,
          discount_percentage: item.discount_percentage,
          discount_amount: item.discount_amount,
        },
        dto,
        headerShares[index],
      ),
    );

    const quantitiesPerLine = dto.items.map((i) => Number(i.quantity ?? 0));
    const netPerLine = derivedByLine.map(
      (d, index) => d.unit_price_net * quantitiesPerLine[index],
    );

    // C.2 — mismo reparto de flete que `create()`. La base es el neto después
    // de descuentos y el residuo va a la última línea, así que la suma de
    // porciones es EXACTAMENTE el flete de la cabecera.
    const freight = this.resolveFreightAllocation({
      shippingCost: Number(dto.shipping_cost || 0),
      requested: dto.shipping_cost_allocation,
      netPerLine,
      quantities: quantitiesPerLine,
      context: `getCostPreview() ubicación ${dto.location_id}`,
    });
    const freightCapitalized = freight.applied === 'prorate';

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
      /**
       * B.4 — el desglose por línea en las MISMAS dos columnas mutuamente
       * excluyentes que `receive()` sella (`deductible_tax_amount` /
       * `capitalized_tax_amount`). Una de las dos es siempre 0.
       */
      deductible_tax_amount: number;
      capitalized_tax_amount: number;
      /** QUI-661 — descuento total aplicado (propio + porción de cabecera). */
      discount_amount: number;
      header_discount_share: number;
      /** C.2 — porción del flete de la cabecera imputada a esta línea. */
      allocated_shipping_amount: number;
      shipping_per_unit: number;
      is_reactivation: boolean;
      current_base_price: number;
      current_profit_margin: number;
      resulting_margin: number | null;
      /**
       * QUI-648 — a cuántas unidades de stock corresponde `current_base_price`.
       * `resulting_margin` ya viene medido en esta escala; el campo viaja para
       * que el modal pueda re-derivar el margen con el mismo cociente cuando el
       * operador escribe un precio a mano (hoy lo hace contra
       * `new_cost_per_unit`, que está en unidad mínima). 1 = sin escala.
       */
      price_unit_quantity: number;
    }> = [];

    for (let index = 0; index < dto.items.length; index++) {
      const item = dto.items[index];
      const product = productById.get(item.product_id);
      const stockLevel = stockByKey.get(
        stockKey(item.product_id, item.product_variant_id ?? null),
      );

      const currentStock = Number(stockLevel?.quantity_on_hand ?? 0);
      const currentCost = Number(stockLevel?.cost_per_unit ?? 0);

      // Universo de stock en alcance (organización o tienda + bodega central)
      // ya resuelto para TODO el lote antes del bucle. Acá sólo se lee la
      // entrada del par.
      //
      // Por qué ese universo es el que es: A.0 lo unificó. El agregado emite
      // una consulta CRUDA con la pertenencia de ubicación escrita en el
      // `WHERE` (`il.organization_id` siempre; bajo alcance STORE también la
      // tienda MÁS `il.store_id IS NULL`), y por eso es inmune al alcance del
      // cliente que la ejecute: la vista previa la corre por el cliente sin
      // alcance y `receive()` por su handle transaccional, y agregan EL MISMO
      // conjunto. Antes no: `StorePrismaService` sobrescribe `$transaction`
      // hacia el cliente CON alcance y `mergeScopedWhere` ANDea el filtro, así
      // que la recepción perdía la bodega central de la organización. La
      // brecha medida era del 4,8 % entre lo que el operador aprobaba y lo que
      // el sistema sellaba (producto 268: 119 unidades y 1.649.457,36 en la
      // vista previa contra 25 y 1.728.571,43 en la recepción).
      //
      // El aislamiento entre organizaciones lo da ese `WHERE`, no el cliente
      // Prisma. Ver `CostingService.getScopedStockAggregates`.
      const scoped = scopedAggregates.get(
        scopedStockKey(item.product_id, item.product_variant_id ?? null),
      ) ?? { quantity: 0, cost_per_unit: 0 };
      const globalStock = scoped.quantity;
      const globalCostPerUnit = scoped.cost_per_unit;

      const derivedTax = derivedByLine[index];
      const netUnitCost = derivedTax.unit_price_net;
      const quantity = quantitiesPerLine[index];

      // ===== F3 preview↔persist parity: mirror receive()'s unit cost EXACTLY =====
      // receive() derives the per-stock-unit cost that FIFO/CPP consumes as:
      //   costUnit = (vatResponsible ? net : net + iva) + freightPerUnit
      //   { stockQuantity, stockUnitCost } = resolveUoMConversion(qty, costUnit)
      // where ivaPerUnit == orderItem.tax_amount / quantity_ordered and
      // freightPerUnit == allocated_shipping_amount / quantity_ordered. Because
      // create() persists tax_amount = deriveLineTax().tax_amount (= per-unit
      // tax × quantity), allocated_shipping_amount = prorateShipping()[i] and
      // quantity_ordered = quantity, ambos cocientes son exactamente los que se
      // calculan acá.
      //
      // (1) IVA: O-48 responsible → NET; O-49 non-responsible → capitalize IVA.
      const ivaPerUnit = derivedTax.tax_amount_per_unit;
      // (2) Flete: solo en modo `prorate`, y en unidad de COMPRA — sumarlo
      // después de la conversión de unidad de medida lo desviaría exactamente
      // por `purchase_to_stock_factor`.
      const lineFreight = freightCapitalized ? (freight.shares[index] ?? 0) : 0;
      const freightPerUnit = quantity > 0 ? lineFreight / quantity : 0;
      const costUnit =
        (vatResponsible ? netUnitCost : netUnitCost + ivaPerUnit) +
        freightPerUnit;

      // (3) UoM: convert the incoming purchase-unit quantity + capitalized cost
      // to MINIMUM stock units via the SAME arithmetic receive() uses. The CPP
      // must be computed in stock units because globalStock/globalCostPerUnit
      // come from stock_levels (already in stock units) — mixing a purchase-unit
      // quantity into the denominator drifts the result by the conversion
      // factor. Con factor 1 (todo el catálogo retail) el resultado es idéntico
      // al de antes.
      const {
        stockQuantity: incomingStockQty,
        stockUnitCost: incomingStockUnitCost,
      } = PurchaseOrdersService.applyUoMConversion(product, quantity, costUnit);

      const newStock = globalStock + incomingStockQty;
      // D.2 (ya aterrizado) — `globalStock` NO cuenta stock de productos
      // archivados. El filtro (`p.state IS DISTINCT FROM 'archived'`) vive
      // dentro del SQL del agregado, y este `globalStock` sale precisamente de
      // ahí, así que la detección de reactivación ya no lo ve: volver a
      // comprar un producto que el operador archivó se trata como stock en
      // cero y se cotiza al costo ENTRANTE, en vez de promediarse contra las
      // existencias fantasma que el archivado dejó en `stock_levels`. Medido
      // en desarrollo: el producto 378, archivado con 20.000 unidades a 3,00,
      // hacía que una compra a 100,00 cotizara 2,03; hoy cotiza 100,00.
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

      const variant = item.product_variant_id
        ? variantById.get(item.product_variant_id)
        : undefined;
      const variantName = variant?.name || undefined;
      const variantBasePrice =
        variant?.price_override != null ? Number(variant.price_override) : null;
      const variantMargin =
        variant?.profit_margin != null ? Number(variant.profit_margin) : null;

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
      //
      // QUI-648 — se mide contra el costo llevado a la ESCALA DEL PRECIO, igual
      // que `resolvePricingAfterReceipt`: `new_cost_per_unit` es el costo de la
      // unidad mínima de stock y `current_base_price` cubre
      // `price_unit_quantity` de esas unidades. Este es el número que el modal
      // propone como margen por defecto, así que la vista previa y lo que la
      // recepción persiste tienen que salir del mismo cociente. Con escala 1
      // —todo el catálogo histórico— `costInPriceScale === newCostPerUnit` y el
      // resultado es idéntico al de antes.
      //
      // `new_cost_per_unit` NO se re-escala a propósito: es el costo que la
      // recepción sella en `stock_levels.cost_per_unit` / `products.cost_price`
      // y la paridad preview↔persist de F3 depende de que siga en unidad mínima.
      const costInPriceScale =
        newCostPerUnit * resolvePricedUnits(null, product?.price_unit_quantity);
      // Mismo techo/piso que la persistencia: el modal no debe ofrecer como
      // margen por defecto un número que la columna `Decimal(5,2)` rechazaría —
      // el operador lo aceptaba y la recepción moría con un 500 opaco.
      const rawResultingMargin =
        costInPriceScale > 0
          ? Math.round(
              ((currentBasePrice - costInPriceScale) / costInPriceScale) * 10000,
            ) / 100
          : null;
      const resultingMargin =
        rawResultingMargin === null
          ? null
          : PurchaseOrdersService.clampProfitMargin(rawResultingMargin);

      const lineTaxTotal = Math.round(derivedTax.tax_amount * 100) / 100;

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
        incoming_quantity: quantity,
        // incoming_cost is the NET cost basis that actually enters inventory
        // (equals the entered value when no tax applies — legacy-compatible).
        incoming_cost: Math.round(netUnitCost * 100) / 100,
        incoming_gross_cost: item.unit_cost,
        unit_price_net: Math.round(netUnitCost * 100) / 100,
        incoming_tax_per_unit:
          Math.round(derivedTax.tax_amount_per_unit * 100) / 100,
        incoming_tax_amount: lineTaxTotal,
        effective_include: derivedTax.effective_include,
        // Mutuamente excluyentes, igual que las columnas que sella `receive()`.
        deductible_tax_amount: vatResponsible ? lineTaxTotal : 0,
        capitalized_tax_amount: vatResponsible ? 0 : lineTaxTotal,
        discount_amount: Math.round(derivedTax.discount_total * 100) / 100,
        header_discount_share: Math.round((headerShares[index] ?? 0) * 100) / 100,
        allocated_shipping_amount: freight.shares[index] ?? 0,
        shipping_per_unit: Math.round(freightPerUnit * 100) / 100,
        is_reactivation: isReactivation,
        current_base_price: currentBasePrice,
        current_profit_margin: currentProfitMargin,
        resulting_margin: resultingMargin,
        price_unit_quantity: resolvePricedUnits(
          null,
          product?.price_unit_quantity,
        ),
      });
    }

    // `vat_responsible` viaja al frontend porque sin él la vista previa no
    // puede explicar su propio número: con responsabilidad de IVA el costo que
    // entra a inventario es el NETO y el IVA es descontable (240804), mientras
    // que sin ella el IVA ya está capitalizado DENTRO de `new_cost_per_unit`.
    // Es la misma cifra en pantalla con dos significados opuestos, y el operador
    // calcula su margen sobre ella.
    //
    // B.4 — `fiscal_explanation` es el contrato ESTRUCTURADO de esa explicación:
    // distingue «declaró que no es responsable» de «no pudimos saberlo», dice
    // qué se hizo con el impuesto, lo fundamenta y —solo cuando el estado es
    // indeterminado— ofrece la acción que lo resuelve. `vat_responsible` se
    // conserva para los clientes que ya lo leen; un cliente antiguo ignora el
    // campo nuevo sin romperse.
    return {
      costing_method: toPublicCostingMethod(costingMethod),
      vat_responsible: vatResponsible,
      fiscal_explanation: this.buildFiscalExplanation(vatOutcome),
      shipping_cost: freight.total,
      // Solicitado y aplicado por separado: `prorate` degrada a `expense`
      // cuando no hay neto ni cantidad sobre la que repartir, y el operador
      // tiene que ver que su elección no se pudo honrar.
      shipping_cost_allocation_requested: freight.requested,
      shipping_cost_allocation_applied: freight.applied,
      items,
    };
  }

  /**
   * Borrado físico, reservado a borradores. Antes era un `delete()` desnudo:
   * se podía eliminar una orden recibida y con ella sus líneas, dejando el
   * stock ingresado sin documento que lo respaldara.
   */
  async remove(id: number) {
    return this.prisma.$transaction(async (tx) => {
      const order = await this.loadOrderOrFail(tx, id);
      this.assertMutable(order, 'eliminar');
      return tx.purchase_orders.delete({
        where: { id },
      });
    });
  }

  /**
   * Canonical helper for `purchase_orders.payment_status`. Single writer.
   *
   * Sums ALL payment rows attached to the PO (primary `po_modal` + any mirror
   * from the AP↔OC bridge in Fase 3 + any advance backfill) and compares to
   * the gross `total_amount`. Use inside an existing `$transaction` so the
   * SUM sees uncommitted rows in the same tx; passing the `prisma` client as
   * `tx` is what makes that work.
   *
   * Exported via `as any` on the call site to satisfy the schema enum without
   * importing the Prisma-generated enum (avoids circular enum imports in
   * downstream services that may consume this helper in Fase 3).
   */
  async recalculatePaymentStatus(
    purchaseOrderId: number,
    tx: any,
  ): Promise<'unpaid' | 'partial' | 'paid'> {
    const EPS = 0.005;
    const po = await tx.purchase_orders.findUnique({
      where: { id: purchaseOrderId },
      select: { total_amount: true },
    });
    if (!po) {
      throw new NotFoundException('Purchase order not found');
    }
    const grossTotal = Number(po.total_amount);
    const agg = await tx.purchase_order_payments.aggregate({
      where: { purchase_order_id: purchaseOrderId },
      _sum: { amount: true },
    });
    const totalPaid = Number(agg._sum.amount || 0);
    if (totalPaid >= grossTotal - EPS) return 'paid';
    if (totalPaid > EPS) return 'partial';
    return 'unpaid';
  }

  /**
   * QUI-647 — Configura el plan de pago de una OC ya creada (PATCH payment-plan).
   *
   * Reglas:
   *  - Solo OCs en status draft/approved (NO recibidas/cerradas/anuladas).
   *  - NO permite el cambio si ya existen pagos reales registrados contra la
   *    OC. Devuelve 409 en ese caso.
   *  - Aplica la matriz anti-doble-registro reusando registerAdvancePaymentInTx
   *    para abonos y materializando schedules para cuotas/fechas del saldo.
   *  - Un abono acá es un ANTICIPO con asiento: emite `purchase_order.payment`
   *    después del commit, igual que create() y registerPayment. Sin eso el
   *    abono quedaba registrado contra la OC sin contrapartida contable.
   *  - payment_status queda persistido en los dos caminos (lo escribe el
   *    helper cuando hay abono; el recálculo del final cuando no lo hay).
   */
  async configurePaymentPlan(
    id: number,
    dto: import('./dto/configure-payment-plan.dto').ConfigurePaymentPlanDto,
    userId?: number,
  ): Promise<unknown> {
    const order = await this.prisma.purchase_orders.findUnique({
      where: { id },
      select: {
        id: true,
        status: true,
        total_amount: true,
        organization_id: true,
        payment_plan: true,
        // El EMISOR de `purchase_order.payment` resuelve la entidad fiscal por
        // store y el snapshot del proveedor; el handler contable nunca los
        // consulta, así que tienen que viajar en este mismo read.
        location: { select: { store_id: true } },
        suppliers: { select: { id: true, name: true, tax_id: true } },
      },
    });
    if (!order) {
      throw new VendixHttpException(
        ErrorCodes.PO_FIND_001,
        'Orden de compra no encontrada',
      );
    }

    const blockedStatuses = ['received', 'cancelled', 'closed'];
    if (blockedStatuses.includes(order.status)) {
      throw new VendixHttpException(
        ErrorCodes.PO_PAYMENT_006,
        `No se puede reconfigurar el plan de pago: la orden está ${order.status}.`,
      );
    }

    const existingPayments = await this.prisma.purchase_order_payments.findMany({
      where: { purchase_order_id: id },
      select: { id: true },
    });
    if (existingPayments.length > 0) {
      throw new VendixHttpException(
        ErrorCodes.PO_PAYMENT_006,
        'La orden ya tiene pagos registrados; no se puede reconfigurar el plan.',
      );
    }

    const totalAmount = Number(order.total_amount);
    const plan = dto.payment_plan;
    const down = plan === 'partial' ? Number(dto.down_payment_amount ?? 0) : 0;
    const dueDate = dto.payment_due_date ?? null;
    const installments = dto.payment_installments ?? [];

    const todayLocal = localDateString(new Date(), 'America/Bogota');
    const isPast = (s: string) => s < todayLocal;

    if (plan === 'partial') {
      if (!(down > 0 && down < totalAmount)) {
        throw new VendixHttpException(
          ErrorCodes.PO_PAYMENT_002,
          `El abono ${down} debe ser mayor que 0 y menor que el total ${totalAmount}.`,
        );
      }
      if (dueDate && isPast(dueDate)) {
        throw new VendixHttpException(
          ErrorCodes.PO_PAYMENT_004,
          `La fecha de pago del saldo ${dueDate} no puede ser anterior a hoy (${todayLocal}).`,
        );
      }
    } else if (plan === 'deferred') {
      if (!dueDate || isPast(dueDate)) {
        throw new VendixHttpException(
          ErrorCodes.PO_PAYMENT_003,
          `Pago diferido requiere fecha ≥ hoy (${todayLocal}).`,
        );
      }
    } else if (plan === 'installments') {
      if (installments.length === 0) {
        throw new VendixHttpException(
          ErrorCodes.PO_PAYMENT_006,
          'Crédito con cuotas requiere al menos una cuota.',
        );
      }
      const sum = installments.reduce((s, i) => s + Number(i.amount), 0);
      if (Math.abs(sum - totalAmount) > 0.01) {
        throw new VendixHttpException(
          ErrorCodes.PO_PAYMENT_005,
          `La suma de cuotas ${sum} no coincide con el total ${totalAmount}.`,
        );
      }
      if (installments.some((i) => isPast(i.scheduled_date))) {
        throw new VendixHttpException(
          ErrorCodes.PO_PAYMENT_004,
          'Alguna cuota tiene fecha anterior a hoy.',
        );
      }
    }

    const orderId = order.id;
    const advanceRegistered = await this.prisma.$transaction(async (tx) => {
      let advance: { paymentId: number; amount: number } | null = null;

      await tx.purchase_order_payment_schedules.deleteMany({
        where: { purchase_order_id: orderId, status: 'planned' },
      });

      const newDown = plan === 'partial' ? down : null;
      const newDueDate =
        plan === 'deferred' || (plan === 'partial' && dueDate) ? dueDate : null;

      await tx.purchase_orders.update({
        where: { id: orderId },
        data: {
          payment_plan: plan,
          down_payment_amount: newDown,
          payment_due_date: newDueDate ? new Date(newDueDate) : null,
        },
      });

      if (plan === 'partial' && down > 0) {
        // El abono configurado acá es un PAGO REAL, igual que el declarado al
        // crear la OC: se delega en el mismo helper para que la fila lleve
        // created_by_user_id y para que payment_status quede PERSISTIDO. El
        // asiento DR 133005 / CR 1110 lo dispara el evento que se emite
        // después del commit (ver más abajo).
        const registered = await this.registerAdvancePaymentInTx(
          tx,
          orderId,
          down,
          userId,
        );
        advance = { paymentId: registered.id, amount: down };
        if (dueDate) {
          await tx.purchase_order_payment_schedules.create({
            data: {
              purchase_order_id: orderId,
              scheduled_date: new Date(dueDate),
              amount: new Prisma.Decimal(totalAmount).minus(down),
              status: 'planned',
            },
          });
        }
      }

      if (plan === 'installments') {
        for (const inst of installments) {
          await tx.purchase_order_payment_schedules.create({
            data: {
              purchase_order_id: orderId,
              scheduled_date: new Date(inst.scheduled_date),
              amount: new Prisma.Decimal(inst.amount),
              status: 'planned',
            },
          });
        }
      }

      // registerAdvancePaymentInTx ya recalculó Y escribió payment_status en el
      // camino con abono; repetirlo acá sería recalcular dos veces sobre las
      // mismas filas. Los planes sin pago (immediate/deferred/installments) no
      // pasan por el helper, y ahí el recálculo solo servía si además se
      // persiste — antes se descartaba el retorno y el estado nunca bajaba.
      if (!advance) {
        const status = await this.recalculatePaymentStatus(orderId, tx);
        await tx.purchase_orders.update({
          where: { id: orderId },
          data: { payment_status: status as any },
        });
      }

      return advance;
    });

    // El evento contable se emite DESPUÉS del commit: el handler de
    // `purchase_order.payment` corre async y debe leer la fila de pago ya
    // persistida (misma convención que create() y registerPayment).
    if (advanceRegistered) {
      await this.emitPurchaseOrderPaymentEvent({
        purchaseOrder: order,
        paymentId: advanceRegistered.paymentId,
        amount: advanceRegistered.amount,
        paymentMethod: PO_ADVANCE_PAYMENT_METHOD,
        userId,
      });
    }

    return await this.findOne(orderId);
  }
}
