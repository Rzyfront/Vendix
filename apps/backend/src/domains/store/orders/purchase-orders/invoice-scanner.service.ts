import { Injectable, Logger } from '@nestjs/common';
import { AIEngineService } from '../../../../ai-engine/ai-engine.service';
import { AIMessage } from '../../../../ai-engine/interfaces/ai-provider.interface';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { PurchaseOrdersService } from './purchase-orders.service';
import { SettingsService } from '../../settings/settings.service';
import { RequestContextService } from '@common/context/request-context.service';
import { ResponseService } from '@common/responses/response.service';
import { VendixHttpException, ErrorCodes } from '@common/errors';
import {
  buildTaxCategoryScopeWhere,
  preferOwnStoreCategories,
} from '@common/helpers/tax-category-scope.helper';
import {
  VatResponsibilityService,
  VatResponsibilityResult,
} from '@common/helpers/vat-responsibility.helper';
import {
  InvoiceScanResult,
  InvoiceMatchResult,
  SupplierMatch,
  MatchedLineItem,
  MatchedLineReason,
  QuantityAdjustmentReason,
  ProductCandidate,
  ArchivedProductRef,
  ConfirmScannedInvoiceDto,
} from './dto/scan-invoice.dto';
import {
  CreatePurchaseOrderDto,
  PurchaseOrderItemDto,
  PURCHASE_ORDER_ITEMS_MAX,
} from './dto/create-purchase-order.dto';
import { AddAttachmentDto } from './dto/add-attachment.dto';
import { parseAiJson } from '../../../../ai-engine/utils/ai-json.util';
import {
  buildCurrencyInstruction,
  checkTotalsConsistency,
  repairScannedAmount,
  StoreCurrencyInfo,
} from '../../../../ai-engine/utils/ocr-money.util';
import sharp = require('sharp');

/**
 * Resultado interno del emparejador de productos.
 *
 * `archivedDiscards` son los productos ARCHIVADOS que el emparejador reconoció
 * y descartó a propósito. Existe porque «no lo emparejé» y «lo emparejé pero
 * está archivado» son dos cosas distintas para el operador, y la segunda no
 * puede desaparecer en silencio: si el escáner reconoce el producto por SKU y
 * simplemente omite la línea, el operador ve una factura con un renglón menos
 * y no tiene forma de saber por qué. El descarte sale por DOS canales —
 * `MatchedLineItem.match_reason` + `archived_candidate` (pegado al renglón) y
 * `InvoiceMatchResult.warnings` (la cabecera de la revisión).
 */
interface ProductMatchLookup {
  candidates: ProductCandidate[];
  archivedDiscards: ArchivedProductRef[];
}

/**
 * Configuración de empaque de un producto emparejado, leída una sola vez por
 * escaneo para poder convertir una cantidad fraccionaria a unidades enteras.
 */
interface ProductPackaging {
  /** `products.purchase_to_stock_factor` (unidades de stock por empaque). */
  factor: number;
  /**
   * `true` cuando `PurchaseOrdersService.resolveUoMConversion` volverá a
   * multiplicar por el factor al RECIBIR la orden. Es el espejo exacto de esa
   * guarda (`purchase-orders.service.ts:342-356`). Si el escáner convirtiera
   * también, el stock entraría multiplicado dos veces por el factor — la
   * clase de bug que ese helper existe para impedir.
   */
  receiptConverts: boolean;
  stockUnit: string | null;
  purchaseUnit: string | null;
}

/**
 * Formatea una cantidad para el operador colombiano sin depender de ICU:
 * 2.5 → "2,5", 30 → "30", 0.315 → "0,315". Determinista en tests.
 */
function formatQuantity(value: number): string {
  if (!Number.isFinite(value)) return '0';
  return String(Number(value.toFixed(3))).replace('.', ',');
}

/** Un número es «entero» con tolerancia al ruido de coma flotante. */
function isWholeNumber(value: number): boolean {
  return Number.isFinite(value) && Math.abs(value - Math.round(value)) < 1e-6;
}

@Injectable()
export class InvoiceScannerService {
  private readonly logger = new Logger(InvoiceScannerService.name);

  constructor(
    private readonly aiEngine: AIEngineService,
    private readonly prisma: StorePrismaService,
    private readonly purchaseOrdersService: PurchaseOrdersService,
    private readonly settingsService: SettingsService,
    private readonly responseService: ResponseService,
    // P0.1 — consolidación del predicado `isVatResponsible`. Antes era una
    // constante local + un método privado que replicaban la lógica del
    // helper canónico. Mismo razonamiento que en PurchaseOrdersService.
    private readonly vatService: VatResponsibilityService,
  ) {}

  /**
   * Fase 4: `orderType` selects the AI application key. Defaults to
   * `retail` (the original `invoice_ocr`). When the user is scanning an
   * ingredient order, callers should pass `orderType: 'ingredient'`
   * and we route to `invoice_ocr_ingredient` so the model also extracts
   * `presentation` / `pack_size` / `uom_hint`.
   *
   * Mixed-line orders are out of scope (V1): the caller picks one profile
   * per scan.
   */
  async scanInvoice(
    file: Express.Multer.File,
    orderType: 'retail' | 'ingredient' = 'retail',
  ): Promise<InvoiceScanResult> {
    this.logger.debug(
      `[InvoiceScan] File: mimetype=${file.mimetype}, size=${file.size}, buffer=${file.buffer?.length ?? 'NO BUFFER'}`,
    );

    const { base64, mimeType } = await this.preprocessImage(file);
    const dataUri = `data:${mimeType};base64,${base64}`;

    this.logger.debug(`[InvoiceScan] DataURI length: ${dataUri.length} chars`);

    // Anchor the model to the store's real currency. Without this the model
    // falls back to a decimal-currency prior and reads the Colombian
    // thousands separator as a decimal point ("24.990" → 24.99), a silent
    // 1000x error. The instruction lives in the USER message, not the system
    // prompt, because the currency is per-store and the prompt is global.
    const currency = await this.resolveScanCurrency();

    const imageMessage: AIMessage = {
      role: 'user',
      content: [
        {
          type: 'text',
          text:
            'Extract all data from this purchase invoice image. Return ONLY the JSON object matching the schema defined in your system instructions.\n\n' +
            buildCurrencyInstruction(currency),
        },
        {
          type: 'image_url',
          image_url: { url: dataUri, detail: 'high' },
        },
      ],
    };

    const appKey =
      orderType === 'ingredient' ? 'invoice_ocr_ingredient' : 'invoice_ocr';
    this.logger.debug(
      `[InvoiceScan] Sending to AI engine (profile=${orderType}, appKey=${appKey})...`,
    );
    const response = await this.aiEngine.run(appKey, {}, [imageMessage]);

    this.logger.debug(
      `[InvoiceScan] AI response: success=${response.success}, contentLength=${response.content?.length ?? 0}, model=${response.model}, error=${response.error}`,
    );
    this.logger.debug(
      `[InvoiceScan] AI content preview: ${response.content?.substring(0, 300)}`,
    );

    if (!response.success || !response.content) {
      this.logger.error(`AI OCR failed: ${response.error}`);
      throw new VendixHttpException(ErrorCodes.INV_SCAN_AI_FAIL);
    }

    // Parsing and validation are deliberately separate. They used to share one
    // try/catch, so a model reply that parsed perfectly but omitted `total`
    // was reported as "no se pudo parsear el JSON" — the wrong diagnosis, and
    // exactly the shape a POS receipt (no invoice number, no printed subtotal)
    // produces.
    let parsed: unknown;
    try {
      parsed = parseAiJson(response.content);
    } catch (err: any) {
      this.logger.error(
        `Failed to parse AI OCR response (${err?.message}). Raw content: ${response.content}`,
      );
      throw new VendixHttpException(ErrorCodes.INV_SCAN_PARSE_FAIL);
    }

    try {
      return this.normalizeOcrResponse(parsed, currency);
    } catch (err: any) {
      if (err instanceof VendixHttpException) throw err;
      this.logger.error(
        `AI OCR response incomplete (${err?.message}). Raw content: ${response.content}`,
      );
      throw new VendixHttpException(ErrorCodes.INV_SCAN_INCOMPLETE);
    }
  }

  /**
   * Store currency + decimal places for the scan, resolved once per request.
   * Never throws: a settings failure degrades to USD/2 decimals, which only
   * disables the zero-decimal repair — it can never trigger it wrongly.
   */
  private async resolveScanCurrency(): Promise<StoreCurrencyInfo> {
    try {
      return await this.settingsService.getStoreCurrencyInfo();
    } catch (err: any) {
      this.logger.warn(
        `[InvoiceScan] Could not resolve store currency (${err?.message}); defaulting to USD/2.`,
      );
      return { code: 'USD', decimal_places: 2 };
    }
  }

  async matchProducts(
    scanResult: InvoiceScanResult,
  ): Promise<InvoiceMatchResult> {
    // Carry over the notices raised during /scan (amount repairs, totals
    // mismatch) so they reach the review step instead of dying in the
    // round-trip through the frontend.
    const warnings: string[] = Array.isArray(scanResult.scan_warnings)
      ? [...scanResult.scan_warnings]
      : [];
    let supplierMatch: SupplierMatch;

    // F3 IVA lifecycle: resolve the commerce's VAT responsibility ONCE. A
    // non-responsible tenant (O-49) capitalizes IVA into cost and must not be
    // handed a deductible tax_category, so we skip loading rates entirely and
    // every `suggested_tax_category_id` stays null.
    const vatResponsibility = await this.resolveVatResponsibility();
    const taxCategoryRates = vatResponsibility.responsible
      ? await this.loadTaxCategoryRates()
      : [];

    // CP-PURCHASE-TRANSPARENCY I.a — el aviso que faltaba.
    //
    // B.0 hizo que el predicado fiscal fallara cerrado y devolviera tres
    // estados, pero el escáner seguía capitalizando el IVA de TODA la factura
    // sin decírselo a nadie: el usuario veía costos con el impuesto adentro y
    // ningún `suggested_tax_category_id`, sin saber que el sistema había
    // tomado una decisión fiscal por él. Arreglar el cálculo sin contar la
    // decisión no es arreglar el problema.
    //
    // Los dos orígenes del estado indeterminado NO se cuentan igual:
    //   · `absent`     → el comercio nunca configuró su área fiscal. La salida
    //                    es el asistente; se lo nombramos.
    //   · `read_error` → puede tenerla perfectamente configurada y la lectura
    //                    falló ahora. Mandarlo al asistente sería mentirle.
    if (vatResponsibility.indeterminate) {
      warnings.push(
        vatResponsibility.source === 'read_error'
          ? `${vatResponsibility.message} No es que falte configuración: no pudimos ` +
              'leerla en este momento. Si tu comercio sí es responsable de IVA, vuelve ' +
              'a escanear la factura en unos minutos antes de confirmar la compra, ' +
              'porque el impuesto se está sumando al costo del inventario.'
          : `${vatResponsibility.message} Configura tu área fiscal en Finanzas → ` +
              'Fiscal → Asistente (/admin/fiscal/wizard) si eres responsable de IVA; ' +
              'mientras tanto el impuesto de esta factura se suma al costo del ' +
              'inventario en vez de quedar como IVA descontable.',
      );
    }

    // Supplier match — never throw
    try {
      supplierMatch = await this.matchSupplier(scanResult);
      if (supplierMatch.is_new) {
        warnings.push(
          `Proveedor "${scanResult.supplier?.name || 'Desconocido'}" no encontrado en el sistema. Puedes seleccionarlo manualmente.`,
        );
      }
    } catch (err) {
      this.logger.warn(`Supplier matching failed: ${err.message}`);
      supplierMatch = {
        name: scanResult.supplier?.name || 'Desconocido',
        confidence: 0,
        is_new: true,
      };
      warnings.push(
        'No se pudo buscar el proveedor. Puedes seleccionarlo manualmente.',
      );
    }

    // Item matching — each item individually wrapped
    const matchedItems: MatchedLineItem[] = [];

    for (const item of scanResult.line_items || []) {
      try {
        const lookup = await this.findProductCandidates(
          item,
          supplierMatch.matched_id,
        );
        const candidates = lookup.candidates;
        const topCandidate = candidates.length > 0 ? candidates[0] : null;

        let matchStatus: 'matched' | 'partial' | 'new' = 'new';
        let selectedProductId: number | undefined;

        if (topCandidate) {
          if (topCandidate.confidence >= 90) {
            matchStatus = 'matched';
            selectedProductId = topCandidate.id;
          } else if (topCandidate.confidence >= 50) {
            matchStatus = 'partial';
            if (topCandidate.confidence >= 80) {
              selectedProductId = topCandidate.id;
            }
          }
        }

        // CP-PURCHASE-TRANSPARENCY D.1 — el descarte por archivado nunca es
        // silencioso. La línea llega igual (marcada como `new`), con el motivo
        // al lado, para que el operador reactive el producto o cree uno nuevo
        // en vez de encontrarse una factura con un renglón menos.
        const archived = lookup.archivedDiscards[0];
        let matchReason: MatchedLineReason | undefined;
        if (matchStatus === 'new') {
          matchReason = archived ? 'archived_candidate' : 'no_catalog_match';
          warnings.push(
            archived
              ? `Producto "${item.description}": el catálogo tiene "${archived.name}"` +
                  `${archived.sku ? ` (SKU ${archived.sku})` : ''}, pero está ARCHIVADO ` +
                  'y no se seleccionó a propósito — su costo y su stock ya no cuentan ' +
                  'para esta compra. Reactívalo desde el catálogo si vas a seguir ' +
                  'comprándolo, o crea un producto nuevo desde esta línea.'
              : `Producto "${item.description}" sin coincidencias en el catálogo.`,
          );
        } else if (archived) {
          matchReason = 'archived_sku_reassigned';
          // Se emparejó con OTRO producto activo pese a que el SKU impreso
          // pertenece a uno archivado. Es exactamente el caso en que el
          // operador debe mirar: la línea no va al producto que dice el papel.
          warnings.push(
            `Producto "${item.description}": el SKU impreso pertenece a ` +
              `"${archived.name}", que está ARCHIVADO. Se propuso ` +
              `"${topCandidate?.name ?? 'otro producto'}" en su lugar. Verifica que ` +
              'sea el correcto antes de confirmar.',
          );
        }

        matchedItems.push({
          ...item,
          match_status: matchStatus,
          selected_product_id: selectedProductId,
          candidates: candidates.slice(0, 5),
          // El motivo va PEGADO al renglón, no sólo en la lista de avisos: un
          // «el producto X está archivado» flotando arriba con veinte líneas
          // debajo obliga al operador a buscar cuál es X.
          match_reason: matchReason,
          archived_candidate: matchReason?.startsWith('archived')
            ? archived
            : undefined,
          // F3: sugerencia de impuesto por tasa + neto ya aplanado.
          suggested_tax_category_id: this.suggestTaxCategoryId(
            item.tax_rate,
            taxCategoryRates,
          ),
          unit_cost_net: Number(item.unit_price) || 0,
        });
      } catch (err) {
        this.logger.warn(
          `Item matching failed for "${item.description}": ${err.message}`,
        );
        warnings.push(`No se pudo buscar "${item.description}".`);
        matchedItems.push({
          ...item,
          match_status: 'new',
          selected_product_id: undefined,
          candidates: [],
          // La búsqueda falló; la línea llega vacía por un error transitorio,
          // no porque el catálogo no tenga el producto. La pantalla debe poder
          // decir eso mismo en vez de "sin coincidencias".
          match_reason: 'lookup_failed',
          // F3: mantiene el contrato aun cuando el match de producto falla.
          suggested_tax_category_id: this.suggestTaxCategoryId(
            item.tax_rate,
            taxCategoryRates,
          ),
          unit_cost_net: Number(item.unit_price) || 0,
        });
      }
    }

    // CP-PURCHASE-TRANSPARENCY I.b — el puente entre la factura y el carrito.
    await this.reconcileFractionalQuantities(matchedItems, warnings);

    // El tope de líneas de la orden es `PURCHASE_ORDER_ITEMS_MAX` (DTO). Una
    // factura de distribuidora lo supera sin esfuerzo, y el 400 llegaría
    // DESPUÉS de que el operador revisó línea por línea. Se avisa acá, al
    // principio de la revisión, en vez de al final.
    if (matchedItems.length > PURCHASE_ORDER_ITEMS_MAX) {
      warnings.push(
        `La factura trae ${matchedItems.length} líneas y una orden de compra ` +
          `admite máximo ${PURCHASE_ORDER_ITEMS_MAX}. Divídela en varias órdenes ` +
          'antes de confirmar: si la envías completa, la creación se rechaza.',
      );
    }

    return {
      supplier_match: supplierMatch,
      items: matchedItems,
      warnings,
    };
  }

  /**
   * CP-PURCHASE-TRANSPARENCY I.b — convierte las cantidades fraccionarias a
   * enteros ANTES de llenar el carrito, y dice siempre qué hizo.
   *
   * `purchase_order_items.quantity_ordered` es `Int` y se queda `Int`
   * (decisión de negocio). La vista previa de costo sí admite fracción
   * (`CostPreviewItemDto`, 3 decimales) para mostrar el efecto de «2,5 cajas»
   * ANTES de convertir; la creación exige el entero que la columna guarda. El
   * escáner es el puente: sin él, una factura por peso (0,315 KGM) o por
   * fracción de empaque muere en un 400 de validación que no explica nada.
   *
   * Dos caminos, y ninguno calla:
   *
   *  1. CONVERSIÓN EXACTA — el producto declara `purchase_to_stock_factor` y
   *     la recepción NO lo va a volver a aplicar. 2,5 cajas × 12 = 30 unidades.
   *     El costo unitario se divide por el mismo factor, así que el total de
   *     la línea (lo que el proveedor cobró) no se mueve ni un peso.
   *
   *  2. REDONDEO — no hay factor utilizable, o la conversión tampoco da entero.
   *     Se usa el entero más cercano (mínimo 1, porque el DTO exige `@Min(1)`)
   *     y el costo unitario NO se toca: el costo unitario es lo que alimenta el
   *     CPP/FIFO y tiene que seguir siendo el que imprime la factura. Lo que se
   *     mueve es el total de la línea, y el aviso da las dos cifras.
   *
   * La guarda del caso 1 es el espejo de `resolveUoMConversion`
   * (`purchase-orders.service.ts:342-356`): si la recepción va a multiplicar
   * por el factor, convertir acá metería el stock multiplicado DOS veces. Esa
   * es precisamente la clase de bug —«stock y FIFO se separan por exactamente
   * el factor de conversión»— que ese helper documenta como la más peligrosa
   * del flujo de recepción.
   *
   * Salida rápida: si ninguna línea trae fracción (el caso abrumadoramente
   * mayoritario) no se ejecuta ni una consulta.
   */
  private async reconcileFractionalQuantities(
    items: MatchedLineItem[],
    warnings: string[],
  ): Promise<void> {
    const fractional = items.filter(
      (item) => !isWholeNumber(Number(item.quantity)),
    );
    if (fractional.length === 0) return;

    const packaging = await this.loadPackagingFactors(
      fractional
        .map((item) => item.selected_product_id)
        .filter((id): id is number => typeof id === 'number'),
    );

    for (const item of fractional) {
      const original = Number(item.quantity) || 0;
      const pack =
        item.selected_product_id != null
          ? packaging.get(item.selected_product_id)
          : undefined;

      const factor = pack?.factor ?? 0;
      const canConvert =
        pack != null && !pack.receiptConverts && Number.isFinite(factor) && factor > 1;
      const converted = canConvert ? original * factor : NaN;

      const stockLabel = pack?.stockUnit || 'unidades';
      const purchaseLabel = pack?.purchaseUnit || 'empaques';

      if (canConvert && isWholeNumber(converted)) {
        const stockQuantity = Math.round(converted);
        const scale = (value: unknown): number => Number(value) / factor;

        const previousUnitPrice = Number(item.unit_price) || 0;
        const newUnitPrice = scale(item.unit_price);
        item.quantity = stockQuantity;
        item.unit_price = newUnitPrice;
        if (item.unit_price_gross != null) {
          item.unit_price_gross = scale(item.unit_price_gross);
        }
        // `unit_cost_net` es, por contrato, el mismo neto que `unit_price`.
        if (item.unit_cost_net != null) {
          item.unit_cost_net = newUnitPrice;
        }
        // `discount_amount` y `total` son montos de LÍNEA, no por unidad: no
        // se escalan. Dividirlos rebajaría el descuento y el total al pasar de
        // empaques a unidades, que es dinero que sí existió en la factura.

        // Estructurado y pegado al renglón: la pantalla muestra el antes y el
        // después sin volver a abrir la factura ni partir la cadena del aviso.
        item.quantity_adjustment = {
          reason: 'converted_to_stock_units',
          original_quantity: original,
          applied_quantity: stockQuantity,
          original_unit_price: previousUnitPrice,
          applied_unit_price: newUnitPrice,
          packaging_factor: factor,
          stock_unit: pack?.stockUnit ?? null,
          purchase_unit: pack?.purchaseUnit ?? null,
        };

        warnings.push(
          `«${item.description}»: la factura la trae como ${formatQuantity(original)} ` +
            `${purchaseLabel} y cada uno equivale a ${formatQuantity(factor)} ` +
            `${stockLabel}. La orden guarda cantidades enteras, así que se cargó como ` +
            `${stockQuantity} ${stockLabel} a ${formatQuantity(newUnitPrice)} c/u. ` +
            'El total de la línea no cambia.',
        );
        continue;
      }

      const rounded = Math.max(1, Math.round(original));
      const unitPrice = Number(item.unit_price) || 0;
      const { reason, text } = this.explainQuantityRoundReason(
        item,
        pack,
        converted,
        stockLabel,
      );

      item.quantity = rounded;
      item.quantity_adjustment = {
        reason,
        original_quantity: original,
        applied_quantity: rounded,
        // Al redondear el costo unitario NO se toca: es lo que alimenta el
        // CPP/FIFO y tiene que seguir siendo el que imprime la factura.
        original_unit_price: unitPrice,
        applied_unit_price: unitPrice,
        packaging_factor:
          pack != null && Number.isFinite(pack.factor) && pack.factor > 1
            ? pack.factor
            : undefined,
        converted_quantity:
          reason === 'rounded_conversion_not_exact' ? converted : undefined,
        stock_unit: pack?.stockUnit ?? null,
        purchase_unit: pack?.purchaseUnit ?? null,
      };

      warnings.push(
        `«${item.description}»: la factura la trae como ${formatQuantity(original)} ` +
          `y la orden solo guarda cantidades enteras (${text}). Se cargó ` +
          `${rounded}. El costo unitario NO se tocó ` +
          `(${formatQuantity(unitPrice)}), así que el total de la línea pasa de ` +
          `${formatQuantity(original * unitPrice)} a ` +
          `${formatQuantity(rounded * unitPrice)}. Revísalo antes de confirmar.`,
      );
    }
  }

  /**
   * Por qué no se pudo convertir la cantidad y hubo que redondear. El operador
   * necesita saberlo para poder arreglarlo (configurar el empaque, cambiar la
   * unidad de la línea) en vez de solo enterarse de que el número cambió.
   *
   * Devuelve el motivo TIPADO (para `quantity_adjustment.reason`, que la
   * interfaz renderiza pegado al renglón) y su texto (para el aviso de
   * cabecera). Las dos salidas nacen del mismo `if`, así que no pueden
   * divergir.
   */
  private explainQuantityRoundReason(
    item: MatchedLineItem,
    pack: ProductPackaging | undefined,
    converted: number,
    stockLabel: string,
  ): { reason: QuantityAdjustmentReason; text: string } {
    if (item.selected_product_id == null) {
      return {
        reason: 'rounded_unmatched_line',
        text:
          'la línea todavía no está emparejada con un producto del catálogo, ' +
          'así que no hay factor de empaque que aplicar',
      };
    }
    if (pack == null || !Number.isFinite(pack.factor) || pack.factor <= 1) {
      return {
        reason: 'rounded_no_packaging_factor',
        text: 'el producto no tiene un factor de empaque configurado',
      };
    }
    if (pack.receiptConverts) {
      return {
        reason: 'rounded_factor_applied_at_receipt',
        text:
          `el factor de empaque del producto (${formatQuantity(pack.factor)} ` +
          `${stockLabel} por ${pack.purchaseUnit || 'empaque'}) se aplica al RECIBIR ` +
          'la orden, así que la cantidad tiene que quedar en la unidad de compra',
      };
    }
    return {
      reason: 'rounded_conversion_not_exact',
      text:
        `convertir con el factor daría ${formatQuantity(converted)} ${stockLabel}, ` +
        'que tampoco es un entero',
    };
  }

  /**
   * Lee la configuración de empaque de los productos emparejados en UNA sola
   * consulta (nunca dentro del bucle de líneas: una factura de 100 renglones
   * abriría 100 lecturas y deja el pool de Prisma en el suelo).
   *
   * Nunca lanza: sin configuración de empaque el puente simplemente redondea y
   * avisa, que es peor experiencia pero nunca un escaneo caído.
   */
  private async loadPackagingFactors(
    productIds: number[],
  ): Promise<Map<number, ProductPackaging>> {
    const result = new Map<number, ProductPackaging>();
    const unique = Array.from(new Set(productIds));
    if (unique.length === 0) return result;

    try {
      const products = await this.prisma.products.findMany({
        where: { id: { in: unique } },
        select: {
          id: true,
          is_ingredient: true,
          purchase_to_stock_factor: true,
          stock_uom_id: true,
          purchase_uom_id: true,
          stock_unit: true,
          purchase_unit: true,
        },
      });

      for (const product of products) {
        const factor = Number(product.purchase_to_stock_factor ?? 0);
        const declaresBothUoms =
          product.stock_uom_id != null && product.purchase_uom_id != null;
        result.set(product.id, {
          factor,
          receiptConverts:
            (!!product.is_ingredient || declaresBothUoms) &&
            Number.isFinite(factor) &&
            factor > 0,
          stockUnit: product.stock_unit,
          purchaseUnit: product.purchase_unit,
        });
      }
    } catch (err: any) {
      this.logger.warn(
        `[InvoiceScan] Could not load packaging factors (${err?.message}); ` +
          'fractional quantities will be rounded with a notice.',
      );
    }

    return result;
  }

  /** @deprecated Use frontend cart injection instead. Kept for backward compatibility. */
  async confirmAndCreatePO(
    dto: ConfirmScannedInvoiceDto,
    file?: Express.Multer.File,
  ) {
    const items: PurchaseOrderItemDto[] = dto.items.map((item) => {
      const poItem = new PurchaseOrderItemDto();
      if (item.product_id) {
        poItem.product_id = item.product_id;
      } else {
        poItem.product_id = 0;
        poItem.product_name = item.product_name || item.description;
        poItem.sku = item.sku;
      }
      poItem.quantity = item.quantity;
      poItem.unit_price = item.unit_cost;
      // QUI-661 Fase 4: el descuento comercial de la línea llega desde el modal
      // de confirmación (el usuario lo revisó) y entra al motor de descuentos,
      // que lo resta de la base ANTES de derivar el IVA y lo capitaliza al
      // costo. Se manda solo cuando es > 0 para no escribir ceros en órdenes
      // que no tienen descuento.
      if (item.discount_amount && item.discount_amount > 0) {
        poItem.discount_amount = item.discount_amount;
      }
      poItem.notes = item.description;
      return poItem;
    });

    const createDto = new CreatePurchaseOrderDto();
    createDto.supplier_id = dto.supplier_id ?? 0;
    createDto.location_id = dto.location_id;
    createDto.items = items;
    createDto.notes = dto.notes;
    createDto.tax_amount = dto.tax_amount;
    createDto.discount_amount = dto.discount_amount;

    if (dto.invoice_date) {
      createDto.order_date = dto.invoice_date;
    }

    const po = await this.purchaseOrdersService.create(createDto);

    if (dto.save_attachment && file) {
      const attachmentDto = new AddAttachmentDto();
      attachmentDto.supplier_invoice_number = dto.invoice_number;
      attachmentDto.supplier_invoice_date = dto.invoice_date;
      attachmentDto.notes = 'Factura escaneada con OCR';

      await this.purchaseOrdersService.addAttachment(
        po.id,
        file,
        attachmentDto,
      );
    }

    return po;
  }

  // --- Private helpers ---

  private async matchSupplier(
    scanResult: InvoiceScanResult,
  ): Promise<SupplierMatch> {
    const { supplier } = scanResult;

    try {
      // Tier 1: Match by tax_id (exact, case-insensitive)
      // Excluye archivados: sugerir uno haría que el usuario abra una OC contra
      // un proveedor que ya sacó de circulación. Los inactivos sí se sugieren —
      // el matching solo propone, y reactivarlo es un clic.
      if (supplier.tax_id) {
        const byTax = await this.prisma.suppliers.findFirst({
          where: {
            tax_id: { equals: supplier.tax_id, mode: 'insensitive' },
            state: { not: 'archived' },
          },
        });
        if (byTax) {
          return {
            matched_id: byTax.id,
            name: byTax.name,
            tax_id: byTax.tax_id,
            confidence: 95,
            is_new: false,
          };
        }
      }

      // Tier 2 & 3: Load suppliers and do bidirectional + word matching
      if (supplier.name) {
        const allSuppliers = await this.prisma.suppliers.findMany({
          where: { state: { not: 'archived' } },
          select: { id: true, name: true, tax_id: true },
          take: 200,
        });

        const extractedLower = supplier.name.toLowerCase().trim();
        let bestMatch: {
          id: number;
          name: string;
          tax_id: string | null;
        } | null = null;
        let bestScore = 0;

        // Tier 2: Bidirectional contains
        for (const s of allSuppliers) {
          const dbLower = s.name.toLowerCase().trim();
          if (
            dbLower.includes(extractedLower) ||
            extractedLower.includes(dbLower)
          ) {
            const ratio =
              Math.min(extractedLower.length, dbLower.length) /
              Math.max(extractedLower.length, dbLower.length);
            const score = 65 + ratio * 20; // 65-85 range
            if (score > bestScore) {
              bestScore = score;
              bestMatch = s;
            }
          }
        }

        if (bestMatch && bestScore >= 65) {
          return {
            matched_id: bestMatch.id,
            name: bestMatch.name,
            tax_id: bestMatch.tax_id ?? undefined,
            confidence: Math.round(bestScore),
            is_new: false,
          };
        }

        // Tier 3: Word-level overlap
        const extractedWords = extractedLower
          .split(/\s+/)
          .filter((w) => w.length > 2);

        if (extractedWords.length > 0) {
          for (const s of allSuppliers) {
            const dbWords = s.name
              .toLowerCase()
              .split(/\s+/)
              .filter((w) => w.length > 2);
            if (dbWords.length === 0) continue;

            let matches = 0;
            for (const ew of extractedWords) {
              for (const dw of dbWords) {
                if (dw.includes(ew) || ew.includes(dw)) {
                  matches++;
                  break;
                }
              }
            }

            const score =
              (matches / Math.max(extractedWords.length, dbWords.length)) * 60;
            if (score > bestScore && score >= 30) {
              bestScore = score;
              bestMatch = s;
            }
          }

          if (bestMatch && bestScore >= 30) {
            return {
              matched_id: bestMatch.id,
              name: bestMatch.name,
              tax_id: bestMatch.tax_id ?? undefined,
              confidence: Math.round(bestScore),
              is_new: false,
            };
          }
        }
      }
    } catch (err) {
      this.logger.warn(`Supplier matching failed gracefully: ${err.message}`);
    }

    return {
      name: supplier.name,
      tax_id: supplier.tax_id,
      confidence: 0,
      is_new: true,
    };
  }

  /**
   * CP-PURCHASE-TRANSPARENCY D.1 — los tres niveles excluyen los productos
   * ARCHIVADOS.
   *
   * Por qué era la puerta de entrada del defecto: `@@unique([store_id, sku])`
   * impide crear un producto nuevo con el SKU de uno archivado, así que el
   * operador que «borra y vuelve a cargar» pasa forzosamente por el nivel 1. Y
   * ahí el emparejamiento se autoselecciona con confianza ≥ 90 sin que nadie
   * mire: `selected_product_id` quedaba sellado contra un producto archivado y
   * la compra volvía a promediar su costo y su stock. `matchSupplier` ya
   * excluía los proveedores archivados, con la razón escrita — la asimetría
   * era un descuido, no una decisión.
   *
   * El descarte se decide EN MEMORIA, no con un `where`, a propósito: filtrar
   * en la consulta borraría el único hecho que el operador necesita ver
   * («existe, pero está archivado»). El nivel 1 es una lectura de fila única
   * por SKU, así que leer el `state` y ramificar cuesta lo mismo que filtrar.
   * El nivel 3 conserva su filtro de base de datos: ahí un archivado no es «el
   * producto reconocido» sino una coincidencia de palabras, y silenciarlo no
   * le quita información a nadie.
   */
  private async findProductCandidates(
    item: { description: string; sku_if_visible?: string },
    supplierId?: number,
  ): Promise<ProductMatchLookup> {
    const candidates: ProductCandidate[] = [];
    const archivedDiscards: ArchivedProductRef[] = [];
    const seenIds = new Set<number>();

    // Tier 1: SKU exact match
    if (item.sku_if_visible) {
      const bySku = await this.prisma.products.findFirst({
        where: { sku: { equals: item.sku_if_visible, mode: 'insensitive' } },
        select: {
          id: true,
          name: true,
          sku: true,
          cost_price: true,
          state: true,
        },
      });
      if (bySku) {
        // `seenIds` se marca en AMBAS ramas: un archivado descartado acá no
        // puede volver a colarse como candidato por los niveles 2 o 3.
        seenIds.add(bySku.id);
        if (bySku.state === 'archived') {
          archivedDiscards.push({
            id: bySku.id,
            name: bySku.name,
            sku: bySku.sku,
          });
        } else {
          candidates.push({
            id: bySku.id,
            name: bySku.name,
            sku: bySku.sku || '',
            cost_price: bySku.cost_price ? Number(bySku.cost_price) : undefined,
            confidence: 95,
          });
        }
      }
    }

    // Tier 2: Supplier catalog match
    if (supplierId) {
      const supplierProducts = await this.prisma.supplier_products.findMany({
        where: { supplier_id: supplierId },
        include: {
          products: {
            select: {
              id: true,
              name: true,
              sku: true,
              cost_price: true,
              state: true,
            },
          },
        },
        take: 20,
      });

      for (const sp of supplierProducts) {
        if (seenIds.has(sp.products.id)) continue;
        const nameScore = this.fuzzyScore(item.description, sp.products.name);
        const skuScore =
          item.sku_if_visible && sp.supplier_sku
            ? sp.supplier_sku.toLowerCase() ===
              item.sku_if_visible.toLowerCase()
              ? 90
              : 0
            : 0;
        const score = Math.max(nameScore + 10, skuScore); // +10 bonus for being in supplier catalog
        if (score >= 30) {
          seenIds.add(sp.products.id);
          // Solo se reporta el archivado que HABRÍA sido candidato. Anunciar
          // cada fila archivada del catálogo del proveedor —incluidas las que
          // ni siquiera puntúan— llenaría la revisión de ruido y enterraría
          // los avisos que sí importan.
          if (sp.products.state === 'archived') {
            archivedDiscards.push({
              id: sp.products.id,
              name: sp.products.name,
              sku: sp.products.sku,
            });
            continue;
          }
          candidates.push({
            id: sp.products.id,
            name: sp.products.name,
            sku: sp.products.sku || '',
            cost_price: sp.cost_per_unit ? Number(sp.cost_per_unit) : undefined,
            confidence: Math.min(score, 100),
          });
        }
      }
    }

    // Tier 3: Name-based search in products table
    const keywords = item.description
      .split(/[\s,;.\-\/]+/)
      .filter((w) => w.length > 2)
      .slice(0, 4);

    if (keywords.length > 0) {
      const nameMatches = await this.prisma.products.findMany({
        where: {
          OR: keywords.map((kw) => ({
            name: { contains: kw, mode: 'insensitive' as const },
          })),
          state: { not: 'archived' },
        },
        select: { id: true, name: true, sku: true, cost_price: true },
        take: 10,
      });

      for (const p of nameMatches) {
        if (seenIds.has(p.id)) continue;
        const score = this.fuzzyScore(item.description, p.name);
        if (score >= 25) {
          seenIds.add(p.id);
          candidates.push({
            id: p.id,
            name: p.name,
            sku: p.sku || '',
            cost_price: p.cost_price ? Number(p.cost_price) : undefined,
            confidence: Math.min(score, 100),
          });
        }
      }
    }

    // Sort by confidence descending
    candidates.sort((a, b) => b.confidence - a.confidence);

    return { candidates: candidates.slice(0, 5), archivedDiscards };
  }

  private fuzzyScore(query: string, target: string): number {
    const q = query.toLowerCase().trim();
    const t = target.toLowerCase().trim();

    if (q === t) return 100;
    if (t.includes(q) || q.includes(t)) return 85;

    const qWords = q.split(/\s+/).filter((w) => w.length > 2);
    const tWords = t.split(/\s+/).filter((w) => w.length > 2);

    if (qWords.length === 0 || tWords.length === 0) return 0;

    let matches = 0;
    for (const qw of qWords) {
      for (const tw of tWords) {
        if (tw.includes(qw) || qw.includes(tw)) {
          matches++;
          break;
        }
      }
    }

    return Math.round((matches / qWords.length) * 80);
  }

  private async preprocessImage(
    file: Express.Multer.File,
  ): Promise<{ base64: string; mimeType: string }> {
    return this.prepareImage(file);
  }

  /**
   * Public OCR preprocessing — sharp resize to 1536px / q85, returns base64 +
   * dataUri-compatible mimeType. Espejo del patrón `ExpenseScannerService.prepareImage`
   * (vendix-ai-queue v2.2 — el processor async recibe la dataUri, no el buffer).
   */
  async prepareImage(
    file: Express.Multer.File,
  ): Promise<{ base64: string; mimeType: string }> {
    const MAX_DIMENSION = 1536;
    const JPEG_QUALITY = 85;

    try {
      const metadata = await sharp(file.buffer).metadata();
      const needsResize =
        (metadata.width && metadata.width > MAX_DIMENSION) ||
        (metadata.height && metadata.height > MAX_DIMENSION);

      let pipeline = sharp(file.buffer);

      if (needsResize) {
        pipeline = pipeline.resize(MAX_DIMENSION, MAX_DIMENSION, {
          fit: 'inside',
          withoutEnlargement: true,
        });
      }

      const processedBuffer = await pipeline
        .jpeg({ quality: JPEG_QUALITY })
        .toBuffer();

      this.logger.debug(
        `[InvoiceScan] Image preprocessed: ${file.size} bytes → ${processedBuffer.length} bytes (${metadata.width}x${metadata.height}${needsResize ? ' resized' : ''})`,
      );

      return {
        base64: processedBuffer.toString('base64'),
        mimeType: 'image/jpeg',
      };
    } catch (err) {
      this.logger.warn(
        `[InvoiceScan] Image preprocessing failed, using raw: ${err.message}`,
      );
      return {
        base64: file.buffer.toString('base64'),
        mimeType: file.mimetype,
      };
    }
  }

  /**
   * Track B2 — worker-side OCR for payment receipts. Calque de
   * `ExpenseScannerService.scanFromImage`: llama `aiEngine.run()` DIRECTO
   * (NUNCA `runByApplicationType`, que descarta extra_messages en apps image).
   * Devuelve `{amount, payment_date, payment_method, reference, currency,
   * notes, confidence}` parseado de forma defensiva.
   */
  async scanPaymentFromImage(
    dataUri: string,
    _mimeType: string,
  ): Promise<{
    amount: number;
    payment_date: string;
    payment_method: string;
    reference: string | null;
    currency: string | null;
    notes: string | null;
    confidence: number;
  }> {
    const imageMessage: any = {
      role: 'user',
      content: [
        {
          type: 'text',
          text: 'Extract structured payment-receipt data from this image. Return ONLY the JSON object per the schema in your system prompt.',
        },
        {
          type: 'image_url',
          image_url: { url: dataUri, detail: 'high' },
        },
      ],
    };

    const response = await this.aiEngine.run(
      'payment_receipt_ocr',
      {},
      [imageMessage],
    );

    if (!response.success) {
      this.logger.error(
        `[PaymentReceiptScan] aiEngine.run failed: ${response?.error ?? 'unknown'}`,
      );
      throw new Error('AI scan failed');
    }

    let parsed: any;
    const raw = (response as any).content ?? (response as any).text ?? '';
    try {
      const cleaned = String(raw)
        .replace(/^```(?:json)?\s*/i, '')
        .replace(/\s*```\s*$/i, '')
        .trim();
      parsed = JSON.parse(cleaned);
    } catch (err: any) {
      this.logger.error(
        `[PaymentReceiptScan] JSON parse failed: ${err?.message} (raw=${String(raw).slice(0, 200)})`,
      );
      throw new Error('OCR parse failed');
    }

    return {
      amount: Number(parsed.amount) || 0,
      payment_date: String(parsed.payment_date ?? ''),
      payment_method: String(parsed.payment_method ?? 'other'),
      reference: parsed.reference ?? null,
      currency: parsed.currency ?? null,
      notes: parsed.notes ?? null,
      confidence: Number(parsed.confidence) || 0,
    };
  }

  private normalizeOcrResponse(
    raw: unknown,
    currency: StoreCurrencyInfo,
  ): InvoiceScanResult {
    const parsed = raw as any;

    // El total impreso NO es un campo requerido. Una factura multipágina —o un
    // tiquete cuyo pie no alcanza a leerse— devuelve `supplier` y las N líneas
    // perfectas con `total: null`, y exigirlo aquí tiraba TODO el escaneo con
    // INV_SCAN_INCOMPLETE (422) pese a que no faltaba ni un renglón. El total
    // es derivable de las líneas; el proveedor y las líneas no.
    if (
      !parsed?.supplier ||
      !Array.isArray(parsed.line_items) ||
      parsed.line_items.length === 0
    ) {
      throw new Error(
        'AI response missing required fields: supplier or line_items',
      );
    }

    // F3 IVA lifecycle: invoice-global include flag. Canonical default is
    // `false` (tax added on top) when the scanner does not emit it, mirroring
    // `effective_include = ... ?? false` in deriveLineTax / recalculateItemTotals.
    const pricesIncludeTax = parsed.prices_include_tax === true;

    const scanWarnings: string[] = [];
    const repairs = { count: 0 };

    /** Repair one document-level money field, tallying separator misreads. */
    const money = (value: unknown): number => {
      const { value: fixed, repaired } = repairScannedAmount(
        Number(value) || 0,
        currency,
      );
      if (repaired) repairs.count++;
      return fixed;
    };

    const lineItems = (parsed.line_items || []).map((item: any) =>
      this.normalizeLineItem(item, pricesIncludeTax, currency, repairs),
    );
    const subtotal = money(parsed.subtotal);
    const taxAmount = money(parsed.tax_amount);

    // Total del documento: se usa el impreso cuando existe y se deriva de las
    // líneas cuando no. `line_items[].total` es el total IMPRESO de la línea
    // (reparado, nunca aplanado a neto en normalizeLineItem), así que la suma
    // vive en la misma base que el total de pie y son directamente comparables.
    // Un `total: 0` cuenta como ilegible: antes pasaba la guarda y producía una
    // OC con total cero en silencio, porque checkTotalsConsistency también se
    // salta el cero.
    const printedTotal = parsed.total == null ? null : money(parsed.total);
    const lineTotalsSum = lineItems.reduce(
      (acc, item) => acc + (Number(item.total) || 0),
      0,
    );
    const totalWasDerived = printedTotal == null || printedTotal === 0;
    const total = totalWasDerived ? lineTotalsSum : printedTotal;

    if (totalWasDerived) {
      scanWarnings.push(
        lineTotalsSum > 0
          ? 'No se pudo leer el total impreso de la factura; se calculó sumando las ' +
            'líneas. Verifícalo antes de confirmar.'
          : 'No se pudo leer el total de la factura ni calcularlo desde las líneas. ' +
            'Ingrésalo manualmente antes de confirmar.',
      );
    }

    if (repairs.count > 0) {
      this.logger.warn(
        `[InvoiceScan] Repaired ${repairs.count} amount(s) misread as decimals in ${currency.code} (0-decimal currency).`,
      );
      scanWarnings.push(
        `Se corrigieron ${repairs.count} valor(es) que la IA leyó con decimales ` +
          `pese a que ${currency.code} no los usa. Verifica los precios antes de confirmar.`,
      );
    }

    // Solo tiene sentido contrastar contra un total IMPRESO. Con el derivado se
    // compararía la suma de las líneas consigo misma: gap 0, aviso imposible.
    const totalsWarning = totalWasDerived
      ? null
      : checkTotalsConsistency(
          lineItems.map((item) => item.total),
          total,
          currency.code,
        );
    if (totalsWarning) scanWarnings.push(totalsWarning);

    // QUI-661 Fase 4 — descuentos de cabecera.
    const rawHeaderDiscount = Number(parsed.discount_amount);
    const headerDiscountPrinted =
      Number.isFinite(rawHeaderDiscount) && rawHeaderDiscount > 0
        ? repairScannedAmount(rawHeaderDiscount, currency).value
        : 0;
    // Se aplana igual que las líneas: en una factura con IVA incluido el
    // descuento impreso también es bruto. `let` porque la guarda de la Fase 5
    // puede anularlo cuando coexiste con un descuento por línea.
    let headerDiscountNet =
      pricesIncludeTax && headerDiscountPrinted > 0
        ? headerDiscountPrinted / (1 + this.dominantTaxRate(lineItems))
        : headerDiscountPrinted;

    const rawEarly = Number(parsed.early_payment_discount);
    const earlyPaymentDiscount =
      Number.isFinite(rawEarly) && rawEarly > 0
        ? repairScannedAmount(rawEarly, currency).value
        : 0;
    if (earlyPaymentDiscount > 0) {
      scanWarnings.push(
        'La factura menciona un descuento por pronto pago. No se aplica al costo: es un descuento financiero y se decide al registrar el pago.',
      );
    }

    // QUI-661 Fase 5 — anti-doble-conteo del descuento comercial. La IA
    // puede emitir descuento POR LÍNEA y de CABECERA a la vez; el caso
    // típico es un pie que totaliza descuentos ya desglosados en el cuerpo,
    // pero el modelo también lo hace por confusión entre las dos clases. El
    // de línea es el canónico — es el que llega a `deriveLineTax`
    // (purchase-orders.service.ts L175-182) línea por línea y se capitaliza
    // en la capa FIFO. Si dejamos pasar el de cabecera, `prorateHeaderDiscount`
    // lo reparte entre las líneas y `deriveLineTax` lo SUMA al descuento
    // propio: la base gravable se rebaja dos veces → IVA descontable
    // subvaluado ante la DIAN y costo de inventario capitalizado por debajo
    // de lo pagado. Por eso, si alguna línea trae descuento y la cabecera
    // trae descuento, descartamos el de cabecera y avisamos al operador.
    //
    // El prompt (migración 20260820…invoice_ocr_discount_decision_rule) ya
    // intenta que esto no pase, declarando el per-line como canónico cuando
    // ambos aparecen; este guard es la última línea de defensa y debe
    // coincidir con esa regla — si cambia el prompt, revisar este bloque.
    const lineHasCommercialDiscount = lineItems.some(
      (li) => Number(li.discount_amount) > 0,
    );
    const headerWasPrinted =
      Number.isFinite(rawHeaderDiscount) && rawHeaderDiscount > 0;
    if (lineHasCommercialDiscount && headerWasPrinted && headerDiscountNet > 0) {
      scanWarnings.push(
        'La factura muestra descuentos por línea y un descuento general en el pie. ' +
          'Se conservaron los descuentos por línea y se descartó el del pie para ' +
          'evitar descontar el mismo dinero dos veces sobre la base gravable. ' +
          'Verifica que el total cuadre antes de confirmar.',
      );
      // Anulamos el de cabecera para que no llegue a `prorateHeaderDiscount`.
      // El `early_payment_discount` ya está resuelto arriba y NO se ve
      // afectado: es financiero, vive en otro campo y no entra a este cálculo.
      headerDiscountNet = 0;
    }

    return {
      supplier: {
        name: parsed.supplier?.name || 'Desconocido',
        tax_id: parsed.supplier?.tax_id || undefined,
        address: parsed.supplier?.address || undefined,
        phone: parsed.supplier?.phone || undefined,
      },
      invoice_number: String(parsed.invoice_number || ''),
      invoice_date: String(parsed.invoice_date || ''),
      payment_terms: parsed.payment_terms || undefined,
      prices_include_tax: pricesIncludeTax,
      line_items: lineItems,
      subtotal,
      tax_amount: taxAmount,
      // QUI-661 Fase 4 — descuento comercial de pie de factura, aplanado a neto
      // con la misma regla que las líneas.
      discount_amount: headerDiscountNet > 0 ? headerDiscountNet : undefined,
      // El de PRONTO PAGO se extrae para mostrarlo, NUNCA para aplicarlo: es
      // financiero, se decide al pagar (QUI-647) y no rebaja el costo del
      // inventario. Va crudo, sin aplanar, porque no entra a ningún cálculo.
      early_payment_discount: earlyPaymentDiscount || undefined,
      total,
      confidence: Number(parsed.confidence) || 0,
      scan_warnings: scanWarnings.length > 0 ? scanWarnings : undefined,
    };
  }

  /**
   * QUI-661 Fase 4 — tasa de IVA dominante de la factura, para aplanar el
   * descuento de PIE de factura.
   *
   * El descuento de cabecera no pertenece a ninguna línea, así que no tiene una
   * tasa propia: se usa la tasa de la línea de mayor valor, que es la que
   * domina la factura. Es una aproximación consciente y sólo afecta al caso
   * inclusivo con tasas mixtas, que es raro; el descuento POR LÍNEA, que es el
   * camino preciso, usa la tasa de su propia línea.
   */
  private dominantTaxRate(
    lineItems: InvoiceScanResult['line_items'],
  ): number {
    let best = 0;
    let bestValue = -1;
    for (const item of lineItems) {
      const value = Number(item.total) || 0;
      if (value > bestValue) {
        bestValue = value;
        best = Number(item.tax_rate) || 0;
      }
    }
    return best;
  }

  /**
   * F3 IVA lifecycle: normalize a single extracted line, flattening its
   * printed unit price to NET when the invoice is IVA-inclusive.
   *
   * Canonical formula (byte-for-byte mirror of PurchaseOrdersService.
   * deriveLineTax): the scanner emits `tax_rate` as a FRACTION (0, 0.05,
   * 0.19) — NOT a percentage — so `r = tax_rate` directly (no /100 here).
   *   include + r>0 → unit_price_net = gross / (1 + r)
   *   otherwise     → unit_price_net = gross (net === printed)
   *
   * `unit_price` is set to the NET; the original printed value is preserved
   * in `unit_price_gross` (equal to net in the exclusive case). This lets
   * `unit_cost` persist net downstream and the UI show "bruto → neto".
   */
  private normalizeLineItem(
    item: any,
    pricesIncludeTax: boolean,
    currency: StoreCurrencyInfo,
    repairs: { count: number },
  ): InvoiceScanResult['line_items'][number] {
    // ORDER MATTERS: repair the PRINTED gross before flattening to net. The
    // net-flattening below legitimately produces fractional values
    // (gross / 1.19), so running the repair afterwards would inflate a
    // correct net by 1000x.
    const grossRepair = repairScannedAmount(
      Number(item.unit_price) || 0,
      currency,
    );
    if (grossRepair.repaired) repairs.count++;
    const grossUnit = grossRepair.value;

    const totalRepair = repairScannedAmount(Number(item.total) || 0, currency);
    if (totalRepair.repaired) repairs.count++;

    // El scanner emite tax_rate como fracción (0.19), no como porcentaje.
    // NUNCA se repara: 0.19 es fraccionario por contrato, igual que
    // `quantity` (0,315 KGM es una cantidad real en un tiquete por peso).
    const rawRate = Number(item.tax_rate);
    const taxRate =
      Number.isFinite(rawRate) && rawRate >= 0 ? rawRate : null;
    const r = taxRate ?? 0;
    const unitNet =
      pricesIncludeTax && r > 0 ? grossUnit / (1 + r) : grossUnit;

    // Izada a const (antes se calculaba en línea dentro del return) porque el
    // descuento derivado de un porcentaje necesita la MISMA cantidad que se
    // emite: dos lecturas independientes de `item.quantity` podrían divergir.
    const quantity = Number(item.quantity) || 0;

    // QUI-661 Fase 4 — el descuento se aplana a NETO con la MISMA regla que el
    // precio. Si la factura imprime precios con IVA incluido, el descuento
    // impreso también es bruto; restarlo tal cual de un `unit_price` ya neto
    // sobre-descontaría exactamente el IVA del descuento (19% de más sobre esa
    // rebaja) y arrastraría ese error hasta la capa de costo.
    const rawDiscount = Number(item.discount_amount);
    const printedAmountDiscount =
      Number.isFinite(rawDiscount) && rawDiscount > 0
        ? repairScannedAmount(rawDiscount, currency).value
        : 0;

    // QUI-661 hotfix — el PORCENTAJE de descuento de la línea. NUNCA pasa por
    // `repairScannedAmount`: es adimensional, igual que `tax_rate`. 20 es 20,
    // no 20.000; repararlo lo convertiría en un porcentaje absurdo.
    const rawPct = Number(item.discount_percentage);
    const discountPct =
      Number.isFinite(rawPct) && rawPct > 0 ? Math.min(100, rawPct) : undefined;

    // Cuando la IA imprime "-20%" pero deja el monto en 0 —el defecto que
    // motivó este hotfix— el descuento NO puede perderse: se deriva del
    // porcentaje sobre el valor BRUTO de la línea (mismo `quantity` ya
    // calculado arriba), que es la base sobre la que la factura imprime el
    // porcentaje. Si la IA emitió AMBOS, el MONTO manda y el porcentaje queda
    // como procedencia: no se reconcilian ni se avisa, porque el monto impreso
    // es la cifra que el proveedor cobró.
    const printedDiscount =
      printedAmountDiscount > 0
        ? printedAmountDiscount
        : discountPct !== undefined
          ? grossUnit * quantity * (discountPct / 100)
          : 0;

    const discountNet =
      pricesIncludeTax && r > 0 ? printedDiscount / (1 + r) : printedDiscount;

    const rawPackSize = Number(item.pack_size);

    return {
      description: String(item.description || ''),
      quantity,
      // unit_price SIEMPRE queda en neto (aplastado si la factura era inclusiva).
      unit_price: unitNet,
      unit_price_gross: grossUnit,
      tax_rate: taxRate,
      total: totalRepair.value,
      sku_if_visible: item.sku_if_visible || undefined,
      // Fase 4: preserva las pistas de UoM emitidas por el perfil ingredient
      // (antes se descartaban en el map original).
      presentation: item.presentation ?? undefined,
      pack_size:
        Number.isFinite(rawPackSize) && rawPackSize > 0
          ? rawPackSize
          : undefined,
      uom_hint: item.uom_hint ?? undefined,
      // Neto, coherente con `unit_price`. Cero se emite como undefined para no
      // ensuciar las líneas sin descuento.
      discount_amount: discountNet > 0 ? discountNet : undefined,
      // QUI-661 hotfix — el porcentaje NO se aplana: es adimensional, no vive
      // en ninguna base. Viaja como procedencia para que el modal muestre la
      // misma cifra que imprime el papel.
      discount_percentage: discountPct,
    };
  }

  /**
   * F3 IVA lifecycle — read-only check of the commerce's VAT responsibility.
   * Delegada a `VatResponsibilityService.resolveDetailed` (helper canónico).
   * Antes era una réplica local de PurchaseOrdersService.isVatResponsible;
   * P0.1 centralizó el predicado. Misma fuente
   * (SettingsService.getFiscalData().tax_responsibilities, RUT casilla 53).
   *
   * Devuelve TRES estados, no dos: `responsible`, `indeterminate`, y el
   * `reason` / `message` que explican la decisión. El escáner los necesita
   * porque este predicado gobierna el `suggested_tax_category_id` de TODA la
   * factura escaneada, y «no eres responsable» y «no sabemos si lo eres» son
   * dos cosas distintas que contarle al usuario.
   *
   * Never throws. Ante un fallo de LECTURA devuelve `readFailure()`:
   * indeterminado y NO responsable (fail-closed) — el IVA se capitaliza al
   * costo, que es la lectura conservadora.
   *
   * CP-PURCHASE-TRANSPARENCY B.0 — este `catch` devolvía `true`. Fallar
   * abierto contradecía al helper canónico (que falla cerrado desde
   * 2026-08-21) y hacía que un fallo transitorio de settings declarara «eres
   * responsable de IVA» sin saberlo: el escáner sugería un impuesto
   * descontable y la pantalla siguiente explicaba que el impuesto se
   * capitaliza — dos afirmaciones fiscales opuestas sobre la misma factura,
   * con minutos de diferencia.
   */
  private async resolveVatResponsibility(): Promise<VatResponsibilityResult> {
    try {
      const fiscalData = await this.settingsService.getFiscalData();
      return this.vatService.resolveDetailed(
        fiscalData as Parameters<
          VatResponsibilityService['resolveDetailed']
        >[0],
      );
    } catch (error: any) {
      // El contexto del Logger distingue este warn de su homólogo en
      // PurchaseOrdersService, pero se pierde apenas alguien copia la línea a
      // un ticket. Por eso la línea nombra tenant y petición por sí sola.
      const organizationId = RequestContextService.getOrganizationId();
      const storeId = RequestContextService.getStoreId();
      const requestId = RequestContextService.getRequestId();
      this.logger.warn(
        `[InvoiceScan] resolveVatResponsibility: could not resolve fiscal data ` +
          `for org ${organizationId ?? 'unknown'} / store ${storeId ?? 'unknown'} ` +
          `(request ${requestId ?? 'unknown'}): ${error?.message}. ` +
          `Falling back to NOT VAT responsible (fail-closed); the tax is capitalized into cost.`,
      );
      return this.vatService.readFailure();
    }
  }

  /**
   * F3 IVA lifecycle: load the commerce's tax categories with their rates so
   * `matchProducts` can suggest one by rate. `tax_categories` es store-scoped,
   * pero las categorías de nivel ORGANIZACIÓN viven con `store_id = NULL`, y
   * esas son invisibles para el cliente con alcance de tienda — por eso la
   * lectura va por `withoutScope()`.
   *
   * HOTFIX: antes el where era `OR: [{store_id}, {store_id: null}]` SIN acotar
   * la organización, así que el catálogo de una tienda incluía las categorías
   * globales de CUALQUIER otro inquilino. En producción eso hacía que una
   * tienda recibiera como sugerencia el «IVA 19%» de otra organización y que
   * `PurchaseOrdersService.create` lo rechazara con «Una o más categorías de
   * impuesto no existen para esta tienda». El predicado ahora es uno solo
   * (`buildTaxCategoryScopeWhere`) y lo comparten escáner y validación.
   *
   * Rates are read as fractions (Decimal(6,5)) to match the scanner's
   * fractional tax_rate. Never throws (returns [] on failure).
   */
  private async loadTaxCategoryRates(): Promise<
    Array<{ id: number; rates: number[] }>
  > {
    try {
      const storeId = RequestContextService.getStoreId();
      if (!storeId) return [];
      const organizationId = RequestContextService.getOrganizationId();
      const categories = await this.prisma
        .withoutScope()
        .tax_categories.findMany({
          where: buildTaxCategoryScopeWhere(storeId, organizationId),
          select: { id: true, store_id: true, tax_rates: { select: { rate: true } } },
        });
      // Ante empate de tasa gana la categoría propia de la tienda: es la que el
      // comercio administra y la que sus reportes fiscales esperan.
      return preferOwnStoreCategories(categories, storeId).map((c) => ({
        id: c.id,
        rates: c.tax_rates.map((rate) => Number(rate.rate)),
      }));
    } catch (err: any) {
      this.logger.warn(
        `Could not load tax categories for suggestion: ${err?.message}`,
      );
      return [];
    }
  }

  /**
   * F3 IVA lifecycle: resolve the closest tax_category whose rate matches the
   * line's fractional `tax_rate`. Returns null when there is no rate (exempt /
   * 0 / missing) or no catalog match. Tolerance covers Decimal(6,5) noise
   * (0.19 vs 0.19000). Caller already suppressed the catalog for O-49 tenants.
   */
  private suggestTaxCategoryId(
    taxRate: number | null | undefined,
    taxCategoryRates: Array<{ id: number; rates: number[] }>,
  ): number | null {
    const r = Number(taxRate);
    if (!Number.isFinite(r) || r <= 0 || taxCategoryRates.length === 0) {
      return null;
    }
    const TOLERANCE = 0.005; // fracción
    let best: { id: number; delta: number } | null = null;
    for (const cat of taxCategoryRates) {
      for (const rate of cat.rates) {
        const delta = Math.abs(rate - r);
        if (delta <= TOLERANCE && (best === null || delta < best.delta)) {
          best = { id: cat.id, delta };
        }
      }
    }
    return best?.id ?? null;
  }
}
